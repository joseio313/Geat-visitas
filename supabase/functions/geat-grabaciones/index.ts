// Edge Function: geat-grabaciones (v3) — GEAT v279a
//
// POR QUE EXISTE: public.grabaciones tenia RLS con policies `true` para el rol
// publico: con la anon key (que viaja en el HTML) cualquiera leia, modificaba y
// borraba todas las grabaciones y transcripciones. El token de geat-auth es un
// HMAC propio, no un JWT de Supabase, asi que Postgres no puede aplicar reglas
// por usuario. El patron es el de geat-montos / geat-cobranzas: el front manda
// el token, esta funcion lo revalida y recien ahi toca la tabla con service_role.
//
// El front arma la consulta con un constructor que imita a supabase-js
// (index.html: gb()), y aca se ejecuta con LISTA BLANCA de columnas, operadores
// y operaciones, y con el filtro de visibilidad pegado SIEMPRE del lado servidor
// (ver logica.ts). Nada de lo que mande el cliente puede saltearlo.
//
// Solo cubre la TABLA. El storage del bucket "grabaciones" sigue como estaba.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  Err, exprPropias, exprVisible, modoEscritura, validarCols, validarFiltros, validarLimite,
  validarOrden, validarValores,
} from "./logica.ts";
import type { Filtro, Usuario } from "./logica.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TABLA = "grabaciones";
const PAGINA = 1000;
const TOPE_FILAS = 5000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: any, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

