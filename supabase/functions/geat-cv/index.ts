// ============================================================
// Edge Function: geat-cv v9 (GEAT v255)
// - PDF y Word con archivo -> evalua con archivo + cuerpo
// - SIN archivo -> evalua solo con el cuerpo del correo
// - Sube archivo a Storage (rec-archivos) cuando existe
// - Modo solo_archivo: solo subir archivo de un CV existente
// - v7: tras insertar dispara geat-cv-analisis (analisis profundo)
// - v8: CLASIFICACION AUTOMATICA DE CAMPANA. El codigo_campana que
//   manda el Apps Script quedo obsoleto como fuente de verdad (mandaba
//   ARQ-OBRA fijo y los CVs de Auxiliar caian en Arquitecto). Ahora:
//   1. Se cargan TODAS las campanas activas de rec_campanas.
//   2. Si hay una sola activa, se usa esa.
//   3. Si hay varias, la IA determina a cual vacante postula el
//      candidato (asunto/cuerpo/CV) y lo evalua con ESA rubrica,
//      todo en una sola llamada (campo campana_codigo en el JSON).
//   4. codigo_campana del request queda solo como fallback si la IA
//      devuelve un codigo desconocido.
// - v9: NO PERDER CVs SI OPENAI FALLA. Antes un fallo de OpenAI devolvia 502 y no
//   insertaba nada (el 04/09/2026 se perdieron 10 de 23). Ahora la fila se inserta
//   igual con puntaje null y bandera 'pendiente_analisis', y la accion
//   'reintentar_pendientes' la puntua despues. El archivo se busca como en
//   geat-cv-analisis v4: cv_drive_id (Drive) -> archivo_url (Storage); sin ninguno
//   la fila sigue pendiente.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHARED_SECRET = Deno.env.get("GEAT_CV_SECRET") ?? "";
const BUCKET = "rec-archivos";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-geat-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FORMATO_JSON = `\nDevuelve EXCLUSIVAMENTE un objeto JSON valido (sin markdown):\n{\n  "campana_codigo": string,\n  "nombre": string,\n  "telefono": string | null,\n  "email": string | null,\n  "ciudad": string | null,\n  "anos_obra": number,\n  "ejecuto_obra": boolean,\n  "perfil": "obra" | "diseno" | "mixto" | "indefinido",\n  "puntaje": number,\n  "bandera": string | null,\n  "pretension_bs": number | null,\n  "resumen": string\n}`;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function limpiarNombre(n: string): string {
  return (n || "cv.pdf")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_").substring(0, 80);
}

function dispararAnalisis(id: number | string | undefined) {
  if (!id || !SHARED_SECRET) return;
  try {
    const p = fetch(`${SUPABASE_URL}/functions/v1/geat-cv-analisis`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-geat-secret": SHARED_SECRET },
      body: JSON.stringify({ accion: "uno", id }),
    }).then(() => {}).catch(() => {});
    // @ts-ignore EdgeRuntime existe en el runtime de Supabase
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(p);
  } catch { /* el batch del panel lo levanta despues */ }
}

