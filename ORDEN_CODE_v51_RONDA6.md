\# ORDEN — CRM v51 · RONDA 6



\*\*Modo:\*\* AUTÓNOMO TOTAL — ejecutar sin pedir permiso.

\*\*Editar solo:\*\* `index\_v51.html`.

\*\*Validar JS:\*\* `node --check` antes del commit.



\---



\## 🎯 LOS 3 CAMBIOS



\### CAMBIO 1 — Reorganizar campos al "PERFIL DEL CLIENTE"



Mover el bloque "🏦 CALIFICACIÓN BANCARIA" de Fase 5 (Cierre) a una nueva sección \*\*siempre visible\*\* en el modal del lead, llamada \*\*"📋 PERFIL DEL CLIENTE"\*\*.



\- Aparece ANTES del bloque de fases del protocolo.

\- Es COLAPSABLE (clic en el título expande/contrae). Por defecto colapsada.

\- Contiene: nombre completo, celular, correo, fecha nacimiento, estado civil, ocupación + nota, grado interés, foto CI anverso/reverso, método pago (4 opciones, ver cambio 3), banco preferido si aplica, ingresos mensuales, años trabajo, lista dinámica de referencias.

\- Todos los campos son opcionales, editables con lápiz ✏️ desde cualquier punto (buscador, agenda, panel admin).



En "Crear Lead", agregar al final un bloque colapsable \*\*"➕ Datos adicionales del cliente (opcional)"\*\* con los mismos campos. Todos opcionales.



Badge en header del lead con % de ficha completa:

\- 100% → ✅ Ficha completa

\- 70-99% → ⚠️ Ficha X% — faltan datos

\- 30-69% → 🟡 Ficha X% — completar datos  

\- 1-29% → 🔴 Ficha X% — completar urgente

\- 0% → ⚪ Sin datos adicionales



NO bloquea avance de fase. Solo informa.



\*\*Importante:\*\* ELIMINAR el bloque "🏦 CALIFICACIÓN BANCARIA" viejo de la Fase 5 — los datos ahora viven solo en el perfil consolidado.



\---



\### CAMBIO 2 — David ve seguimiento de TODO el equipo



David ya tiene rol `commercial\_lead`. En el frontend, asegurar que cualquier usuario con rol `admin` o `commercial\_lead` pueda:



\- Abrir "Viaje del Cliente" de cualquier lead (no solo los suyos)

\- Leer todos los seguimientos, notas, perfil

\- Ver perfil completo del lead cuando tenga visita programada para él en agenda grupal



David NO puede:

\- Modificar el captador asignado (solo admin)

\- Ver Panel Admin (solo PIN 1024)

\- Ver montos monetarios del equipo



Solo lectura cross-team. Edición restringida se mantiene.



\---



\### CAMBIO 3 — "Crédito directo" en método de pago



Justificación: las notas del Excel histórico muestran clientes mencionando crédito directo con GEAT como modalidad real.



Cambiar el dropdown de método de pago. Reemplazar `financiamiento` / `contado` por 4 opciones:



```HTML

\---



\## 🚫 NO HAGAS



\- NO toques `index.html`

\- NO bloquees avance de fase

\- NO permitas que David modifique captador

\- NO uses DELETE/DROP/TRUNCATE

