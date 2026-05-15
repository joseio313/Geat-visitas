# GEAT CRM Development Guardian

## REGLA #1: NUNCA entregar sin verificar
Cada cambio DEBE pasar por este ciclo: EDITAR → VALIDAR JS → VERIFICAR FUNCIONALIDAD → COMMIT

## ARCHIVO DE PRODUCCIÓN
El archivo es **index.html** (SIN tilde/acento). `indice.html` no existe. Confirmado: 95 commits, URL https://joseio313.github.io/Geat-visitas/ da 200 OK.

## ANTES de editar:
1. git pull origin main
2. wc -l index.html — debe tener 6000+ líneas
3. grep "GEAT CRM" index.html | head -1 — confirmar título correcto

## AL editar:
1. NUNCA reconstruir — solo editar secciones con grep -n para ubicar
2. NUNCA borrar funciones existentes
3. NUNCA usar .catch() encadenado a sb.from().insert/update/delete
4. SIEMPRE usar try/catch o .then() para Supabase
5. CSS: SOLO usar finput, fselect, ftextarea, btn, btn-primary, btn-ghost, btn-red, btn-sm

## DESPUÉS de CADA edición:
1. node --check <(sed -n '/<script charset/,/<\/script>/p' index.html | sed '1d;$d')
2. Si falla: git checkout index.html y reportar error ANTES de seguir

## ANTES de commit — VERIFICACIÓN OBLIGATORIA:
Para CADA función nueva o modificada, ejecutar grep para confirmar que:
1. La función existe: grep -c "function nombreFuncion" index.html
2. Si inserta en Supabase: NO tiene .catch() directo, SÍ tiene try/catch
3. Si modifica calendario: tiene "await cargarAgendaPersonal()" Y "renderInicioCal()" después del insert
4. Si modifica agenda grupal: tiene "renderCalendario()" después del insert
5. Si modifica leads: tiene "renderLeads()" o "loadLeads()" después del update
6. Todas las funciones async que guardan datos tienen refreshes al final

## CHECKLIST POST-GUARDADO (verificar para CADA función que guarda datos):
grep -A 5 "función que guarda" index.html debe contener:
- [ ] try{ await sb.from(...) }catch(e){toast('Error: '+e.message,'error')}
- [ ] await cargarAgendaPersonal() (si toca agenda)
- [ ] renderInicioCal() (si toca calendario)
- [ ] renderCalendario() (si toca agenda grupal)
- [ ] toast de confirmación
- [ ] NO tiene .catch(function(){}) encadenado

## TIMEZONE — REGLA CRÍTICA
Bolivia es UTC-4. Para fechas de DISPLAY o COMPARACIÓN de calendario, SIEMPRE usar:
  ymdLocal(d) — función definida en index.html cerca de toast()
  → ymdLocal(new Date())  en lugar de  new Date().toISOString().slice(0,10)
  → ymdLocal(algFecha)    en lugar de  algFecha.toISOString().slice(0,10)
Solo dejar toISOString() SIN .slice(0,10) para timestamps completos guardados en Supabase.

## NUNCA:
- Hardcodear API keys
- Mostrar montos USD al equipo (solo m²)
- Dejar console.log en producción
- Usar .catch() directo en sb.from()
- Usar new Date().toISOString().slice(0,10) para comparar/mostrar fechas — usar ymdLocal()
- Entregar sin verificar que los refreshes están presentes
- Decir "listo" sin confirmar que grep muestra las líneas correctas
