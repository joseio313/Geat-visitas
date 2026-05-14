# GEAT CRM Development Guardian

## REGLAS OBLIGATORIAS

### ANTES de editar:
1. git pull origin main
2. Verificar que index.html tiene 6000+ líneas y título "GEAT CRM"

### AL editar:
1. NUNCA reconstruir — solo editar secciones
2. NUNCA borrar funciones existentes
3. Usar grep -n para encontrar líneas exactas
4. Validar JS después de CADA edición

### Supabase — patrones correctos:
- CORRECTO: try{ await sb.from('tabla').insert([datos]); }catch(e){}
- CORRECTO: sb.from('tabla').insert([datos]).then(function(){});
- INCORRECTO: sb.from('tabla').insert([datos]).catch(function(){})

### CSS clases:
- Inputs: finput, fselect, ftextarea
- Botones: btn, btn-primary, btn-ghost, btn-red, btn-sm
- NUNCA usar: fi, fsel, fa

### DESPUÉS de editar:
1. node --check para validar JS
2. git commit mensaje en español
3. git push origin main

### NUNCA:
- Hardcodear API keys
- Mostrar montos USD al equipo (solo m²)
- Dejar console.log
- Usar .catch() directo en sb.from().insert()
- Crear archivos nuevos separados
