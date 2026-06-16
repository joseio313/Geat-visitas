# ORDEN — CRM v51 · RONDA 3

**Autor:** Josemiguel Gambarte (CEO GEAT)
**Fecha:** 22 mayo 2026
**Destinatario:** Claude Code
**Modo:** AUTÓNOMO — ejecutar todo de corrido, sin pedir permisos

---

## 🔒 REGLAS

1. NO me pidas permiso. Ejecutá todo el plan completo.
2. SOLO modificás `index_v51.html`. NO toques `index.html` (v50 producción).
3. SÍ podés ejecutar SQL en Supabase MCP (`jsacnpgpnvoslrpurfxc`) — EXCEPTO DELETE/DROP/TRUNCATE.
4. SÍ podés crear ALTER TABLE ADD COLUMN IF NOT EXISTS + crear índices UNIQUE.
5. Reportá al final con before/after de cada cambio.

---

## 📊 ESTADO ACTUAL DE SUPABASE (verificado el 22/05/2026)

- 5,437 leads totales
- 72 actividades en agenda_personal (ya limpio, 0 duplicados — Josemiguel borró 27 duplicados manualmente vía MCP)
- 21 seguimientos (0 duplicados — Josemiguel borró 1 duplicado vía MCP)
- Columnas reales de `leads`: `id, nombre, celular, ciudad, captador` (NO captador_id, es TEXT con el nombre)
- Columnas reales de `seguimientos`: `lead_id, etapa, tipo, medio, colaborador, estado, numero_seguimiento, fecha_seguimiento, completado_en, nota_previa, nota_resultado, created_at`
- Columnas reales de `agenda_personal`: `id, colaborador, lead_id, tipo, titulo, nota, fecha_programada, completada, activo, created_at`

---

## 🎯 LOS 7 CAMBIOS DE ESTA RONDA

### CAMBIO 1 — Anti-duplicado: 3 capas de defensa (CRÍTICO)

**Problema:** Gustavo reportó que al tocar "Guardar seguimiento" el sistema tarda y si toca de nuevo crea duplicados. Confirmado: había 27 duplicados en agenda_personal y 1 en seguimientos antes de la limpieza de Josemiguel. Hay que impedir que vuelvan a aparecer.

#### 1.A — Capa Frontend: Botón deshabilitado durante guardado

En TODOS los botones que hacen INSERT a Supabase (guardar seguimiento, crear lead, finalizar, programar siguiente, marcar ganado, marcar perdido), aplicar este patrón:

```javascript
async function guardarSeguimiento(formData) {
  const btn = document.getElementById('btn-guardar-seg');
  if (btn.disabled) return;  // ya está procesando
  
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.style.opacity = '0.6';
  btn.style.cursor = 'not-allowed';
  btn.innerHTML = '⏳ Guardando...';
  
  try {
    const { data, error } = await supabase
      .from('seguimientos')
      .insert(formData);
    
    if (error) throw error;
    
    btn.innerHTML = '✅ Guardado';
    setTimeout(() => closeModal(), 800);
  } catch (err) {
    btn.innerHTML = originalText;
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
    alert('Error al guardar: ' + err.message);
  }
}
```

Aplicar el mismo patrón a:
- Botón "💾 Guardar seguimiento" en modal Finalizar
- Botón "💾 Crear lead" en modal Crear Lead
- Botón "💾 Guardar y programar 1er intento"
- Botón "🏆 Marcar como ganado"
- Botón "❌ Marcar como perdido"

#### 1.B — Capa Frontend: Lock de deduplicación en memoria

Crear un objeto global que registre los últimos requests enviados y bloquee duplicados en ventana de 5 segundos:

```javascript
const _antiDupLock = new Map();

function checkDupLock(key) {
  const now = Date.now();
  const lastRequest = _antiDupLock.get(key);
  if (lastRequest && (now - lastRequest) < 5000) {
    console.warn('Bloqueado por anti-duplicado:', key);
    return false; // bloqueado
  }
  _antiDupLock.set(key, now);
  // limpiar entradas viejas
  for (const [k, v] of _antiDupLock) {
    if (now - v > 10000) _antiDupLock.delete(k);
  }
  return true; // OK proceder
}

// Uso antes del INSERT:
const lockKey = `seg-${leadId}-${etapa}-${colaborador}`;
if (!checkDupLock(lockKey)) {
  alert('Ya se está guardando este seguimiento. Esperá unos segundos.');
  return;
}
```