async function subirArchivo(supabase: any, gmailId: string, filename: string, b64: string, mime: string): Promise<string | null> {
  try {
    const path = `cvs/${gmailId}_${limpiarNombre(filename)}`;
    const bytes = b64ToBytes(b64);
    const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
    if (error) return null;
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch { return null; }
}

async function getOpenAIKey(supabase: any): Promise<string> {
  const { data, error } = await supabase
    .from("app_config").select("value").eq("key", "openai_api_key").single();
  if (error || !data?.value) throw new Error("No se pudo leer openai_api_key");
  return data.value as string;
}

// ---- v9: no perder CVs si OpenAI falla ----
const PENDIENTE = "pendiente_analisis";
const MAX_BYTES = 8000000;
const TIMEOUT_OPENAI_MS = 70000;
const PRESUPUESTO_MS = 90000;

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

function mimeDe(filename: string | null): string {
  return /\.docx?$/i.test(filename || "")
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf";
}

// Puntua un CV con OpenAI. LANZA si OpenAI falla o devuelve algo que no es JSON:
// quien llama decide guardar la fila como pendiente_analisis (nunca se pierde el correo).
async function puntuarCv(supabase: any, campanas: any[], p: {
  asunto: string | null; cuerpo: string | null; pdfB64: string | null;
  filename: string | null; mimeType: string; codigoFallback: string | null; simularFallo?: boolean;
}) {
  if (p.simularFallo) throw new Error("openai_fail: simulado (prueba de validacion)");
  const openaiKey = await getOpenAIKey(supabase);
  const tieneArchivo = !!p.pdfB64;
  const fname = p.filename || (p.mimeType.includes("word") ? "cv.docx" : "cv.pdf");

  // v8: system prompt con clasificacion de vacante incluida
  let sistema: string;
  if (campanas.length === 1) {
    sistema = `${campanas[0].rubrica}\n\nEn el campo campana_codigo devuelve exactamente: ${campanas[0].codigo}` + FORMATO_JSON;
  } else {
    const listado = campanas.map((c: any) =>
      `=== VACANTE ${c.codigo} (${c.nombre}) ===\n${c.rubrica}`).join("\n\n");
    sistema = `GEAT Construccion (Santa Cruz, Bolivia) tiene ${campanas.length} vacantes abiertas. ` +
      `PRIMERO determina a cual vacante postula este candidato usando el asunto del correo, el cuerpo y el perfil del CV ` +
      `(un contador/administrativo NO postula a arquitecto de obra y viceversa). ` +
      `LUEGO evalualo EXCLUSIVAMENTE con la rubrica de ESA vacante. ` +
      `En campana_codigo devuelve el codigo exacto de la vacante elegida (${campanas.map((c: any) => c.codigo).join(" | ")}).\n\n` +
      listado + FORMATO_JSON;
  }

  const userContent: any[] = [
    { type: "text", text: `Asunto del correo: ${p.asunto ?? "(no disponible)"}\n\nCuerpo del correo del postulante:\n${p.cuerpo ?? "(vacio)"}\n\n${tieneArchivo ? "Evalua el CV adjunto." : "NO hay CV adjunto: evalua SOLO con la informacion del cuerpo del correo. Si falta informacion clave, baja el puntaje y pon bandera 'sin CV adjunto'."}` },
  ];
  if (tieneArchivo) {
    userContent.push({ type: "file", file: { filename: fname, file_data: `data:${p.mimeType};base64,${p.pdfB64}` } });
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_OPENAI_MS);
  let oaResp: Response;
  try {
    oaResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini", temperature: 0, response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sistema },
          { role: "user", content: userContent },
        ],
      }),
    });
  } finally { clearTimeout(t); }

  if (!oaResp.ok) throw new Error(`openai_fail: HTTP ${oaResp.status} ${(await oaResp.text()).slice(0, 200)}`);

  const oaData = await oaResp.json();
  let parsed: any;
  try { parsed = JSON.parse(oaData.choices?.[0]?.message?.content ?? "{}"); }
  catch { throw new Error("openai_json_invalido"); }
  if (!parsed || typeof parsed !== "object" || parsed.puntaje == null) throw new Error("openai_respuesta_incompleta");

  // v8: resolver campana elegida por la IA, con fallbacks
  let campana = campanas.find((c: any) => c.codigo === parsed.campana_codigo);
  let banderaExtra: string | null = null;
  if (!campana && p.codigoFallback) {
    campana = campanas.find((c: any) => c.codigo === p.codigoFallback);
    if (campana) banderaExtra = "clasificacion IA fallo, se uso codigo del script";
  }
  if (!campana) {
    campana = campanas[0];
    banderaExtra = `campana no resuelta (IA: ${parsed.campana_codigo ?? "null"}), asignada por defecto`;
  }
  return { parsed, campana, banderaExtra };
}

