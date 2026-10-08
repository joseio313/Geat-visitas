// ============================================================
// Edge Function: geat-cv-cron v1 (GEAT v255)
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
//
// Modos (?modo=): ingesta (default) | reintento | test_fallo | limpiar_test
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

  let previo: any = {};
  try { previo = JSON.parse((await cfg("cv_cron_estado")) ?? "{}"); } catch { /* primera corrida */ }
  await guardarCfg("cv_cron_estado", {
    ultima_ejecucion: res.fin, ok: res.ok, error: res.error,
    ultima_ok: res.ok ? res.fin : (previo.ultima_ok ?? null),
    ingesta: res.ingesta, reintento: res.reintento,
  });
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
    return json(await correr());
  } catch (e) {
    return json({ ok: false, error: String(e).slice(0, 300) }, 500);
  }
});
