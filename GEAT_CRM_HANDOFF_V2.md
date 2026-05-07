# GEAT CRM — HANDOFF V2

## Estado al 7 mayo 2026

### Archivo principal
- `index.html` (sin acento) — único HTML en raíz del repo.
- Repo: `joseio313/Geat-visitas`.
- Deploy: `joseio313.github.io/Geat-visitas/`.
- Backend: Supabase `jsacnpgpnvoslrpurfxc`.

### Reglas inviolables
1. NUNCA rebuild desde cero — siempre editar el archivo existente.
2. NUNCA borrar features sin confirmación de Josemiguel.
3. NUNCA mostrar montos USD individuales del equipo — usar m².
4. NUNCA hardcodear API keys — viven en `app_config` de Supabase.
5. Validar JS con `node --check` antes de cada commit.
6. Screenshot post-deploy en incógnito antes de marcar como hecho.
7. Timestamps SIEMPRE automáticos del sistema.

### Equipo y PINs
| Nombre | Rol | PIN | Notas |
|---|---|---|---|
| José Miguel Gambarte | admin | 1024 | CEO |
| Gustavo Vaca | commercial_lead | 4454 | Cerrador + jefe |
| Steffi Villarpando | field_capturer | 2232 | Captadora + abogada |
| Genoveva Alata | field_capturer | 3343 | Captadora |
| David Gambarte | closer | 5565 | Cerrador |
| Arquitectura GEAT | tecnico | 7788 | Solicitudes + Subir propuestas |
| Maria Luisa | field_capturer | 1121 | DESACTIVADA (`activo=false`) |

### Roles → nav
- **admin**: Inicio, Todos, Grupal, Cierre, Admin.
- **commercial_lead**: igual que admin (Gustavo).
- **field_capturer**: Inicio, Leads, Grupal.
- **closer**: Inicio, Leads, Cierre.
- **tecnico**: Solicitudes (panel Arquitectura), Subir.

### Tablas activas
| Tabla | Tipo | Uso |
|---|---|---|
| `leads` | base | núcleo del CRM (1 sola fuente). |
| `agenda_personal` | base | **fuente unificada** de actividades del calendario personal. |
| `eventos_calendario` | base | DEPRECADA para escritura — datos migrados el 7-may-2026. Lectura redundante hasta validar 1 semana, después se elimina. |
| `agenda_unificada` | VIEW | NO se usa (no expone `colaborador` ni `completada`). |
| `agenda_grupal` | base | calendario grupal — visitas/reuniones del equipo. |
| `historial_lead` | base | actividades realizadas. |
| `cotizaciones` | base | cotizaciones del cerrador (estado puede ser `pendiente_arquitectura`/`entregada`). |
| `solicitudes_propuesta` | base | flujo arquitectura: pendiente → en_proceso → entregada. |
| `comisiones_calculadas` | base | comisiones (m²). |
| `notificaciones` | base | mensajes entre colaboradores. |
| `notas_personales` | base | notas privadas (drawer del calendario grupal). |
| `config_cerradores` | base | turnos de cerradores. |
| `metricas_vendedor` | base | NO se usa más (rotura del Stats fix). |
| `colaboradores` | base | usuarios + PIN + rol. |

### Bugs cerrados (mayo 2026)
- ✅ Calendario solo leía `agenda_personal` → ahora unifica las 3 fuentes; `eventos_calendario` deprecada y migrada.
- ✅ Admin → Stats colgaba en "Cargando..." (`rows` undefined + await sin try/catch). Ahora con try/catch global, fallback con botón Reintentar y tabla actividad rebuild desde `leadsFiltrados`.
- ✅ KPIs Hoy/Atrasadas/Mes inconsistentes con badge "🔴 X atrasadas". Fuente única `calEventos` para todo.
- ✅ Bug timezone (UTC vs local) — helper `ymdLocal()` aplicado a comparaciones de día.
- ✅ Eventos en `eventos_calendario` no aparecían en grid Semana — embed PostgREST fallaba por falta de FK con `leads`. Workaround: lookup en JS desde `allLeads`.
- ✅ Notas como sidebar inline (drawer derecho) en vez de modal centrado.
- ✅ Empty states con ghost cards (opacity 0.4) en Leads, Calendario, Cierre, Notas, Llamadas.
- ✅ Pill discreto "🔴 atrasadas" reemplaza panel grande del Inicio.
- ✅ Tooltips en pills temperatura, llamada/WA, reactivar, marcar pagado.
- ✅ Banners contextuales: Indagación, Comisiones, Calendario grupal.

### Reportes CEO (Admin → Stats)
A. **Velocidad del embudo**: días captación→contacto, contacto→visita, visita→cierre.
B. **Productividad por persona**: top 3 captadoras + top 2 cerradores en m². Actividades semana programadas vs completadas.
C. **Tendencias**: gráfico SVG de leads últimas 8 semanas + tasa de pérdida por fase.
D. **Proyección**: ventas estimadas mes (ritmo actual) + pipeline esperado en m² (m² activos × prob por fase: nuevo 5% → reservado 85%).

### Panel Arquitectura (rol `tecnico`)
- Login con PIN 7788 (`Arquitectura GEAT`) → arranca en `pn-arquitectura`.
- Lista solicitudes con `estado IN ('pendiente','en_proceso','pendiente_arquitectura')`.
- Cada card: cliente, m², presupuesto, cerrador, fecha, descripción, archivo.
- Botón **"✓ Marcar como entregada"** → cambia estado a `entregada`, fija `fecha_entrega`, marca cotización como `entregada`, notifica al cerrador.
- Botón "Enviar al grupo Arquitectura" del cerrador (`generarImagenReq`) crea `solicitudes_propuesta` Y marca la cotización del lead con `estado='pendiente_arquitectura'`.

### Próximos pasos pendientes
1. **Borrar `eventos_calendario`** después de 1 semana de validación (~14-may-2026). Antes: confirmar que no hay más writes a esa tabla y que los IDs migrados (50-56 en `agenda_personal`) cubren todo.
2. **Limpiar captador "Corp Genoveva"** (2712 leads sin colaborador real asociado). Decidir si reasignar a Genoveva Alata o crear colaborador alias.
3. **Steffi tiene 1634 leads** y `loadLeads()` usa `.limit(500)` → considerar paginación o aumentar el límite si afecta búsquedas/filtros.
4. **Extender rango horario del grid** (HORA_FIN actual=20) para que se vean eventos nocturnos.
5. **Calendario grupal con grid horas** (priority histórica, ya parcial — la vista Lista funciona, falta vista Semana en grid).
6. **Micrófono** (Web Speech API): seguir validando con Chrome Desktop.
7. **Rol commercial_lead vs admin**: confirmar si Gustavo debería ver tab Admin o no.

### Datos de ejemplo en BD
6 leads ejemplo (IDs 5462-5467) + 5 actividades + 6 historiales — eliminar cuando el equipo esté entrenado.

### Estado del archivo
- ~6,200 líneas / ~360 KB.
- JS validado ✓ en cada commit.
- Funciones implementadas: 70+.
