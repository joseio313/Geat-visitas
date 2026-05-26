# ORDEN — CRM v51 · RONDA 5

**Autor:** Josemiguel Gambarte (CEO GEAT)
**Fecha:** 26 mayo 2026
**Destinatario:** Claude Code (terminal en `C:\Users\PERSONAL\Geat-visitas`)
**Modo:** AUTÓNOMO TOTAL — ejecutar todo de corrido, sin pedir permisos

---

## 🔒 REGLAS

1. NO me pidas permiso para nada. Ejecutá todo el plan completo.
2. SOLO modificás `index_v51.html`. NO toques `index.html` (v50 producción).
3. SÍ podés ejecutar SQL en Supabase MCP (`jsacnpgpnvoslrpurfxc`) — EXCEPTO DELETE/DROP/TRUNCATE.
4. SÍ podés crear ALTER TABLE ADD COLUMN IF NOT EXISTS + crear buckets de storage.
5. Reportá al final con before/after de cada cambio.

---

## 📊 ESTADO ACTUAL (verificado 26/05/2026)

- 5,330 leads (limpio, ya se borraron pruebas)
- Tablas auditoría ya creadas: `auditoria_logins`, `auditoria_acciones`, `cerrador_alternancia`
- David Gambarte tiene rol `commercial_lead` (mismo nivel que Gustavo)
- Tabla `leads` ya tiene columna `cliente_mujer`
- 0 actividades atrasadas de prueba (limpiado)

---

## 🎯 LOS 9 CAMBIOS DE ESTA RONDA

### CAMBIO 1 — Bug crítico: Marcadores del día NO filtran por usuario

**Problema reportado por Gustavo:**
> "Le cuento que el marcador diario no está jalando por usuario, en mi usuario me salen esos datos (38 atrasadas que no son mías)"

**Causa probable:** La función `cargarMarcadoresDia()` no aplica filtro `colaborador = userName` cuando el rol del usuario es captador o cerrador (solo no aplica si es admin/commercial_lead, pero debe aplicar para captadores).

**Solución:**

```javascript
async function cargarMarcadoresDia() {
  const hoy = new Date().toISOString().split('T')[0];
  const hoyInicio = hoy + 'T00:00:00';
  const hoyFin = hoy + 'T23:59:59';
  const ahora = new Date().toISOString();
  
  // REGLA NUEVA: SOLO admin (PIN 1024) ve totales de todos
  // commercial_lead (Gustavo, David) y captadores ven SOLO lo suyo
  const esAdminPuro = window.currentUser?.rol === 'admin';
  
  // Filtro de persona: si NO es admin puro, filtrar por su nombre
  const filtroColab = esAdminPuro ? {} : { colaborador: window.currentUser.nombre };
  
  // 1. Realizadas hoy
  let qR = supabase.from('agenda_personal').select('id', { count: 'exact', head: true })
    .eq('completada', true).eq('activo', true)
    .gte('fecha_programada', hoyInicio).lte('fecha_programada', hoyFin);
  if (!esAdminPuro) qR = qR.eq('colaborador', window.currentUser.nombre);
  const { count: realizadas } = await qR;
  
  // 2. Pendientes hoy (NO completadas, fecha hoy, futura del día)
  let qP = supabase.from('agenda_personal').select('id', { count: 'exact', head: true })
    .eq('completada', false).eq('activo', true)
    .gte('fecha_programada', hoyInicio).lte('fecha_programada', hoyFin)
    .gte('fecha_programada', ahora);
  if (!esAdminPuro) qP = qP.eq('colaborador', window.currentUser.nombre);
  const { count: pendientes } = await qP;
  
  // 3. Atrasadas (NO completadas, fecha pasada)
  let qA = supabase.from('agenda_personal').select('id', { count: 'exact', head: true })
    .eq('completada', false).eq('activo', true)
    .lt('fecha_programada', ahora);
  if (!esAdminPuro) qA = qA.eq('colaborador', window.currentUser.nombre);
  const { count: atrasadas } = await qA;
  
  document.getElementById('m-realizado').textContent = realizadas || 0;
  document.getElementById('m-pendiente').textContent = pendientes || 0;
  document.getElementById('m-atrasado').textContent = atrasadas || 0;
}
```

**IMPORTANTE:** Aplicar el mismo principio a CUALQUIER otra métrica que se calcule en la pantalla principal (agenda, vista mensual, etc.). Si veo otra que tiene el mismo bug, también arreglarla.

