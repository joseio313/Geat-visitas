// geat-grabaciones · reglas puras (sin red ni base), para poder probarlas con Node.
//
// QUIEN VE QUE (v279):
//   admin            -> todas las que NO son privadas + las suyas (privadas incluidas)
//   commercial_lead  -> las suyas + las comerciales de OTROS que no son de un admin
//                       (comercial = contexto 'venta' o ligada a un lead)
//   el resto         -> solo las suyas
//   privada=true     -> SOLO su autor. Ni admin ni commercial_lead.
//
// Para que commercial_lead tambien vea las comerciales del admin (el CEO), cambiar
// COMERCIAL_VE_ADMIN a true. Esta en false a proposito: hasta v278 el panel le
// ocultaba lo del admin, y abrirlo es una decision del CEO, no un default.

export const COMERCIAL_VE_ADMIN = false;

// Lo que el front puede LEER. Fuera las columnas internas de sincronizacion
// (sheet_*, drive_renombrado_at): las escriben otras Edge Functions.
export const COLS_LEER = [
  "id", "colaborador", "titulo", "audio_path", "transcripcion", "resumen", "duracion_seg",
  "lead_id", "estado", "created_at", "activo", "extraccion", "lead_creado_id", "participantes",
  "contexto", "conservar_audio", "audio_drive_url", "audio_drive_id", "audio_movido_at",
  "mencionados", "privada",
];
// Lo que el front puede MODIFICAR. `colaborador` y `id` nunca: el autor no se cambia.
export const COLS_ACTUALIZAR = [
  "titulo", "audio_path", "transcripcion", "resumen", "duracion_seg", "lead_id", "estado",
  "extraccion", "lead_creado_id", "participantes", "contexto", "conservar_audio", "activo", "privada",
];
// Lo que el front puede mandar al CREAR. `colaborador` lo pone el servidor con el nombre del token.
export const COLS_INSERTAR = ["titulo", "participantes", "lead_id", "estado", "created_at", "privada"];

export class Err extends Error {
  status: number;
  code: string;
  constructor(msg: string, status = 400, code = "GRAB_400") {
    super(msg);
    this.status = status;
    this.code = code;
  }
}

export type Usuario = { id: number; nombre: string; rol: string; es_socio?: boolean };
export type Filtro = { op: string; col: string; val: any };

const OPS = new Set(["eq", "neq", "gte", "lte", "in", "is", "not_is", "not_in"]);
const prim = (v: any) => v === null || ["string", "number", "boolean"].includes(typeof v);

export function validarCols(c: any): string {
  if (c === undefined || c === null || c === "*") return COLS_LEER.join(",");
  const lista = String(c).split(",").map((s) => s.trim()).filter(Boolean);
  if (!lista.length || lista.some((x) => !COLS_LEER.includes(x))) {
    throw new Err("columna no permitida en select");
  }
  return lista.join(",");
}

export function validarFiltros(raw: any): Filtro[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 20) throw new Err("filtros invalidos");
  return raw.map((f: any) => {
    if (!f || typeof f !== "object") throw new Err("filtro invalido");
    const op = String(f.op);
    const col = String(f.col);
    if (!OPS.has(op)) throw new Err("operador no permitido: " + op);
    if (!COLS_LEER.includes(col)) throw new Err("columna no permitida: " + col);
    const val = f.val;
    if (op === "in" || op === "not_in") {
      if (!Array.isArray(val) || val.length > 500 || !val.every(prim)) throw new Err("lista invalida en filtro");
    } else if (op === "is" || op === "not_is") {
      if (!(val === null || typeof val === "boolean")) throw new Err("is solo admite null, true o false");
    } else if (!prim(val) || (typeof val === "string" && val.length > 2000)) {
      throw new Err("valor invalido en filtro");
    }
    return { op, col, val };
  });
}

export function validarOrden(raw: any): { col: string; asc: boolean }[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 3) throw new Err("orden invalido");
  return raw.map((o: any) => {
    const col = String(o && o.col);
    if (!COLS_LEER.includes(col)) throw new Err("columna no permitida en order");
    return { col, asc: o.asc !== false };
  });
}

export function validarLimite(raw: any): number | null {
  if (raw === undefined || raw === null) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 5000) throw new Err("limit invalido");
  return n;
}

export function validarValores(op: "insert" | "update", v: any): Record<string, any> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Err("values invalido");
  const permitidas = op === "insert" ? COLS_INSERTAR : COLS_ACTUALIZAR;
  const keys = Object.keys(v);
  if (!keys.length) throw new Err("values vacio");
  const out: Record<string, any> = {};
  for (const k of keys) {
    if (!permitidas.includes(k)) throw new Err("columna no permitida en " + op + ": " + k, 403, "GRAB_COL");
    const x = v[k];
    if (k === "extraccion") {
      if (!(x === null || typeof x === "object")) throw new Err("extraccion debe ser objeto");
    } else if (!prim(x)) {
      throw new Err("valor invalido para " + k);
    }
    if (["privada", "activo", "conservar_audio"].includes(k) && typeof x !== "boolean") {
      throw new Err(k + " debe ser booleano");
    }
    if (k === "created_at" && x !== null && Number.isNaN(Date.parse(String(x)))) {
      throw new Err("created_at invalido");
    }
    out[k] = x;
  }
  return out;
}

// Comillas para PostgREST dentro de or()/and(): nombres con acentos, espacios o comas.
const q = (s: any) => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
export const quote = q;

export function exprPropias(u: Usuario): string {
  if (!u || !u.nombre) throw new Err("sesion sin nombre", 403, "GRAB_SESION");
  return `colaborador.eq.${q(u.nombre)}`;
}

// Argumento de .or() que deja pasar solo lo que `u` puede VER.
export function exprVisible(u: Usuario, nombresAdmin: string[]): string {
  const propias = exprPropias(u);
  if (u.rol === "admin") return `privada.eq.false,${propias}`;
  if (u.rol === "commercial_lead") {
    const sinAdmin = (!COMERCIAL_VE_ADMIN && nombresAdmin.length)
      ? `,colaborador.not.in.(${nombresAdmin.map(q).join(",")})`
      : "";
    return `${propias},and(privada.eq.false,or(contexto.eq.venta,lead_id.not.is.null,lead_creado_id.not.is.null)${sinAdmin})`;
  }
  return propias;
}

// Sobre que filas puede ESCRIBIR. "visible" = las que ve; "propias" = solo las suyas.
export function modoEscritura(u: Usuario, op: "update" | "delete", keys: string[]): "visible" | "propias" {
  if (op === "update" && keys.includes("privada")) return "propias"; // la privacidad la cambia solo el autor
  if (u.rol === "admin") return "visible";
  if (op === "update" && u.rol === "commercial_lead" && keys.length > 0 &&
      keys.every((k) => k === "lead_creado_id" || k === "lead_id")) return "visible"; // vincular un lead a una grabacion comercial
  return "propias";
}
