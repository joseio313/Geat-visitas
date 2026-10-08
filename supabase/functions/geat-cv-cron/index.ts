// ============================================================
// Edge Function: geat-cv-cron v2 (GEAT v255)
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
//   4. (v2) evalua alertas y avisa a Jose Miguel por WhatsApp con el bot (ycloud):
//        - falla_ingesta : el Apps Script no respondio JSON / dio error / hubo timeout
//        - errores_script: el Apps Script informo errores > 0
//        - sin_cvs_48h   : >48 h sin fila nueva en cv_postulaciones con campana activa
//        - pendientes_24h: filas pendiente_analisis de mas de 24 h que no se pudieron puntuar
//      Antispam: cv_cron_avisos guarda cuando se mando cada tipo. Nada es silencioso:
//      si el aviso mismo no sale, queda en cv_cron_estado.aviso_fallido y la funcion da 500.
//
// Modos (?modo=): ingesta (default) | reintento | vigilancia | test_aviso | test_fallo | limpiar_test
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

// ---- v2: alertas por WhatsApp (mismo patron que avisoWhatsApp de bot-whatsapp) ----
const BOT_FROM = "+59174572694";
const HORAS = (ms: number) => ms / 3600e3;
const horaBO = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 16).replace("T", " ");

type Alerta = { tipo: string; titulo: string; detalle: string; espera_h: number };

async function enviarAviso(titulo: string, detalle: string): Promise<{ ok: boolean; via: string; error?: string }> {
  const apiKey = await cfg("ycloud_api_key");
  const dest = await cfg("bot_notif_whatsapp");
  if (!apiKey || !dest) return { ok: false, via: "-", error: "falta ycloud_api_key o bot_notif_whatsapp" };
  const to = "+" + dest.replace(/\D/g, "");
  const body = ("\u{1F514} " + titulo + "\n" + detalle).slice(0, 1500);
  const post = (payload: unknown) => fetch("https://api.ycloud.com/v2/whatsapp/messages/sendDirectly", {
    method: "POST", headers: { "X-API-Key": apiKey, "Content-Type": "application/json" }, body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  try {
    const r = await post({ from: BOT_FROM, to, type: "text", text: { body } });
    if (r.ok) return { ok: true, via: "texto" };
    const r2 = await post({ from: BOT_FROM, to, type: "template", template: { name: "aviso_interno", language: { code: "es" },
      components: [{ type: "body", parameters: [{ type: "text", text: titulo.slice(0, 200) }, { type: "text", text: detalle.replace(/\n/g, " ").slice(0, 700) }] }] } });
    if (r2.ok) return { ok: true, via: "plantilla" };
    return { ok: false, via: "-", error: "texto HTTP " + r.status + " / plantilla HTTP " + r2.status + ": " + (await r2.text()).slice(0, 200) };
  } catch (e) { return { ok: false, via: "-", error: String(e).slice(0, 200) }; }
}

// Devuelve las alertas activas; res aporta el resultado de la corrida en curso (si hubo).
async function evaluarAlertas(res: any | null): Promise<Alerta[]> {
  const out: Alerta[] = [];
  if (res && !res.ok) {
    out.push({ tipo: "falla_ingesta", espera_h: 5, titulo: "CVs: la ingesta automatica FALLO",
      detalle: (res.error ?? "error desconocido") + "\nCorrida " + horaBO() + " (hora Bolivia). Los CVs nuevos no estan entrando." });
  }
  const errs = Number(res?.ingesta?.errores ?? 0);
  if (res?.ok && errs > 0) {
    out.push({ tipo: "errores_script", espera_h: 23, titulo: "CVs: el Apps Script informo " + errs + " error(es)",
      detalle: "Procesados: " + (res.ingesta.procesados ?? "?") + ", errores: " + errs + ". Revisar Ejecuciones del script." });
  }
  const { count: activas } = await sb.from("rec_campanas").select("id", { count: "exact", head: true }).eq("activa", true);
  if ((activas ?? 0) > 0) {
    const { data: ult } = await sb.from("cv_postulaciones").select("created_at").order("created_at", { ascending: false }).limit(1);
    const t = ult?.[0]?.created_at ? new Date(ult[0].created_at).getTime() : 0;
    if (!t || HORAS(Date.now() - t) > 48) {
      out.push({ tipo: "sin_cvs_48h", espera_h: 23, titulo: "CVs: mas de 48 h sin ningun CV nuevo",
        detalle: "Ultimo CV: " + (t ? new Date(t - 4 * 3600e3).toISOString().slice(0, 16).replace("T", " ") + " (Bolivia)" : "ninguno") +
          ". Hay " + activas + " campana(s) activa(s). Puede ser que no lleguen postulaciones o que la ingesta este caida." });
    }
  }
  const limite = new Date(Date.now() - 24 * 3600e3).toISOString();
  const { count: pend } = await sb.from("cv_postulaciones").select("id", { count: "exact", head: true })
    .eq("bandera", "pendiente_analisis").lt("created_at", limite);
  if ((pend ?? 0) > 0) {
    out.push({ tipo: "pendientes_24h", espera_h: 23, titulo: "CVs: " + pend + " sin puntuar hace mas de 24 h",
      detalle: "Entraron pero no se pudieron puntuar (OpenAI o falta el archivo). Quedan marcados pendiente_analisis en el panel." });
  }
  return out;
}

// Manda las alertas respetando el antispam. Devuelve el resumen y si alguna no pudo salir.
async function avisar(alertas: Alerta[]) {
  let registro: Record<string, string> = {};
  try { registro = JSON.parse((await cfg("cv_cron_avisos")) ?? "{}"); } catch { registro = {}; }
  const resumen: any[] = [];
  let fallo = false;
  for (const a of alertas) {
    const ultimo = registro[a.tipo] ? new Date(registro[a.tipo]).getTime() : 0;
    if (HORAS(Date.now() - ultimo) < a.espera_h) { resumen.push({ tipo: a.tipo, enviado: false, motivo: "antispam" }); continue; }
    const r = await enviarAviso(a.titulo, a.detalle);
    if (r.ok) registro[a.tipo] = new Date().toISOString(); else { fallo = true; console.error("aviso no enviado", a.tipo, r.error); }
    resumen.push({ tipo: a.tipo, enviado: r.ok, via: r.via, error: r.error });
  }
  if (alertas.length) await guardarCfg("cv_cron_avisos", registro);
  return { resumen, fallo };
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
    if (modo === "test_aviso") {
      const r = await enviarAviso("Prueba del aviso de CVs", "Mensaje de validacion de geat-cv-cron (" + horaBO() + " Bolivia). Si lo lees, las alertas llegan.");
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