---

### CAMBIO 2 — Agregar tipo de contacto "Reunión virtual / Videollamada"

**Problema reportado por Gustavo:** En el desplegable "Tipo de contacto" del modal "Finalizar seguimiento" actualmente hay 4 opciones (WhatsApp, Llamada, Personal, Email). Falta una 5ta: Reunión virtual / Videollamada.

**Solución:**

Buscar en el HTML el `<select>` que tiene las opciones `whatsapp`, `llamada`, `personal`, `email` y agregar:

```html
<option value="videollamada">🎥 Reunión virtual / Videollamada</option>
```

Aplicarlo en TODOS los lugares donde aparece el desplegable de medio/tipo de contacto:
- Modal "Finalizar seguimiento"
- Modal "Crear Lead" (si tiene el campo)
- Modal "Programar siguiente seguimiento"
- Cualquier otro lugar

---

### CAMBIO 3 — Campo "Grado de interés" al crear lead

**Justificación:** La captadora puede deducir el nivel de interés del cliente en el primer contacto (Fase 1 Presentación). Permite priorizar leads desde el inicio.

**Solución:**

Migración en Supabase:
```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS grado_interes TEXT 
CHECK (grado_interes IN ('bajo', 'medio', 'alto'));
```

En el modal "Crear Lead", agregar dentro del bloque actual de campos básicos:

```html
<div class="form-group">
  <label>🌡️ Grado de interés del cliente</label>
  <select name="grado_interes">
    <option value="">-- Seleccionar --</option>
    <option value="bajo">🟢 Bajo (consulta exploratoria)</option>
    <option value="medio">🟡 Medio (interesado, evaluando)</option>
    <option value="alto">🔴 Alto (urgente, decidido)</option>
  </select>
</div>
```

Mostrar el grado de interés en el perfil del cliente con badge de color en el header.

---

### CAMBIO 4 — Campo "Correo electrónico" al crear lead (opcional)

**Justificación:** Necesario para mandar catálogo formal en Fase 3 (envío de información).

**Solución:**

Migración (verificar primero si ya existe):
```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS correo TEXT;
```

En modal "Crear Lead", agregar:
```html
<div class="form-group">
  <label>📧 Correo electrónico (opcional)</label>
  <input type="email" name="correo" placeholder="cliente@ejemplo.com">
</div>
```

Validar formato email cuando se llena. Si está vacío, NO bloquear.

Mostrar en perfil del cliente. Si está cargado, mostrar botón "📧 Enviar email" que abre `mailto:`.

---

### CAMBIO 5 — Campo "Ocupación / Profesión + nota detalle" en INDAGACIÓN

**Justificación:** Necesario para calificar bancariamente en Fase 5 (paso 4 del cierre: "Verificación de calificar a financiamiento bancario"). El cerrador necesita saber ocupación.

**Solución:**

Migración:
```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ocupacion TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ocupacion_detalle TEXT;
```

En el bloque de INDAGACIÓN (modal de detalle del lead → pestaña Detalle → sección Indagación), agregar después de los 9 campos obligatorios actuales:

```html
<div class="form-group full-width">
  <label>💼 Ocupación / Profesión</label>
  <input type="text" name="ocupacion" placeholder="Ej: Médico, Ingeniero, Empresario, Empleado, etc">
  <textarea name="ocupacion_detalle" placeholder="Detalles: empresa donde trabaja, antigüedad, ingresos aprox, otros datos relevantes" rows="2"></textarea>
</div>
```

---

### CAMBIO 6 — Campo "Banco preferido" en INDAGACIÓN

**Justificación:** Refina el campo existente "financiamiento o contado". Si elige financiamiento, saber qué banco prefiere acelera el trámite.

**Solución:**

Migración:
```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS banco_preferido TEXT;
```

En INDAGACIÓN, condicionarlo: aparece SOLO si en "financiamiento o contado" eligió "financiamiento":

```html
<div class="form-group" id="block-banco" style="display: none;">
  <label>🏦 Banco preferido para financiamiento</label>
  <select name="banco_preferido">
    <option value="">-- No definido aún --</option>
    <option value="mercantil">Banco Mercantil Santa Cruz</option>
    <option value="bnb">Banco Nacional de Bolivia (BNB)</option>
    <option value="bcp">Banco BCP</option>
    <option value="bancosol">Banco Sol</option>
    <option value="union">Banco Union</option>
    <option value="otro">Otro</option>
  </select>
</div>
```

