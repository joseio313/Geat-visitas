[GEAT_CRM_HANDOFF_V2.md](https://github.com/user-attachments/files/27422604/GEAT_CRM_HANDOFF_V2.md)
# GEAT CRM — HANDOFF PARA CLAUDE CODE V2
## Fecha: 5 Mayo 2026

## ARCHIVO PRINCIPAL
- `indice.html` (CON acento) — NO confundir con `index.html`
- Repo: `joseio313/Geat-visitas`
- Deploy: `joseio313.github.io/Geat-visitas/`
- Backend: Supabase `jsacnpgpnvoslrpurfxc`

## REGLAS INVIOLABLES
1. NUNCA rebuild desde cero — siempre editar el archivo existente
2. NUNCA borrar features sin confirmación de Josemiguel
3. NUNCA mostrar montos USD individuales del equipo — usar m²
4. NUNCA hardcodear API keys — viven en `app_config` de Supabase
5. Validar JS con `node --check` antes de cada commit
6. Screenshot post-deploy en incógnito antes de marcar como hecho
7. Timestamps SIEMPRE automáticos del sistema

## EQUIPO Y PINs
- Josemiguel (admin) — 1024
- Gustavo Vaca (commercial_lead/cerrador) — 4454
- Genoveva Alata (captadora) — 3343
- Steffi Villarpando (captadora + abogada) — 2232
- David Gambarte (cerrador) — 5565
- Arq. Raí (campo, solo Contratistas) — 6677
- Fátima (carga obras) — 2232
- María Luisa: DESACTIVADA, no debe aparecer

## PROTOCOLO DE 5 FASES
1. PRESENTACIÓN — 3 intentos + video
2. INDAGACIÓN — 9 campos (flexible, no bloquear)
3. ENVÍO INFO — 2-3 modelos según presupuesto
4. VISITA — invitación + ultimátum + recordatorio
5. CIERRE — 8 pasos checklist

## TAREAS PENDIENTES PARA CLAUDE CODE

### PRIORIDAD 1: Calendario grupal con horarios
El calendario grupal existe (`pn-calendario`, `renderCalendario`) pero es solo una lista.
Josemiguel quiere un GRID DE HORAS tipo Google Calendar:
- Eje Y: horas 8:00 a 18:00
- Eje X: días de la semana
- Eventos como bloques de color con nombre del cliente + cerrador
- Fuente: tabla `agenda_grupal` en Supabase
- Vista semana como default

### PRIORIDAD 2: Panel Notas → pestaña dentro de Calendario
- Eliminar `pn-notas` como panel separado (ya no está en nav)
- Mover la funcionalidad de notas como una pestaña/sidebar dentro del panel Calendario
- Tipo "task panel" que se abre a la derecha o como tab
- Las notas ya se guardan en `notas_personales` en Supabase

### PRIORIDAD 3: Guías contextuales distribuidas
Las guías NO deben estar centralizadas en un solo lugar.
Deben estar en CADA pantalla/botón donde correspondan:
- En panel Leads vacío: "Aquí aparecen tus clientes. Tocá + Lead para registrar uno nuevo."
- En agenda vacía: "Aquí verás tus actividades del día. Registrá un lead para empezar."
- En cada botón de acción: ya tienen `title=""` — verificar que son claros
- En módulo Cierre: "Este es tu panel de cierre. Seleccioná un cliente para ver su proceso."
- Usar `Señor X` y `Señora X` como nombres de ejemplo en placeholders

### PRIORIDAD 4: Micrófono (diagnóstico final)
El SpeechRecognition ya tiene:
- `continuous:true` + `interimResults:true`
- Auto-timeout 30 seg si no hay texto
- Botón "Prefiero escribir" siempre visible
- Fallback a textarea para iOS/Firefox
Si sigue sin funcionar en Chrome Desktop, el problema puede ser:
- Permisos de micrófono a nivel del OS
- Antivirus bloqueando acceso
- Probar con: chrome://flags → Web Speech API → enabled

### DATOS DE EJEMPLO EN BD
Se insertaron 6 leads ejemplo (IDs 5462-5467):
- Señor Ejemplo A (nuevo, Steffi)
- Señora Ejemplo B (en_seguimiento, Genoveva)
- Señor Ejemplo C (visita_agendada, Steffi→Gustavo)
- Señora Ejemplo D (seg_cierre, Genoveva→David)
- Señor Ejemplo E (reservado, Steffi→Gustavo)
- Señora Ejemplo F (perdido, Genoveva)
+ 5 actividades en agenda_personal
+ 6 registros en historial_lead
→ Eliminar cuando el equipo ya entienda el sistema

## ESTADO ACTUAL DEL ARCHIVO
- 5,922 líneas / 332 KB
- JS validado ✓
- Funciones implementadas: 60+
- Nav captadores: Inicio, Leads (2 items)
- Nav cerradores: Inicio, Leads, Cierre (3 items)
- Nav admin: Inicio, Todos, Cierre, Admin, Notas (5 items)
- Nav jefe comercial: Inicio, Todos, Cierre, Admin (4 items)