#### 1.C — Capa Backend: Índice único en Supabase

Ejecutar esta migración idempotente (la columna ya existe, solo agregar el índice):

```sql
-- Índice anti-duplicado en agenda_personal:
-- Bloquea inserts de la misma actividad (mismo lead, mismo tipo, mismo colaborador)
-- en la misma fecha programada
CREATE UNIQUE INDEX IF NOT EXISTS idx_agenda_no_dup 
ON agenda_personal (lead_id, tipo, colaborador, fecha_programada)
WHERE lead_id IS NOT NULL AND activo = true;

-- Índice anti-duplicado en seguimientos:
-- Bloquea inserts del mismo seguimiento (mismo lead, misma etapa, mismo colaborador, 
-- misma fecha de programación)
CREATE UNIQUE INDEX IF NOT EXISTS idx_seg_no_dup 
ON seguimientos (lead_id, etapa, colaborador, fecha_seguimiento);
```

Si el INSERT viola el índice, Supabase devuelve error 23505 (unique violation). En ese caso el frontend debe mostrar:

```javascript
if (error.code === '23505') {
  alert('Esta actividad ya está registrada. No se crearon duplicados.');
} else {
  alert('Error: ' + error.message);
}
```

---

### CAMBIO 2 — Nueva Oportunidad: NO debe pasar directo a la agenda

**Problema reportado por Gustavo:**
> "Al crear nueva oportunidad en este momento uno da clic al contacto y directo lo pasa a la agenda del día, no quisiéramos eso. Lo ideal es que uno de click al contacto y salga el perfil de cliente con seguimientos realizados anteriormente, con número, ciudad, como viendo el seguimiento y también abajo que salga programar nuevo seguimiento para reactivar ese cliente."

**Solución:**

Cuando el usuario hace clic en un lead perdido desde "Nueva Oportunidad":

1. NO crear actividad en agenda automáticamente
2. NO cambiar estado del lead todavía
3. ABRIR el modal de detalle del lead (mismo modal que se usa al tocar una tarjeta del calendario), mostrando:
   - PERFIL DEL CLIENTE (nombre, celular, ciudad, medio difusión, fecha de registro original)
   - VIAJE DEL CLIENTE (todos los seguimientos previos con notas)
   - INDAGACIÓN previa
   - Al pie del modal: bloque destacado "♻️ REACTIVAR ESTE CLIENTE" con formulario para programar nuevo seguimiento (etapa, fecha, hora, nota)
4. RECIÉN cuando el usuario confirma "📅 Reactivar y agendar" → ahí sí se cambia estado a "nuevo" o "en_seguimiento", se asigna al usuario actual como captador, y se crea la primera actividad en agenda_personal

---

### CAMBIO 3 — Búsqueda inteligente multi-campo

**Problema reportado por Gustavo:**
> "Cuando se busca por número no sale en nueva oportunidad. Por ejemplo ese número de la imagen ya estaba registrado y no sale, solo por nombre deja buscar. Lo ideal es por número sí o sí. Además, poder filtrar por número, nombre, apellido, ciudad y toda información similar a la que se esté buscando."

**Solución:**

En el modal de "Nueva Oportunidad" Y "Buscar Lead", el buscador debe ser **un solo input universal** que filtre por COINCIDENCIA PARCIAL en TODOS estos campos a la vez:

- `nombre` (cubre nombre y apellido — ej: "Quispe", "García", "Flía Suárez")
- `celular` (números completos o parciales — ej: "78912" o "78912345")
- `ciudad` (ej: "Santa Cruz", "Cocha", "Warnes")
- `medio_difusion` (ej: "Facebook", "Tiktok")
- `nota_inicial` (texto libre con detalles del cliente)
- `captador` (ej: "Diana", "Steffi") — solo si el usuario actual es admin