JS para mostrarlo dinámicamente:
```javascript
document.querySelector('[name="financiamiento_contado"]').addEventListener('change', e => {
  document.getElementById('block-banco').style.display = 
    e.target.value === 'financiamiento' ? 'block' : 'none';
});
```

---

### CAMBIO 7 — Bloque completo "🏦 CALIFICACIÓN BANCARIA" en fase de CIERRE

**Justificación:** Sistema Operativo 1 de GEAT en Fase 5 (CIERRE) tiene 2 pasos críticos: "Verificación de calificar a financiamiento bancario" y "Gestionar financiamiento bancario hasta el desembolso". Estos requieren documentación bancaria completa.

**Solución:**

Migración:
```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS estado_civil TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ingresos_mensuales_bs NUMERIC;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS antiguedad_trabajo_anios INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ci_anverso_url TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ci_reverso_url TEXT;

CREATE TABLE IF NOT EXISTS referencias_lead (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT REFERENCES leads(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  parentesco TEXT NOT NULL,
  celular TEXT,
  orden INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referencias_lead ON referencias_lead(lead_id);
```

**Crear bucket de Supabase Storage** para fotos de CI:
```sql
INSERT INTO storage.buckets (id, name, public) 
VALUES ('ci-fotos', 'ci-fotos', false)
ON CONFLICT (id) DO NOTHING;
```

En el modal del lead, cuando el estado del lead sea `visita_agendada`, `en_cierre` o `cerrado_ganado` (es decir, en fase 4 o 5), mostrar este bloque colapsable:

```html
<div class="section calificacion-bancaria" id="block-calif-bancaria">
  <div class="section-header">
    <h3>🏦 CALIFICACIÓN BANCARIA</h3>
    <span class="badge-importante">⚠️ IMPORTANTE — no bloquea avance</span>
  </div>
  
  <div class="grid-2col">
    <div class="form-group">
      <label>📅 Fecha de nacimiento</label>
      <input type="date" name="fecha_nacimiento">
    </div>
    
    <div class="form-group">
      <label>💍 Estado civil</label>
      <select name="estado_civil">
        <option value="">-- Seleccionar --</option>
        <option value="soltero">Soltero/a</option>
        <option value="casado">Casado/a</option>
        <option value="conviviente">Conviviente</option>
        <option value="divorciado">Divorciado/a</option>
        <option value="viudo">Viudo/a</option>
      </select>
    </div>
    
    <div class="form-group">
      <label>💵 Ingresos mensuales (Bs)</label>
      <input type="number" name="ingresos_mensuales_bs" placeholder="Ej: 12000">
    </div>
    
    <div class="form-group">
      <label>⏱️ Antigüedad en trabajo actual (años)</label>
      <input type="number" name="antiguedad_trabajo_anios" placeholder="Ej: 5">
    </div>
  </div>
  
  <h4>📸 Carnet de Identidad</h4>
  <div class="grid-2col">
    <div class="upload-zone" id="upload-ci-anverso">
      <label>Anverso (frente)</label>
      <input type="file" accept="image/*" id="file-ci-anverso">
      <div class="preview" id="preview-ci-anverso"></div>
    </div>
    <div class="upload-zone" id="upload-ci-reverso">
      <label>Reverso (atrás)</label>
      <input type="file" accept="image/*" id="file-ci-reverso">
      <div class="preview" id="preview-ci-reverso"></div>
    </div>
  </div>
  
  <h4>📞 Referencias bancarias (mínimo 2)</h4>
  <div id="referencias-container">
    <div class="referencia-row">
      <input type="text" placeholder="Nombre completo" name="ref1_nombre">
      <input type="text" placeholder="Parentesco" name="ref1_parentesco">
      <input type="tel" placeholder="Celular" name="ref1_celular">
    </div>
    <div class="referencia-row">
      <input type="text" placeholder="Nombre completo" name="ref2_nombre">
      <input type="text" placeholder="Parentesco" name="ref2_parentesco">
      <input type="tel" placeholder="Celular" name="ref2_celular">
    </div>
    <button type="button" onclick="agregarReferencia()">+ Agregar otra referencia</button>
  </div>
  
  <button class="btn-primary" onclick="guardarCalificacionBancaria()">💾 Guardar calificación bancaria</button>
</div>
```

**Lógica de subida de fotos:**