// Token de Google (mismo esquema que geat-cv-analisis v4 / geat-cvs-drive)
let _gtok: { t: string; exp: number } | null = null;
async function tokenGoogle(sb: any): Promise<string> {
  const ahora = Math.floor(Date.now() / 1000);
  if (_gtok && _gtok.exp > ahora + 60) return _gtok.t;
  const { data } = await sb.from("app_config").select("value").eq("key", "google_oauth_json").maybeSingle();
  if (!data || !data.value) throw new Error("google_no_configurado");
  const o = JSON.parse(data.value);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: o.client_id, client_secret: o.client_secret,
      refresh_token: o.refresh_token, grant_type: "refresh_token" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error("google_rechazo_credencial");
  _gtok = { t: j.access_token, exp: ahora + (Number(j.expires_in) || 3600) };
  return j.access_token;
}

// Misma cascada que geat-cv-analisis v4: cv_drive_id (Drive) -> archivo_url (Storage).
// Si ninguno entrega el archivo devuelve null y la fila queda pendiente.
async function descargarCv(supabase: any, cv: any): Promise<{ bytes: Uint8Array; via: string } | null> {
  if (cv.cv_drive_id) {
    try {
      const tok = await tokenGoogle(supabase);
      const fr = await fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(cv.cv_drive_id) +
        "?alt=media&supportsAllDrives=true", { headers: { Authorization: "Bearer " + tok } });
      if (fr.ok) {
        const bytes = new Uint8Array(await fr.arrayBuffer());
        if (bytes.length) return { bytes, via: "drive" };
      }
    } catch { /* cae a Storage */ }
  }
  if (cv.archivo_url) {
    try {
      const m = String(cv.archivo_url).match(/\/rec-archivos\/([^?]+)/);
      if (m) {
        const { data, error } = await supabase.storage.from(BUCKET).download(decodeURIComponent(m[1]));
        if (!error && data) {
          const bytes = new Uint8Array(await data.arrayBuffer());
          if (bytes.length) return { bytes, via: "storage" };
        }
      }
      const fr = await fetch(cv.archivo_url);
      if (fr.ok) {
        const bytes = new Uint8Array(await fr.arrayBuffer());
        if (bytes.length) return { bytes, via: "url" };
      }
    } catch { /* sin archivo */ }
  }
  return null;
}

