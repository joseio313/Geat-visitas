// ============================================================
// Edge Function: geat-cv-cron v4 (GEAT v255)
// Ingesta diaria de CVs SIN que nadie apriete "Procesar nuevos".
//
// Lo llama pg_cron (07:00 y 13:00 Bolivia) con ?key=<app_config.sheet_sync_key>,
// el mismo esquema de bot-recordatorios. Sin PIN de usuario.
//
// Por que una Edge Function y no un pg_net directo al Apps Script: el Apps Script
// exige el token GEAT_CV_SECRET, que vive SOLO en el entorno de las Edge Functions
// (no en app_config, que es de lectura publica). Ademas aca el fallo queda
// registrado en el servidor y no depende de la cuenta que corre el script.
//
// Cada corrida:
//   1. POST a app_config.cv_webapp_url con {token}; la respuesta DEBE ser JSON.
//   2. geat-cv accion reintentar_pendientes (CVs que entraron sin puntaje).
//   3. guarda el resultado en app_config.cv_cron_estado.
//   4. evalua alertas y avisa a Jose Miguel por WhatsApp (ycloud):
//        PROBLEMAS (activan el banner rojo del CRM):
//        - falla_ingesta : el Apps Script no respondio JSON / dio error / hubo timeout
//        - errores_script: el Apps Script informo errores > 0
//        - pendientes_24h: filas pendiente_analisis de mas de 24 h que no se pudieron puntuar
//        INFORMATIVA (no es falla, no activa el banner):
//        - sin_cvs_72h   : 72 h sin un solo CV nuevo con campana activa
//      Antispam: cv_cron_avisos guarda cuando se mando cada tipo.
//
// v4 — POR QUE CAMBIO EL ENVIO (8-oct-2026): el aviso de v2 mandaba TEXTO LIBRE y usaba la
// plantilla como respaldo "si el texto fallaba". Pero YCloud responde 200 al aceptar el
// envio y el rechazo de Meta llega DESPUES (error 131047: pasaron mas de 24 h desde que el
// cliente escribio): el respaldo nunca se disparaba y el aviso se perdia en silencio. Ademas
// la plantilla aviso_interno NO existe en Meta. Ahora:
//   - el aviso sale SIEMPRE por plantilla aprobada (nunca texto libre);
//   - despues de enviar se consulta el estado REAL del mensaje (failed / sent / delivered);
//   - si falla, o no hay plantilla aprobada, se registra en app_config.cv_ingesta_alerta
//     (segundo canal) y el CRM muestra un banner rojo "Ingesta de CVs con problema".
//
// Modos (?modo=): ingesta (default) | reintento | vigilancia | ycloud_diag | test_plantilla |
//                 test_fallo | limpiar_test
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("GEAT_CV_SECRET") ?? "";
const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
const BUCKET = "rec-archivos";
const TIMEOUT_WEBAPP_MS = 120000;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

async function cfg(key: string): Promise<string | null> {
  const { data } = await sb.from("app_config").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}
async function guardarCfg(key: string, value: unknown) {
  await sb.from("app_config").upsert({ key, value: JSON.stringify(value), updated_at: new Date().toISOString() });
}

