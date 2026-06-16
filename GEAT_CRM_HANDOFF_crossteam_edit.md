# GEAT CRM v51 — Handoff Claude Code: Devolver edición cross-team a cerradores

**Fecha:** 29/05/2026
**Archivo objetivo:** `index_v51.html` (NO `index.html` — ese es v50 producción, NO TOCAR)
**Repo:** `joseio313/Geat-visitas`, branch `main`
**Decisión del CEO (aprobada):** Gustavo Vaca y David Gambarte (rol `commercial_lead`) deben poder **editar y guardar** seguimientos/actividades en leads de TODO el equipo, no solo en los suyos. Hoy el frontend los fuerza a "solo lectura" en leads ajenos — fue efecto colateral de darle lectura cross-team a David en la ronda 6.

---

## 0. ANTES DE EMPEZAR (obligatorio)

```
git pull origin main
```
Confirmá que tenés el último commit (debería ser e95af27 o posterior). Trabajá sobre `index_v51.html`.

---

## 1. LA CAUSA (diagnóstico ya hecho, no re-investigar)

- El backend (Supabase) está **sano**. Se reprodujo la secuencia completa de guardado sobre un lead histórico real y guarda sin error. **No toques la base.**
- RLS de `leads` está abierto (`qual=true`), así que **NO es un problema de permisos de base de datos.**
- El bloqueo es **puramente frontend**: una guarda fuerza modo `'readonly'` cuando un `commercial_lead` abre la actividad de otra persona.

## 2. EL CAMBIO EXACTO

Buscá esta línea (está en la función que renderiza las tarjetas de actividad de la agenda; ubicá por patrón, no por número de línea porque puede haber corrido):

```bash
grep -n "_xMode" index_v51.html
```

**Vas a encontrar algo como:**
```js
const _xMode=cu&&cu.rol==='commercial_lead'&&a.colaborador!==cu.nombre?'\'readonly\'':'';
```

**Reemplazalo por:**
```js
const _xMode=''; // Cross-team edit habilitado para cerradores (Gustavo/David) — decisión CEO 29/05/2026
```

**Por qué así:** esto hace que al tocar una actividad desde la agenda, SIEMPRE se abra en modo operativo (editable). La consulta de solo lectura sigue disponible aparte vía el botón 🔍 (`openLeadReadOnly`), así que no se pierde el modo lectura para quien solo quiere mirar.

## 3. NO HACE FALTA TOCAR NADA MÁS

- `saveSeguimiento()` NO chequea readonly — una vez que el lead abre en modo normal, el guardado funciona.
- La auditoría ya está activa: el trigger `trg_auditoria_lead` registra cada edición de lead (quién/cuándo). No hay que agregar nada para auditar.

## 4. DEPLOY

Subí `index_v51.html` actualizado a `main` (drag-and-drop en el editor web de GitHub, como siempre). Esperá ~1 min a que GitHub Pages publique.

## 5. VALIDACIÓN (sin esto NO está hecho)

1. Abrí `https://joseio313.github.io/Geat-visitas/index_v51.html` con **Ctrl+Shift+R** (refresco forzado, para evitar caché).
2. Entrá con el PIN de Gustavo (4454).
3. Abrí desde su agenda una actividad de un lead **captado por Genoveva o por otra persona** (ej. un lead histórico que ya vino a visita).
4. Confirmá que **NO** aparece el banner "👁️ Modo consulta — solo lectura" y que el botón "💾 Guardar seguimiento" **persiste el cambio**.
5. **Screenshot post-deploy** del seguimiento guardado en un lead ajeno → eso cierra el ticket.

---

## NOTA (para después, NO ahora)
Hay un tema de caché del navegador: el equipo a veces ve versiones viejas del CRM hasta que hacen refresco forzado. Existe una solución de una sola vez (versionado de assets / cache-busting) para que las actualizaciones lleguen solas. Queda fuera de este handoff — pendiente de decisión del CEO.