```javascript
async function buscarLeadInteligente(queryText) {
  const q = queryText.trim().toLowerCase();
  if (q.length < 2) return [];  // mínimo 2 caracteres para evitar ruido
  
  const esAdmin = userRol === 'admin' || userRol === 'commercial_lead';
  
  // Construir el OR multi-campo
  let orConditions = [
    `nombre.ilike.%${q}%`,
    `celular.ilike.%${q}%`,
    `ciudad.ilike.%${q}%`,
    `medio_difusion.ilike.%${q}%`,
    `nota_inicial.ilike.%${q}%`
  ];
  
  // Solo admin puede buscar por captador
  if (esAdmin) {
    orConditions.push(`captador.ilike.%${q}%`);
  }
  
  let query = supabase
    .from('leads')
    .select('id, nombre, celular, ciudad, medio_difusion, captador, estado, created_at, nota_inicial')
    .or(orConditions.join(','))
    .order('created_at', { ascending: false })
    .limit(50);
  
  // Si NO es admin, además filtrar para mostrar solo SUS leads
  // (aplica al buscador, no al perfil de cliente)
  if (!esAdmin) {
    query = query.eq('captador', userName);
  }
  
  const { data, error } = await query;
  if (error) {
    console.error('Error buscando:', error);
    return [];
  }
  return data;
}
```

**Mostrar en cada resultado qué campo coincidió** (mejor UX):

```javascript
function resaltarCoincidencia(lead, query) {
  const q = query.toLowerCase();
  const matches = [];
  
  if (lead.nombre?.toLowerCase().includes(q)) matches.push('nombre');
  if (lead.celular?.includes(q)) matches.push('celular');
  if (lead.ciudad?.toLowerCase().includes(q)) matches.push('ciudad');
  if (lead.medio_difusion?.toLowerCase().includes(q)) matches.push('medio');
  if (lead.captador?.toLowerCase().includes(q)) matches.push('captador');
  if (lead.nota_inicial?.toLowerCase().includes(q)) matches.push('nota');
  
  return matches; // ej: ['nombre', 'ciudad'] si coincide en ambos
}

// En el render del resultado:
// "Flía Quispe Mamani · 78912345 · Santa Cruz"
// Coincidencia por: nombre, celular
```

**UX adicional — sugerencias en tiempo real (autocompletar):**

A medida que el usuario va escribiendo, mostrar resultados con `debounce` de 300ms (para no saturar Supabase con cada tecla):

```javascript
let searchTimer;
inputSearch.addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const value = e.target.value;
  searchTimer = setTimeout(async () => {
    if (value.length < 2) {
      renderResults([]);
      return;
    }
    const results = await buscarLeadInteligente(value);
    renderResults(results, value);
  }, 300);
});
```

**Quitar cualquier validación previa que limite la búsqueda a un solo campo o que rechace entradas numéricas/alfanuméricas mezcladas.**

**Casos de prueba que debe pasar:**

| Input usuario | Esperado encuentre |
|---|---|
| `Quispe` | Todos los leads con apellido Quispe |
| `78912` | Leads con celular que contenga 78912 |
| `78912345` | El lead exacto con ese celular |
| `Santa Cruz` | Todos los leads de Santa Cruz |
| `Facebook` | Todos los leads que vinieron por Facebook |
| `Diana` (siendo admin) | Todos los leads creados por Diana |
| `cocha` | Todos los leads de Cochabamba |
| `Suarez Ortiz` | Lead Flía Suárez Ortiz (búsqueda parcial de palabras) |

---

### CAMBIO 4 — "Buscar Lead" debe ser SOLO ver perfil, no crear oportunidad

**Problema reportado por Gustavo:**
> "Cuando le doy buscar lead, me vota a nueva oportunidad, lo cual no debería porque ya hay al lado nueva oportunidad. Lo ideal es que ahí busque a los contactos y solo deje ver el perfil con seguimientos o sin seguimientos anteriores y sin opción a crear una nueva oportunidad, solo que sea para ver."

**Solución:**

El modal "Buscar Lead" debe ser **distinto** del modal "Nueva Oportunidad":

- **Buscar Lead:** modo CONSULTA. Al tocar un resultado → abre el modal de detalle del lead en modo READ-ONLY. Sin botones de "Crear oportunidad" ni "Reactivar". Solo permite ver perfil, indagación, viaje del cliente, notas. Si el lead está abierto, mostrar al pie un botón "📋 Ir al lead activo" que cierra este modal y abre el modal real del lead. Si el lead está perdido/ganado, solo mostrar la información histórica.