// accion 'reintentar_pendientes': puntua las filas con bandera pendiente_analisis.
async function reintentarPendientes(supabase: any, limite: number) {
  const t0 = Date.now();
  const { data: activas } = await supabase
    .from("rec_campanas").select("id, codigo, nombre, rubrica").eq("activa", true);
  const campanas = activas ?? [];
  const out: any = { revisadas: 0, puntuadas: 0, siguen_pendientes: 0, sin_archivo: 0, detalle: [] };
  if (campanas.length === 0) return { ...out, error: "sin campanas activas" };

  const { data: pend } = await supabase.from("cv_postulaciones")
    .select("id, cv_filename, cuerpo_correo, archivo_url, cv_drive_id")
    .eq("bandera", PENDIENTE).order("id").limit(limite);

  for (const cv of pend ?? []) {
    if (Date.now() - t0 > PRESUPUESTO_MS) break;
    out.revisadas++;
    const arch = await descargarCv(supabase, cv);
    if (!arch) {
      out.sin_archivo++; out.siguen_pendientes++;
      out.detalle.push({ id: cv.id, estado: "sin_archivo" });
      continue;
    }
    if (arch.bytes.length > MAX_BYTES) {
      out.siguen_pendientes++;
      out.detalle.push({ id: cv.id, estado: "archivo_grande", mb: Math.round(arch.bytes.length / 1e6) });
      continue;
    }
    try {
      const { parsed, campana, banderaExtra } = await puntuarCv(supabase, campanas, {
        asunto: null, cuerpo: cv.cuerpo_correo, pdfB64: bytesToB64(arch.bytes),
        filename: cv.cv_filename, mimeType: mimeDe(cv.cv_filename), codigoFallback: null,
      });
      const upd: any = {
        campana_id: campana.id, perfil: parsed.perfil ?? "indefinido", puntaje: parsed.puntaje ?? 0,
        bandera: [parsed.bandera, banderaExtra].filter(Boolean).join(" | ") || null,
        pretension_bs: parsed.pretension_bs ?? null, resumen: parsed.resumen ?? null,
        procesado_en: new Date().toISOString(),
      };
      if (parsed.nombre) upd.nombre = parsed.nombre;
      if (parsed.telefono) upd.telefono = parsed.telefono;
      if (parsed.email) upd.email = parsed.email;
      if (parsed.ciudad) upd.ciudad = parsed.ciudad;
      if (parsed.anos_obra != null) upd.anos_obra = parsed.anos_obra;
      if (parsed.ejecuto_obra != null) upd.ejecuto_obra = parsed.ejecuto_obra;
      const { error: upErr } = await supabase.from("cv_postulaciones")
        .update(upd).eq("id", cv.id).eq("bandera", PENDIENTE);
      if (upErr) throw new Error("update_fail: " + upErr.message);
      dispararAnalisis(cv.id);
      out.puntuadas++;
      out.detalle.push({ id: cv.id, estado: "ok", via: arch.via, puntaje: upd.puntaje, campana: campana.codigo });
    } catch (e) {
      out.siguen_pendientes++;
      out.detalle.push({ id: cv.id, estado: "fallo", motivo: String(e).slice(0, 200) });
    }
  }
  const { count } = await supabase.from("cv_postulaciones")
    .select("id", { count: "exact", head: true }).eq("bandera", PENDIENTE);
  out.pendientes_total = count ?? 0;
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    if (SHARED_SECRET && req.headers.get("x-geat-secret") !== SHARED_SECRET) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const body = await req.json();

    // v9: reintento de las filas pendiente_analisis (lo llama geat-cv-cron)
    if (body.accion === "reintentar_pendientes") {
      const limite = Math.min(Math.max(Number(body.limite) || 5, 1), 10);
      const r = await reintentarPendientes(createClient(SUPABASE_URL, SERVICE_ROLE), limite);
      return new Response(JSON.stringify({ ok: true, ...r }), {
        headers: { ...cors, "Content-Type": "application/json" } });
    }
    const { gmail_message_id, pdf_base64, filename, cuerpo_correo, codigo_campana, mime, solo_archivo, asunto } = body;

    if (!gmail_message_id) {
      return new Response(JSON.stringify({ error: "falta gmail_message_id" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const mimeType = mime || "application/pdf";
    const tieneArchivo = !!pdf_base64;

    if (solo_archivo) {
      if (!tieneArchivo) return new Response(JSON.stringify({ error: "sin archivo" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      const url = await subirArchivo(supabase, gmail_message_id, filename || "cv.pdf", pdf_base64, mimeType);
      if (url) {
        await supabase.from("cv_postulaciones").update({ archivo_url: url }).eq("gmail_message_id", gmail_message_id);
        return new Response(JSON.stringify({ status: "archivo_ok", url }), {
          headers: { ...cors, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ status: "archivo_fail" }), {
        status: 502, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const { data: existente } = await supabase
      .from("cv_postulaciones").select("id").eq("gmail_message_id", gmail_message_id).maybeSingle();
    if (existente) {
      return new Response(JSON.stringify({ status: "ya_procesado", id: existente.id }), {
        headers: { ...cors, "Content-Type": "application/json" } });
    }

    // v8: cargar TODAS las campanas activas
    const { data: activas } = await supabase
      .from("rec_campanas").select("id, codigo, nombre, rubrica").eq("activa", true);
    const campanas = activas ?? [];

    const archivoUrl = tieneArchivo ? await subirArchivo(supabase, gmail_message_id, filename || "cv.pdf", pdf_base64, mimeType) : null;

    if (campanas.length === 0) {
      const { data: ins } = await supabase
        .from("cv_postulaciones").insert({
          gmail_message_id, cv_filename: filename ?? null, cuerpo_correo: cuerpo_correo ?? null,
          archivo_url: archivoUrl, perfil: "indefinido", puntaje: 0, estado: "sin_clasificar",
          bandera: "sin campanas activas",
          procesado_en: new Date().toISOString(),
        }).select("id").single();
      return new Response(JSON.stringify({ status: "sin_clasificar", id: ins?.id }), {
        headers: { ...cors, "Content-Type": "application/json" } });
    }

    // v9: si OpenAI falla (HTTP, red, timeout, JSON roto) la fila IGUAL se inserta con
    // puntaje null y bandera 'pendiente_analisis'; geat-cv-cron la reintenta despues.
    let ev: { parsed: any; campana: any; banderaExtra: string | null };
    try {
      ev = await puntuarCv(supabase, campanas, {
        asunto: asunto ?? null, cuerpo: cuerpo_correo ?? null, pdfB64: tieneArchivo ? pdf_base64 : null,
        filename: filename ?? null, mimeType, codigoFallback: codigo_campana ?? null,
        simularFallo: body.simular_fallo_openai === true,
      });
    } catch (e) {
      const motivo = String(e).slice(0, 300);
      const { data: pend, error: pErr } = await supabase
        .from("cv_postulaciones").insert({
          gmail_message_id, campana_id: campanas.length === 1 ? campanas[0].id : null,
          cv_filename: filename ?? null, cuerpo_correo: cuerpo_correo ?? null,
          archivo_url: archivoUrl, perfil: "indefinido", puntaje: null, estado: "nuevo",
          bandera: PENDIENTE,
          resumen: `Pendiente de analisis automatico (${motivo.slice(0, 120)}). Se reintenta solo.`,
          procesado_en: new Date().toISOString(),
        }).select("id").single();
      if (pErr) {
        return new Response(JSON.stringify({ error: "insert_fail", detail: pErr.message, motivo }), {
          status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ status: PENDIENTE, id: pend?.id, motivo, archivo: !!archivoUrl }), {
        headers: { ...cors, "Content-Type": "application/json" } });
    }
    const { parsed, campana, banderaExtra } = ev;

    const banderaFinal = [parsed.bandera, banderaExtra, (!tieneArchivo && !parsed.bandera) ? "sin CV adjunto" : null]
      .filter(Boolean).join(" | ") || null;

    const { data: inserted, error: insErr } = await supabase
      .from("cv_postulaciones").insert({
        gmail_message_id, campana_id: campana.id,
        nombre: parsed.nombre ?? null, email: parsed.email ?? null, telefono: parsed.telefono ?? null,
        ciudad: parsed.ciudad ?? null, anos_obra: parsed.anos_obra ?? null,
        ejecuto_obra: parsed.ejecuto_obra ?? null, perfil: parsed.perfil ?? "indefinido",
        puntaje: parsed.puntaje ?? 0,
        bandera: banderaFinal,
        pretension_bs: parsed.pretension_bs ?? null, resumen: parsed.resumen ?? null,
        cv_filename: filename ?? null, cuerpo_correo: cuerpo_correo ?? null,
        archivo_url: archivoUrl, estado: "nuevo", procesado_en: new Date().toISOString(),
      }).select("id, nombre, puntaje, campana_id").single();

    if (insErr) {
      return new Response(JSON.stringify({ error: "insert_fail", detail: insErr.message }), {
        status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    }

    dispararAnalisis(inserted?.id);

    return new Response(JSON.stringify({ status: "ok", ...inserted, campana: campana.codigo, archivo: !!archivoUrl }), {
      headers: { ...cors, "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ error: "server_error", detail: String(e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