```javascript
async function subirFotoCI(leadId, lado, archivo) {
  const ext = archivo.name.split('.').pop();
  const nombreArchivo = `lead_${leadId}_ci_${lado}_${Date.now()}.${ext}`;
  
  const { data, error } = await supabase.storage
    .from('ci-fotos')
    .upload(nombreArchivo, archivo, { upsert: true });
  
  if (error) {
    alert('Error al subir foto: ' + error.message);
    return null;
  }
  
  // Generar URL firmada (privada, expira en 24h, se renueva cada vez que se ve)
  const { data: urlData } = await supabase.storage
    .from('ci-fotos')
    .createSignedUrl(nombreArchivo, 60 * 60 * 24);
  
  // Guardar URL en lead
  const campo = lado === 'anverso' ? 'ci_anverso_url' : 'ci_reverso_url';
  await supabase.from('leads').update({ [campo]: nombreArchivo }).eq('id', leadId);
  
  // Registrar en auditoría
  await supabase.from('auditoria_acciones').insert({
    colaborador_id: window.currentUser.id,
    colaborador_nombre: window.currentUser.nombre,
    accion: 'subir_foto_ci',
    tabla_afectada: 'leads',
    registro_id: leadId,
    detalles: { lado: lado, archivo: nombreArchivo }
  });
  
  return urlData.signedUrl;
}
```

---

### CAMBIO 8 — Indicador "ficha completa %" en perfil del cliente

**Justificación:** Como NO bloqueamos avance por datos incompletos, necesitamos visibilidad de qué tan completo está cada lead. Esto presiona sutilmente a llenar todo sin frustrar.

**Solución:**

En el perfil del cliente (pestaña Detalle), mostrar arriba un badge:

```html
<div class="ficha-completa">
  <div class="ficha-bar">
    <div class="ficha-fill" style="width: 65%"></div>
  </div>
  <span>📊 Ficha completa: 65% — Falta: ocupación, fecha nacimiento, foto CI</span>
</div>
```

Lógica:

```javascript
function calcularFichaCompleta(lead, referencias) {
  const campos = [
    // Básicos (5)
    !!lead.nombre, !!lead.celular, !!lead.ciudad, !!lead.medio_difusion, !!lead.grado_interes,
    // Indagación (9 + 2 nuevos = 11)
    !!lead.financiamiento_contado, !!lead.lugar_terreno, !!lead.apto_financiamiento,
    !!lead.plantas, !!lead.cuando_construir, !!lead.monto_financiable,
    !!lead.presupuesto_construccion, !!lead.presupuesto_tope, !!lead.tipo_vivienda,
    !!lead.ocupacion, !!lead.banco_preferido,
    // Calificación bancaria (6 + 2 fotos + 2 refs = 10)
    !!lead.fecha_nacimiento, !!lead.estado_civil, !!lead.ingresos_mensuales_bs,
    !!lead.antiguedad_trabajo_anios, !!lead.correo,
    !!lead.ci_anverso_url, !!lead.ci_reverso_url,
    referencias && referencias.length >= 2,
    referencias && referencias[0]?.celular,
    referencias && referencias[1]?.celular
  ];
  
  const total = campos.length;
  const llenos = campos.filter(Boolean).length;
  const porcentaje = Math.round((llenos / total) * 100);
  
  const faltantes = [];
  if (!lead.ocupacion) faltantes.push('ocupación');
  if (!lead.fecha_nacimiento) faltantes.push('fecha nacimiento');
  if (!lead.ci_anverso_url) faltantes.push('foto CI anverso');
  if (!lead.ci_reverso_url) faltantes.push('foto CI reverso');
  if (!referencias || referencias.length < 2) faltantes.push('referencias');
  // ...etc
  
  return { porcentaje, faltantes: faltantes.slice(0, 3) };
}
```

CSS:
```css
.ficha-bar {
  width: 100%;
  height: 6px;
  background: var(--gray-700);
  border-radius: 3px;
  overflow: hidden;
}
.ficha-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--st-atrasado), var(--st-vis-of), var(--st-completo));
  transition: width 0.3s;
}
```

---

### CAMBIO 9 — Extender lupita 🔍 y lápiz ✏️ desde sección de cliente

**Problema reportado por Gustavo:**
> "QUE PUEDA SALIR EN ESTA OPCION CUANDO SE BUSCA CADA CLIENTE IGUAL LA LUPITA Y EL LAPIZ PARA EDITAR"

**Solución:**