- **Nueva Oportunidad:** modo REACTIVAR (lo del cambio 2).

Quitar cualquier redirección que actualmente lleve de "Buscar" a "Nueva Oportunidad".

---

### CAMBIO 5 — Lista cronológica de leads abajo del buscador con lupa/lápiz

**Problema reportado por Gustavo:**
> "De igual manera puede salir abajo por orden de horas los que se vayan creando como nombre de cada usuario, celular, ciudad, y que salga una lupita para ver y un lápiz para editar el perfil cuando se equivoquen."

**Solución:**

En el modal "Buscar Lead" (y también podría aparecer en Nueva Oportunidad), debajo del input de búsqueda, mostrar una **tabla cronológica** ordenada por fecha de creación DESCENDENTE:

```html
<table>
  <thead>
    <tr>
      <th>Fecha/Hora</th>
      <th>Captador</th>
      <th>Cliente</th>
      <th>Celular</th>
      <th>Ciudad</th>
      <th>Acciones</th>
    </tr>
  </thead>
  <tbody>
    <!-- Por cada lead -->
    <tr>
      <td>22/05 14:30</td>
      <td>Diana</td>
      <td>Flía Quispe Mamani</td>
      <td>78912345</td>
      <td>Santa Cruz</td>
      <td>
        <button title="Ver perfil" onclick="verPerfil(leadId)">🔍</button>
        <button title="Editar" onclick="editarLead(leadId)">✏️</button>
      </td>
    </tr>
  </tbody>
</table>
```

Si el usuario actual NO es admin (no es PIN 1024 ni 4454), filtrar para mostrar solo los leads que él creó (`WHERE captador = userName`).
Si el usuario actual ES admin, mostrar TODOS los leads.

El botón **✏️ Editar** abre un modal pequeño que permite corregir: nombre, celular, ciudad, medio_difusion. Al guardar, hace UPDATE en `leads` y registra una entrada en `auditoria_leads` con el cambio:

```javascript
async function editarLead(leadId, cambios) {
  // 1. Actualizar lead
  await supabase.from('leads').update(cambios).eq('id', leadId);
  
  // 2. Registrar auditoría (opcional pero recomendado)
  await supabase.from('auditoria_leads').insert({
    lead_id: leadId,
    accion: 'edicion_perfil',
    colaborador: userName,
    detalles: JSON.stringify(cambios),
    fecha: new Date().toISOString()
  });
}
```

---

### CAMBIO 6 — Exportar Excel desde el buscador con filtro de fechas

**Problema reportado por Gustavo:**
> "Fuera ideal que cuando se entre a buscar el lead, salga una opción de un reporte en Excel con fechas desde hasta, de todo lo creado por ese usuario, solo a los administradores que salga de todos los usuarios."

**Solución:**

Arriba de la tabla cronológica, agregar:

```html
<div class="filtro-export">
  <label>📅 Desde</label>
  <input type="date" id="exportFrom">
  <label>📅 Hasta</label>
  <input type="date" id="exportTo">
  <button onclick="exportarBusqueda()">📊 Exportar Excel</button>
</div>
```

Lógica del export:

```javascript
async function exportarBusqueda() {
  const desde = document.getElementById('exportFrom').value;
  const hasta = document.getElementById('exportTo').value;
  const esAdmin = userRol === 'admin' || userRol === 'commercial_lead';
  
  let query = supabase
    .from('leads')
    .select('id, nombre, celular, ciudad, medio_difusion, captador, estado, created_at')
    .gte('created_at', desde)
    .lte('created_at', hasta + 'T23:59:59')
    .order('created_at', { ascending: false });
  
  // Si NO es admin, filtrar solo lo que creó él
  if (!esAdmin) {
    query = query.eq('captador', userName);
  }
  
  const { data } = await query;
  
  const rows = data.map(l => ({
    'Fecha creación': new Date(l.created_at).toLocaleString('es-BO'),
    'Captador': l.captador,
    'Cliente': l.nombre,
    'Celular': l.celular,
    'Ciudad': l.ciudad,
    'Medio difusión': l.medio_difusion,
    'Estado': l.estado
  }));
  
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  XLSX.writeFile(wb, `GEAT_Leads_${desde}_a_${hasta}.xlsx`);
}
```