async function llamarGeatCv(body: Record<string, unknown>): Promise<{ status: number; data: any }> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/geat-cv`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-geat-secret": SECRET },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(130000),
  });
  const txt = await r.text();
  let data: any = null;
  try { data = JSON.parse(txt); } catch { data = { raw: txt.slice(0, 300) }; }
  return { status: r.status, data };
}

async function reintentar(res: any) {
  try {
    const r = await llamarGeatCv({ accion: "reintentar_pendientes", limite: 8 });
    res.reintento = r.status === 200 ? r.data : { error: `geat-cv HTTP ${r.status}`, detalle: r.data };
  } catch (e) { res.reintento = { error: String(e).slice(0, 200) }; }
}

// ---- WhatsApp: SIEMPRE por plantilla aprobada, con verificacion de la entrega real ----
const BOT_FROM = "+59174572694";
const HORAS = (ms: number) => ms / 3600e3;
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const horaBO = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 16).replace("T", " ");

/* Plantilla objetivo (a crear en Meta, ver ORDEN): aviso_interno, UTILITY, es, 2 variables.
   Mientras no este APROBADA se usa recordatorio_visita_12h, que SI lo esta (UTILITY, es), con
   las variables rellenas con el aviso. Se queda legible pero es un PUENTE temporal: cuando
   aviso_interno pase a APPROVED el codigo la prefiere solo, sin tocar nada. */
const PLANTILLA_AVISO = "aviso_interno";
const PLANTILLA_PUENTE = "recordatorio_visita_12h";

const limpiarParam = (s: string, max: number) =>
  String(s).replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, max);

async function ycloudGet(apiKey: string, path: string): Promise<{ http: number; data: any }> {
  const r = await fetch("https://api.ycloud.com/v2" + path, { headers: { "X-API-Key": apiKey }, signal: AbortSignal.timeout(20000) });
  let data: any = null;
  try { data = await r.json(); } catch { data = null; }
  return { http: r.status, data };
}

async function plantillaAprobada(apiKey: string, nombre: string): Promise<boolean> {
  const r = await ycloudGet(apiKey, "/whatsapp/templates?limit=50&page=1");
  const items: any[] = r.data?.items ?? [];
  return items.some((t) => t.name === nombre && t.language === "es" && t.status === "APPROVED");
}

type Envio = { ok: boolean; plantilla: string | null; estado: string | null; errorCode?: string; error?: string; id?: string };

async function enviarAviso(titulo: string, detalle: string): Promise<Envio> {
  const apiKey = await cfg("ycloud_api_key");
  const dest = await cfg("bot_notif_whatsapp");
  if (!apiKey || !dest) return { ok: false, plantilla: null, estado: null, error: "falta ycloud_api_key o bot_notif_whatsapp" };
  const to = "+" + dest.replace(/\D/g, "");
  try {
    let plantilla: string | null = null;
    if (await plantillaAprobada(apiKey, PLANTILLA_AVISO)) plantilla = PLANTILLA_AVISO;
    else if (await plantillaAprobada(apiKey, PLANTILLA_PUENTE)) plantilla = PLANTILLA_PUENTE;
    if (!plantilla) return { ok: false, plantilla: null, estado: null, error: "no hay ninguna plantilla aprobada (ni " + PLANTILLA_AVISO + " ni " + PLANTILLA_PUENTE + ")" };

    const t = limpiarParam(titulo, 200), d = limpiarParam(detalle, 600);
    const params = plantilla === PLANTILLA_AVISO
      ? [t, d]
      : [" AVISO DEL SISTEMA: " + t, " (" + d + ")", " " + horaBO().slice(11) + " hora Bolivia"];
    const r = await fetch("https://api.ycloud.com/v2/whatsapp/messages/sendDirectly", {
      method: "POST", headers: { "X-API-Key": apiKey, "Content-Type": "application/json" }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ from: BOT_FROM, to, type: "template", template: { name: plantilla, language: { code: "es" },
        components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: p })) }] } }),
    });
    const txt = await r.text();
    if (!r.ok) return { ok: false, plantilla, estado: null, error: "YCloud rechazo el envio HTTP " + r.status + ": " + txt.slice(0, 200) };
    let id = ""; try { id = JSON.parse(txt).id ?? ""; } catch { /* sin id */ }

    // YCloud acepta primero y Meta rechaza despues: se consulta el estado REAL.
    let estado = "accepted", errorCode: string | undefined, errorMsg: string | undefined;
    for (let i = 0; i < 4; i++) {
      await dormir(4000);
      const lst = await ycloudGet(apiKey, "/whatsapp/messages?limit=5&page=1&filter.to=" + encodeURIComponent(to));
      const m = (lst.data?.items ?? []).find((x: any) => x.id === id);
      if (m) {
        estado = m.status; errorCode = m.errorCode; errorMsg = m.errorMessage;
        if (["failed", "sent", "delivered", "read"].includes(estado)) break;
      }
    }
    if (estado === "failed") return { ok: false, plantilla, estado, errorCode, error: (errorMsg ?? "failed").slice(0, 200), id };
    return { ok: true, plantilla, estado, id };   // sent/delivered/read (o accepted sin novedad tras 16 s)
  } catch (e) { return { ok: false, plantilla: null, estado: null, error: String(e).slice(0, 200) }; }
}

// ---- Alertas ----
type Alerta = { tipo: string; titulo: string; detalle: string; espera_h: number; problema: boolean };

// Devuelve las alertas activas; res aporta el resultado de la corrida en curso (si hubo).
async function evaluarAlertas(res: any | null): Promise<Alerta[]> {
  const out: Alerta[] = [];
  if (res && !res.ok) {
    out.push({ tipo: "falla_ingesta", espera_h: 5, problema: true, titulo: "CVs: la ingesta automatica FALLO",
      detalle: (res.error ?? "error desconocido") + ". Corrida " + horaBO() + " hora Bolivia. Los CVs nuevos no estan entrando." });
  }
  const errs = Number(res?.ingesta?.errores ?? 0);
  if (res?.ok && errs > 0) {
    out.push({ tipo: "errores_script", espera_h: 23, problema: true, titulo: "CVs: el Apps Script informo " + errs + " error(es)",
      detalle: "Procesados: " + (res.ingesta.procesados ?? "?") + ", errores: " + errs + ". Revisar Ejecuciones del script." });
  }
  const limite = new Date(Date.now() - 24 * 3600e3).toISOString();
  const { count: pend } = await sb.from("cv_postulaciones").select("id", { count: "exact", head: true })
    .eq("bandera", "pendiente_analisis").lt("created_at", limite);
  if ((pend ?? 0) > 0) {
    out.push({ tipo: "pendientes_24h", espera_h: 23, problema: true, titulo: "CVs: " + pend + " sin puntuar hace mas de 24 h",
      detalle: "Entraron pero no se pudieron puntuar (OpenAI o falta el archivo). Quedan marcados pendiente_analisis en el panel." });
  }
  // INFORMATIVA: no es una falla. Solo si hay vacante activa y 72 h sin un solo CV.
  const { count: activas } = await sb.from("rec_campanas").select("id", { count: "exact", head: true }).eq("activa", true);
  if ((activas ?? 0) > 0) {
    const { data: ult } = await sb.from("cv_postulaciones").select("created_at").order("created_at", { ascending: false }).limit(1);
    const t = ult?.[0]?.created_at ? new Date(ult[0].created_at).getTime() : 0;
    if (!t || HORAS(Date.now() - t) > 72) {
      out.push({ tipo: "sin_cvs_72h", espera_h: 72, problema: false, titulo: "CVs (informativo): 72 h sin ningun CV nuevo",
        detalle: "No es una falla: la ingesta corre bien. Ultimo CV: " + (t ? new Date(t - 4 * 3600e3).toISOString().slice(0, 16).replace("T", " ") + " hora Bolivia" : "ninguno") +
          ". Hay " + activas + " vacante(s) activa(s); puede ser que aun no lleguen postulaciones." });
    }
  }
  return out;
}

/* Segundo canal: queda en app_config.cv_ingesta_alerta y el CRM lo pinta como banner rojo.
   activa=true mientras haya un PROBLEMA o los avisos de WhatsApp no esten llegando. Se apaga
   sola cuando desaparece. app_config es de lectura publica: aca no va nada sensible. */
async function sincronizarBanner(alertas: Alerta[], avisosFallidos: string[]) {
  const problemas = alertas.filter((a) => a.problema);
  let previo: any = {};
  try { previo = JSON.parse((await cfg("cv_ingesta_alerta")) ?? "{}"); } catch { previo = {}; }
  if (problemas.length || avisosFallidos.length) {
    const mensajes = problemas.map((a) => a.titulo.replace(/^CVs: /, ""));
    if (avisosFallidos.length) mensajes.push("Los avisos por WhatsApp NO estan llegando: " + avisosFallidos[0]);
    await guardarCfg("cv_ingesta_alerta", {
      activa: true, desde: previo.activa && previo.desde ? previo.desde : new Date().toISOString(),
      actualizada: new Date().toISOString(), mensajes, whatsapp_fallo: avisosFallidos[0] ?? null,
    });
  } else if (previo.activa) {
    await guardarCfg("cv_ingesta_alerta", { activa: false, resuelta: new Date().toISOString() });
  }
}

// Manda las alertas respetando el antispam. Devuelve el resumen y si algun envio fallo.
async function avisar(alertas: Alerta[]) {
  let registro: Record<string, string> = {};
  try { registro = JSON.parse((await cfg("cv_cron_avisos")) ?? "{}"); } catch { registro = {}; }
  const resumen: any[] = [];
  const fallidos: string[] = [];
  for (const a of alertas) {
    const ultimo = registro[a.tipo] ? new Date(registro[a.tipo]).getTime() : 0;
    if (HORAS(Date.now() - ultimo) < a.espera_h) { resumen.push({ tipo: a.tipo, enviado: false, motivo: "antispam" }); continue; }
    const r = await enviarAviso(a.titulo, a.detalle);
    if (r.ok) registro[a.tipo] = new Date().toISOString();
    else { fallidos.push((r.errorCode ? r.errorCode + ": " : "") + (r.error ?? "sin detalle")); console.error("aviso no enviado", a.tipo, r.errorCode, r.error); }
    resumen.push({ tipo: a.tipo, enviado: r.ok, plantilla: r.plantilla, estado: r.estado, errorCode: r.errorCode, error: r.error });
  }
  if (alertas.length) await guardarCfg("cv_cron_avisos", registro);
  await sincronizarBanner(alertas, fallidos);
  return { resumen, fallo: fallidos.length > 0 };
}

async function correr(): Promise<any> {
  const res: any = { modo: "ingesta", inicio: new Date().toISOString(), ok: false, error: null, ingesta: null, reintento: null };
  const webapp = await cfg("cv_webapp_url");
  if (!webapp) {
    res.error = "app_config.cv_webapp_url no esta configurada";
  } else {
    try {
      const r = await fetch(webapp, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: SECRET }), redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_WEBAPP_MS),
      });
      const txt = await r.text();
      let parsed: any = null;
      try { parsed = JSON.parse(txt); } catch { /* HTML de Google: acceso denegado, login, etc. */ }
      if (!r.ok || !parsed || typeof parsed !== "object") {
        const titulo = (txt.match(/<title>([^<]*)/i) || [])[1] || "";
        res.error = `el Apps Script no respondio JSON (HTTP ${r.status}${titulo ? ": " + titulo.trim() : ""})`;
      } else if (parsed.error) {
        res.error = `el Apps Script devolvio error: ${String(parsed.error).slice(0, 200)}`;
        res.ingesta = parsed;
      } else {
        res.ingesta = parsed;
        res.ok = true;
      }
    } catch (e) {
      res.error = `no se pudo llamar al Apps Script: ${String(e).slice(0, 200)}`;
    }
  }
  // El reintento corre siempre: no depende de que el Apps Script haya respondido.
  await reintentar(res);
  res.fin = new Date().toISOString();
  const av = await avisar(await evaluarAlertas(res));
  res.alertas = av.resumen;

  let previo: any = {};
  try { previo = JSON.parse((await cfg("cv_cron_estado")) ?? "{}"); } catch { /* primera corrida */ }
  await guardarCfg("cv_cron_estado", {
    ultima_ejecucion: res.fin, ok: res.ok, error: res.error,
    ultima_ok: res.ok ? res.fin : (previo.ultima_ok ?? null),
    ingesta: res.ingesta, reintento: res.reintento, alertas: res.alertas,
    aviso_fallido: av.fallo ? res.fin : null,
  });
  res.aviso_fallido = av.fallo;
  return res;
}

// PDF minimo valido con texto, para las pruebas de validacion.
function pdfMinimoB64(texto: string): string {
  const stream = `BT /F1 11 Tf 50 780 Td (${texto}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return btoa(pdf);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? "";
  if (!key || key !== (await cfg("sheet_sync_key"))) return new Response("key invalida", { status: 401 });
  if (!SECRET) return json({ ok: false, error: "GEAT_CV_SECRET no esta en el entorno" }, 500);

  const modo = url.searchParams.get("modo") ?? "ingesta";
  try {
    if (modo === "reintento") {
      const res: any = { modo, inicio: new Date().toISOString() };
      await reintentar(res);
      return json(res);
    }
    if (modo === "vigilancia") {
      const alertas = await evaluarAlertas(null);
      const av = await avisar(alertas);
      return json({ modo, alertas: alertas.map((a) => a.tipo), ...av }, av.fallo ? 500 : 200);
    }
    if (modo === "ycloud_diag") {
      // Solo lectura: estado REAL (delivered/failed + codigo de error) de los ultimos mensajes
      // al numero de avisos y estado de las plantillas en YCloud/Meta.
      const apiKey = await cfg("ycloud_api_key");
      const dest = ((await cfg("bot_notif_whatsapp")) ?? "").replace(/\D/g, "");
      if (!apiKey) return json({ error: "sin ycloud_api_key" }, 500);
      const get = async (path: string) => {
        const r = await fetch("https://api.ycloud.com/v2" + path, { headers: { "X-API-Key": apiKey }, signal: AbortSignal.timeout(20000) });
        return { http: r.status, body: (await r.text()).slice(0, 9000) };
      };
      return json({
        modo,
        mensajes: await get("/whatsapp/messages?limit=10&page=1&filter.to=" + encodeURIComponent("+" + dest)),
        plantilla_aviso_interno: await get("/whatsapp/templates?limit=10&page=1&filter.name=aviso_interno"),
        plantillas: await get("/whatsapp/templates?limit=50&page=1"),
      });
    }
    if (modo === "test_plantilla") {
      // Envia UN aviso de prueba por plantilla y devuelve el estado real de entrega.
      const r = await enviarAviso("Prueba de alertas de CVs", "Mensaje de validacion de geat-cv-cron; si lo lees las alertas llegan, no hace falta responder");
      return json({ modo, ...r }, r.ok ? 200 : 500);
    }
    if (modo === "test_fallo") {
      // Fuerza el fallo de OpenAI DENTRO de geat-cv (flag simular_fallo_openai) sin tocar
      // la clave compartida con el bot. La fila de prueba lleva gmail_message_id TEST-*.
      const id = `TEST-simulado-${Date.now()}`;
      const r = await llamarGeatCv({
        gmail_message_id: id, filename: "prueba_validacion.pdf", asunto: "Prueba de validacion",
        cuerpo_correo: "Prueba automatica de validacion del pipeline de CVs. Se borra sola.",
        pdf_base64: pdfMinimoB64("Curriculum Vitae. Nombre: Prueba Sistema. Arquitecto civil, 8 anos de experiencia en supervision de obra en Santa Cruz de la Sierra. Telefono 70000000."),
        simular_fallo_openai: true,
      });
      return json({ modo, gmail_message_id: id, geat_cv_http: r.status, respuesta: r.data });
    }
    if (modo === "limpiar_test") {
      const { data: filas } = await sb.from("cv_postulaciones").select("id, archivo_url")
        .like("gmail_message_id", "TEST-%");
      const paths = (filas ?? []).map((f: any) => (String(f.archivo_url || "").match(/\/rec-archivos\/([^?]+)/) || [])[1])
        .filter(Boolean).map((p: string) => decodeURIComponent(p));
      if (paths.length) await sb.storage.from(BUCKET).remove(paths);
      const { error } = await sb.from("cv_postulaciones").delete().like("gmail_message_id", "TEST-%");
      return json({ modo, filas: (filas ?? []).map((f: any) => f.id), archivos_borrados: paths.length, error: error?.message ?? null });
    }
    const corrida = await correr();
    return json(corrida, corrida.aviso_fallido ? 500 : 200);
  } catch (e) {
    return json({ ok: false, error: String(e).slice(0, 300) }, 500);
  }
});