/* ═══ Sesion (mismo token que geat-auth: id.exp.firma HMAC con la service key) ═══ */
let _hmac: CryptoKey | null = null;
async function hmacKey(): Promise<CryptoKey> {
  if (!_hmac) {
    _hmac = await crypto.subtle.importKey("raw", new TextEncoder().encode(SERVICE_ROLE),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  }
  return _hmac;
}
async function firmar(p: string): Promise<string> {
  const s = await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(p));
  return btoa(String.fromCharCode(...new Uint8Array(s)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function validarToken(sb: any, token: string): Promise<Usuario | null> {
  const p = String(token || "").split(".");
  if (p.length !== 3) return null;
  const [id, exp, sig] = p;
  if (!/^\d+$/.test(id) || Date.now() > Number(exp)) return null;
  if (await firmar(id + "." + exp) !== sig) return null;
  const { data } = await sb.from("colaboradores").select("id,nombre,rol,activo,es_socio")
    .eq("id", Number(id)).eq("activo", true).maybeSingle();
  return data || null;
}

/* ═══ Consultas ═══ */
function aplicarFiltros(qb: any, filtros: Filtro[]) {
  for (const f of filtros) {
    if (f.op === "eq") qb = qb.eq(f.col, f.val);
    else if (f.op === "neq") qb = qb.neq(f.col, f.val);
    else if (f.op === "gte") qb = qb.gte(f.col, f.val);
    else if (f.op === "lte") qb = qb.lte(f.col, f.val);
    else if (f.op === "in") qb = qb.in(f.col, f.val);
    else if (f.op === "is") qb = qb.is(f.col, f.val);
    else if (f.op === "not_is") qb = qb.not(f.col, "is", f.val);
    else if (f.op === "not_in") {
      qb = qb.not(f.col, "in", "(" + f.val.map((x: any) => '"' + String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"').join(",") + ")");
    }
  }
  return qb;
}

async function nombresAdmin(sb: any): Promise<string[]> {
  const { data } = await sb.from("colaboradores").select("nombre").eq("rol", "admin");
  return (data || []).map((r: any) => r.nombre).filter(Boolean);
}

function errDb(e: any): Err {
  return new Err(String(e?.message || "error de base"), 500, String(e?.code || "GRAB_DB"));
}

async function ejecutar(sb: any, u: Usuario, b: any) {
  const op = String(b.op || "");
  const filtros = validarFiltros(b.filters);
  const admins = u.rol === "commercial_lead" ? await nombresAdmin(sb) : [];

  if (op === "select") {
    const cols = validarCols(b.cols);
    const orden = validarOrden(b.order);
    const limite = validarLimite(b.limit);
    const head = b.head === true;
    const contar = b.count === "exact";
    const vis = exprVisible(u, admins);

    const armar = () => {
      let qb = sb.from(TABLA).select(cols, contar || head ? { count: "exact", head } : undefined);
      qb = aplicarFiltros(qb, filtros).or(vis);
      for (const o of orden) qb = qb.order(o.col, { ascending: o.asc });
      if (!orden.length) qb = qb.order("id", { ascending: true }); // orden estable para paginar
      return qb;
    };

    if (head) {
      const { count, error } = await armar();
      if (error) throw errDb(error);
      return { count: count ?? 0 };
    }
    let filas: any[] = [];
    let total: number | null = null;
    if (limite) {
      const { data, error, count } = await armar().limit(limite);
      if (error) throw errDb(error);
      filas = data || [];
      total = count ?? null;
    } else {
      // PostgREST corta en 1000: se pagina para no truncar en silencio.
      for (let desde = 0; desde < TOPE_FILAS; desde += PAGINA) {
        const { data, error, count } = await armar().range(desde, desde + PAGINA - 1);
        if (error) throw errDb(error);
        if (total === null) total = count ?? null;
        filas = filas.concat(data || []);
        if (!data || data.length < PAGINA) break;
      }
    }
    if (b.single === "one") {
      if (filas.length !== 1) throw new Err("Sin fila unica", 406, "PGRST116");
      return { data: filas[0], count: total };
    }
    if (b.single === "maybe") {
      if (filas.length > 1) throw new Err("Mas de una fila", 406, "PGRST116");
      return { data: filas[0] || null, count: total };
    }
    return { data: filas, count: total };
  }

  if (op === "insert") {
    const vals = validarValores("insert", b.values);
    const fila = { ...vals, colaborador: u.nombre }; // el autor SIEMPRE es el del token
    const ret = b.ret ? validarCols(b.ret) : "id";
    const { data, error } = await sb.from(TABLA).insert(fila).select(ret);
    if (error) throw errDb(error);
    const rows = data || [];
    if (b.single) return { data: rows[0] || null, n: rows.length };
    return { data: b.ret ? rows : null, n: rows.length };
  }

  if (op === "update" || op === "delete") {
    if (!filtros.length) throw new Err("update/delete sin filtro no se permite", 403, "GRAB_SIN_FILTRO");
    const vals = op === "update" ? validarValores("update", b.values) : null;
    const modo = modoEscritura(u, op, vals ? Object.keys(vals) : []);
    const pred = modo === "visible" ? exprVisible(u, admins) : exprPropias(u);
    const ret = b.ret ? validarCols(b.ret) : "id";
    let qb = op === "update" ? sb.from(TABLA).update(vals) : sb.from(TABLA).delete();
    qb = aplicarFiltros(qb, filtros).or(pred).select(ret);
    const { data, error } = await qb;
    if (error) throw errDb(error);
    const rows = data || [];
    return { data: b.ret ? rows : null, n: rows.length };
  }

  throw new Err("op desconocida: " + op);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let b: any;
  try { b = await req.json(); } catch { return json({ ok: false, error: "JSON invalido" }, 400); }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
  try {
    const u = await validarToken(sb, String(b?.token || ""));
    if (!u) return json({ ok: false, error: "sesion invalida", code: "GRAB_SESION" }, 401);

    const r = await ejecutar(sb, u, b);
    // Sin contenido, sin nombres: solo quien, con que version del front y que operacion.
    console.log(JSON.stringify({ gb: 1, u: u.id, rol: u.rol, v: b.ver ?? null, op: b.op, n: r.n ?? (Array.isArray(r.data) ? r.data.length : r.count ?? null) }));
    return json({ ok: true, ...r });
  } catch (e) {
    // Un rechazo por regla (403/400) queda en el log con el codigo y el mensaje, SIN valores.
    if (e instanceof Err) {
      console.log(JSON.stringify({ gb: 1, err: e.code, st: e.status, msg: e.message.slice(0, 120), op: b?.op ?? null, v: b?.ver ?? null }));
      return json({ ok: false, error: e.message, code: e.code }, e.status);
    }
    return json({ ok: false, error: String((e as Error)?.message || e), code: "GRAB_500" }, 500);
  }
});