---

### CAMBIO 7 — Marcadores del día en el header de la agenda

**Problema reportado por Gustavo:**
> "Me gustaría en esa parte que se añada 3 marcaciones: ACTIVIDADES REALIZADAS DEL DIA: ej 30, ACTIVIDADES PENDIENTE DEL DIA: ej 50, ACTIVIDADES ATRASADAS: ej 10. Que contabilice un marcador del día arriba que tire el conteo de lo realizado o pendiente, esto para no estar contando uno por uno."

**Solución:**

Arriba de la grilla semanal/mensual, agregar un componente con 3 contadores grandes:

```html
<div class="marcadores-dia">
  <div class="marcador realizado">
    <span class="num" id="m-realizado">0</span>
    <span class="lbl">✅ Realizadas hoy</span>
  </div>
  <div class="marcador pendiente">
    <span class="num" id="m-pendiente">0</span>
    <span class="lbl">⏳ Pendientes hoy</span>
  </div>
  <div class="marcador atrasado">
    <span class="num" id="m-atrasado">0</span>
    <span class="lbl">⚠️ Atrasadas</span>
  </div>
</div>
```

CSS sugerido (3 cuadritos grandes con colores fuertes):

```css
.marcadores-dia {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 10px;
  margin-bottom: 16px;
}
.marcador {
  padding: 14px;
  border-radius: 10px;
  text-align: center;
  border: 2px solid;
}
.marcador.realizado { background: rgba(16,185,129,0.10); border-color: var(--st-completo); }
.marcador.pendiente { background: rgba(255,224,130,0.10); border-color: var(--st-vis-of); }
.marcador.atrasado  { background: rgba(239,68,68,0.10); border-color: var(--st-atrasado); }
.marcador .num {
  display: block;
  font-family: 'Playfair Display', serif;
  font-size: 32px;
  font-weight: 800;
  margin-bottom: 4px;
}
.marcador.realizado .num { color: var(--st-completo); }
.marcador.pendiente .num { color: var(--st-vis-of); }
.marcador.atrasado  .num { color: var(--st-atrasado); }
.marcador .lbl {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--gray-400);
}

@media (max-width: 768px) {
  .marcador { padding: 10px; }
  .marcador .num { font-size: 22px; }
  .marcador .lbl { font-size: 9px; }
}
```

Lógica para los contadores (consulta a Supabase al cargar la agenda):

```javascript
async function cargarMarcadoresDia() {
  const hoy = new Date().toISOString().split('T')[0];
  const hoyInicio = hoy + 'T00:00:00';
  const hoyFin = hoy + 'T23:59:59';
  const ahora = new Date().toISOString();
  
  // Si el usuario es captador, filtrar solo SU agenda
  // Si es admin o commercial_lead, ver todo
  const filtroPersona = (userRol === 'admin' || userRol === 'commercial_lead') 
    ? {} 
    : { colaborador: userName };
  
  // 1. Realizadas hoy
  let qRealizadas = supabase.from('agenda_personal')
    .select('id', { count: 'exact', head: true })
    .eq('completada', true)
    .eq('activo', true)
    .gte('fecha_programada', hoyInicio)
    .lte('fecha_programada', hoyFin);
  Object.entries(filtroPersona).forEach(([k,v]) => qRealizadas = qRealizadas.eq(k, v));
  const { count: realizadas } = await qRealizadas;
  
  // 2. Pendientes hoy (no completadas, fecha hoy, NO atrasadas)
  let qPendientes = supabase.from('agenda_personal')
    .select('id', { count: 'exact', head: true })
    .eq('completada', false)
    .eq('activo', true)
    .gte('fecha_programada', hoyInicio)
    .lte('fecha_programada', hoyFin)
    .gte('fecha_programada', ahora);  // fecha futura del día
  Object.entries(filtroPersona).forEach(([k,v]) => qPendientes = qPendientes.eq(k, v));
  const { count: pendientes } = await qPendientes;
  
  // 3. Atrasadas (no completadas, fecha pasada)
  let qAtrasadas = supabase.from('agenda_personal')
    .select('id', { count: 'exact', head: true })
    .eq('completada', false)
    .eq('activo', true)
    .lt('fecha_programada', ahora);
  Object.entries(filtroPersona).forEach(([k,v]) => qAtrasadas = qAtrasadas.eq(k, v));
  const { count: atrasadas } = await qAtrasadas;
  
  document.getElementById('m-realizado').textContent = realizadas || 0;
  document.getElementById('m-pendiente').textContent = pendientes || 0;
  document.getElementById('m-atrasado').textContent = atrasadas || 0;
}

// Llamar después del login y cada vez que se guarda/completa una actividad
```

