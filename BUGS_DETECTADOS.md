# BUGS DETECTADOS — verificación 7 mayo 2026

Verificación end-to-end (Tarea 1) hecha por análisis estático del código + queries SELECT a Supabase. No se hizo login real (sin browser). Cada bullet incluye severidad y referencia.

## Por rol

### José Miguel Gambarte (admin, PIN 1024)
- ✅ Nav: Inicio, Todos, Grupal, Cierre, Admin (5 items, [index.html:1372](index.html:1372)).
- ⚠ Naming: BD tiene `"José Miguel Gambarte"`, el handoff antiguo lo llamaba `"Josemiguel"`. No hay comparaciones literales en el código (verificado), pero conviene unificar el handoff.
- ⚠ **MEDIO** Admin → Stats: arreglado en commit `8d5822a` (rows undefined + try/catch).
- ⚠ **BAJO** Admin → Equipo: muestra María Luisa cuando `activo=false` (depende de `cu.rol==='admin'`). Confirmar que se filtra con `activo=true`.

### Gustavo Vaca (commercial_lead, PIN 4454)
- ✅ Nav: Inicio, Todos, Grupal, Cierre, Admin (4 items según handoff, ahora 5 con Grupal).
- ✅ Tiene 4 leads como cerrador, 3 actividades en agenda_personal.
- ⚠ **BAJO** El nav `commercial_lead` y `admin` son casi idénticos — Admin tab también visible para Gustavo. Verificar si esto es intencional.

### Steffi Villarpando (field_capturer, PIN 2232)
- ✅ Nav: Inicio, Leads, Grupal (3 items).
- ⚠ **ALTO — DATOS** Steffi tiene **1634 leads como captadora** pero `loadLeads()` ([index.html:1467](index.html:1467)) usa `.limit(500)` ordenado por `created_at desc`. Los leads más antiguos NO se cargan, así que estadísticas, búsquedas y filtros pueden ser incompletos. Considerar paginación o aumentar el límite.
- ✅ Calendario: 26 actividades en agenda_personal + 7 en eventos_calendario (ya leídas tras commit `517bfd3`).
- ⚠ **BAJO** Algunos eventos de Steffi caen fuera del rango horario del grid (ej. evento ID 2 a las 22:00, grid termina a 20:00). No se ven. Considerar extender HORA_FIN.

### Genoveva Alata (field_capturer, PIN 3343)
- ✅ Nav igual que Steffi.
- ✅ 5 leads + 10 actividades.
- ⚠ Hay un captador llamado `"Corp Genoveva"` con 2712 leads que NO está en `colaboradores`. Es un alias para campañas. Si se filtra estricto por colaborador, esos leads quedan invisibles para la persona real. Anotado para futura limpieza.

### David Gambarte (closer, PIN 5565)
- ✅ Nav: Inicio, Leads, Cierre (3 items).
- ✅ 4 leads + 2 actividades.

### Arquitectura GEAT (tecnico, PIN 7788) — descubierto en esta auditoría
- ✅ Ya existe en BD (id=10). El rol "tecnico" está implementado con nav `[Solicitudes, Subir]`.
- ⚠ **MEDIO** El nav del rol `tecnico` usa `id:'inicio'` para el primer item, lo que carga `pn-inicio` (calendario, KPIs, leads) — no es lo que el usuario espera ver. Hay que dirigirlo a un panel propio o renderizar un layout específico para tecnico dentro de `pn-inicio`.
- ⚠ **BAJO** El handoff antiguo decía PIN 7788 estaba libre — en realidad ya está asignado. Tarea 5 reusa el rol existente.

## KPIs / Calendario / fuentes

- ✅ Bug "calendario solo lee agenda_personal" arreglado en `25aac5c` y `517bfd3`.
- ✅ KPIs y badge atrasadas unificados en `calEventos` (`25aac5c`).

## Empty states con fantasmas

- ✅ Implementados en Leads, Cotizaciones, Notas, Calendario Día (commit `22984c2`).
- ✅ Reuniones, Propuestas, Reservas, Llamadas, Calendario lista (commit `e57e4cb`).
- ⚠ **No visibles en producción para el admin** porque tiene datos reales. Solo se ven cuando la lista filtrada queda vacía. **Comportamiento esperado**, no es bug.

## Tablas BD

- `agenda_personal` (BASE TABLE, 42 filas).
- `eventos_calendario` (BASE TABLE, 5+ filas).
- `agenda_unificada` (VIEW, 7 filas) — **no sirve** como fuente del calendario: no expone `colaborador`, `completada`, ni `tipo` de actividad. Solo proyecta datos del lead + `fecha_evento`.
- `eventos_calendario` **NO tiene FK con leads** — embed PostgREST `.select('*,leads(...)')` falla. Workaround: lookup en JS (commit `517bfd3`).