En el modal "Buscar Lead" actualmente la tabla cronológica abajo del buscador ya tiene lupita y lápiz (ronda 3). Extenderlo a:

1. **Tabla "Sin asignar"** (la pantalla `screen-orphans`)
2. **Tabla del Panel Admin** → últimas acciones (en columna lead, agregar 🔍)
3. **Resultados del buscador en Nueva Oportunidad** (cada resultado debe tener los 2 íconos)

Acción de cada botón:
- 🔍 **Lupita** → abre modal de detalle del lead (modo solo lectura si viene de Buscar, modo edición si viene de otro lado)
- ✏️ **Lápiz** → abre modal pequeño para editar campos básicos (nombre, celular, ciudad, correo, grado_interes)

Cada edición debe registrar entrada en `auditoria_acciones` con before/after.

---

## ✅ VALIDACIÓN POST-DEPLOY

Después del commit + push, esperá 60 segundos y validá:

1. **Marcadores filtrados:**
   - Login PIN 4454 (Gustavo) → marcadores deben mostrar 0 atrasadas (porque las suyas las borramos)
   - Login PIN 1024 (Josemiguel) → marcadores muestran totales de TODO el equipo
   - Login PIN 3343 (Genoveva) → marcadores solo de Genoveva

2. **Reunión virtual:** Al finalizar seguimiento, el desplegable "Tipo de contacto" tiene 5 opciones incluyendo 🎥 Videollamada

3. **Crear lead:** Tiene los campos Grado de interés y Correo electrónico (ambos opcionales)

4. **Indagación:** Tiene los campos Ocupación + Banco preferido (condicional)

5. **Calificación bancaria:** Cuando un lead pasa a fase visita_agendada o superior, aparece el bloque completo con fecha nac, estado civil, ingresos, fotos CI, referencias

6. **Subir foto CI:** Probar subida real, debe guardarse en bucket `ci-fotos` y URL en `leads.ci_anverso_url`

7. **Ficha completa %:** Badge visible en perfil con porcentaje y qué falta

8. **Lupita y lápiz:** Visibles en al menos 3 lugares (buscar lead, sin asignar, panel admin)

---

## 📦 COMMIT FINAL

```
feat(v51 ronda 5): protocolo bancario + bug marcadores + campos por fase

- Fix bug crítico: marcadores filtraban totales en lugar de por usuario
- Tipo de contacto: agregada Reunión virtual / Videollamada
- Crear Lead: grado_interes + correo electrónico (opcionales)
- Indagación: ocupacion + detalle + banco_preferido (condicional)
- Cierre: bloque completo Calificación Bancaria (fecha nac, estado civil, 
  ingresos, antigüedad, fotos CI anverso/reverso, referencias bancarias)
- Storage bucket ci-fotos para documentos
- Tabla referencias_lead con N referencias por lead
- Indicador % ficha completa en perfil del cliente
- Lupita 🔍 + lápiz ✏️ extendidos a sin asignar, panel admin y buscador
- Todo marcado como IMPORTANTE pero NO bloquea avance entre fases
```

---

## 🚫 LO QUE NO HAGAS

- ❌ NO toques `index.html` (v50 producción)
- ❌ NO uses DELETE / DROP / TRUNCATE
- ❌ NO bloquees el avance entre fases por datos faltantes (solo mostrar como IMPORTANTE)
- ❌ NO modifiques los PINs ni roles del equipo
- ❌ NO me pidas confirmación durante la ejecución
- ❌ NO modifiques los 9 campos obligatorios oficiales de la fase 2 (los nuevos van como ADICIONALES, no reemplazo)

---

## 🎯 CRITERIO DE ÉXITO

Cuando Josemiguel abra el CRM (PIN 1024):
1. Marcadores muestran totales del equipo
2. Tab Admin sigue funcionando como antes
3. Puede crear lead con grado de interés y correo
4. Al abrir un cliente en cierre, ve bloque de calificación bancaria
5. Ficha completa % visible en cada perfil

Cuando Gustavo abra el CRM (PIN 4454):
1. Marcadores muestran SOLO sus actividades (0 atrasadas)
2. Tab Admin invisible (sigue oculto)
3. Mismas funciones nuevas que Josemiguel

Cuando una captadora abra el CRM:
1. Marcadores filtrados a su nombre
2. Al crear lead puede llenar grado de interés
3. Al indagar puede registrar ocupación y banco
4. NO ve el bloque de calificación bancaria (solo cuando llega a visita o cierre)

Vamos.

— Josemiguel