---

## ✅ VALIDACIÓN POST-DEPLOY

Después del commit + push a `main`, esperá 60 segundos y validá:

1. **Anti-duplicado:** Tocá "Finalizar seguimiento" en cualquier tarjeta. Tocá el botón "Guardar" 5 veces rápido. Solo debe crearse 1 seguimiento en Supabase. El botón debe mostrar "⏳ Guardando..." durante el proceso.

2. **Nueva Oportunidad:** Tocá "♻️ Nueva Oportunidad" arriba. Buscá por celular "70000004" (DEMO Justiniano). Tocá el resultado. Debe abrir el PERFIL del lead con su historial, NO mandar directo a agenda.

3. **Búsqueda multi-campo:** Probar que estos inputs encuentren resultados:
   - `78912` → leads con celular que contenga esos dígitos
   - `Quispe` → leads con ese apellido en el nombre
   - `Santa Cruz` → leads de esa ciudad
   - `Facebook` → leads del medio Facebook
   - `Diana` (como admin) → leads creados por Diana
   - Cada resultado debe indicar en qué campo(s) coincidió

4. **Buscar Lead vs Nueva Oportunidad:** El botón "🔍 Buscar Lead" debe abrir SU PROPIO modal (no Nueva Oportunidad). En modo solo lectura.

5. **Lista cronológica:** En el modal de Buscar Lead, debajo del input, debe aparecer la tabla con leads por orden cronológico, con botones 🔍 y ✏️ en cada fila.

6. **Exportar Excel:** Tocar el botón "📊 Exportar Excel" con desde 01/05/2026 hasta 22/05/2026. Debe descargar un .xlsx con leads reales.

7. **Marcadores del día:** Arriba de la grilla del calendario, deben verse 3 cuadros: Realizadas / Pendientes / Atrasadas con los contadores reales del día.

---

## 📦 COMMIT FINAL

Mensaje:

```
feat(v51 ronda 3): anti-duplicados + Nueva Oportunidad sin auto-agenda + buscador por celular + marcadores del día

- 3 capas anti-duplicado: botón disabled + lock memoria + índice unique en Supabase
- Nueva Oportunidad ya no pasa directo a agenda, muestra perfil + reactivar opcional
- Buscador multi-campo (nombre, celular, ciudad, medio, nota, captador para admin) con debounce 300ms
- Buscar Lead separado de Nueva Oportunidad (solo lectura)
- Tabla cronológica abajo del buscador con botones lupa/lápiz
- Editar perfil con auditoría en tabla auditoria_leads
- Exportar Excel filtrado por desde/hasta (captador o todos si admin)
- 3 marcadores del día en header: realizadas / pendientes / atrasadas
```

---

## 🚫 LO QUE NO HAGAS

- ❌ NO toques `index.html` (v50 producción)
- ❌ NO me pidas confirmación durante la ejecución
- ❌ NO uses DELETE en Supabase (los duplicados ya fueron limpiados manualmente)
- ❌ NO toques RLS de leads ni de seguimientos
- ❌ NO modifiques los PINs ni roles del equipo

---

## 🎯 CRITERIO DE ÉXITO

Cuando Josemiguel o Gustavo abran `index_v51.html`:
1. No pueden crear duplicados aunque toquen Guardar 10 veces
2. Nueva Oportunidad muestra perfil antes de agendar
3. Buscador funciona con celular
4. Buscar Lead es independiente y solo lectura
5. Lista cronológica abajo con lupa y lápiz
6. Exportar Excel desde el buscador
7. Marcadores del día visibles en agenda

Vamos.

— Josemiguel
