// GEAT CRM — Script de diagnóstico rápido
// Pegá esto en la consola del browser (F12) para diagnosticar cualquier fallo
// Uso: copiar todo, pegar en consola, Enter

(async () => {
  const r = {};

  // 1. Usuario logueado
  r.usuario = typeof cu !== 'undefined' ? `${cu.nombre} (${cu.rol})` : 'NO LOGUEADO';

  // 2. API key de Anthropic
  r.anthropic_key = typeof ANTHROPIC_KEY !== 'undefined'
    ? (ANTHROPIC_KEY.length > 0 ? `OK (${ANTHROPIC_KEY.length} chars, inicia: ${ANTHROPIC_KEY.slice(0,20)})` : 'VACÍA')
    : 'NO DEFINIDA';

  // 3. Supabase conectado
  try {
    const { data, error } = await sb.from('colaboradores').select('id').limit(1);
    r.supabase = error ? `ERROR: ${error.message}` : 'OK';
  } catch(e) { r.supabase = `CRASH: ${e.message}`; }

  // 4. Test API Anthropic
  if (typeof ANTHROPIC_KEY !== 'undefined' && ANTHROPIC_KEY.length > 0) {
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 10, messages: [{role:'user', content:'OK'}] })
      });
      const body = await resp.json();
      r.anthropic_api = resp.status === 200 ? 'OK ✓' : `ERROR ${resp.status}: ${body.error?.message}`;
    } catch(e) { r.anthropic_api = `CRASH: ${e.message}`; }
  } else {
    r.anthropic_api = 'SALTADO (key vacía)';
  }

  // 5. Elementos críticos del DOM
  const elementos = ['audio-overlay', 'audio-st-rec', 'audio-st-proc', 'audio-st-result', 'audio-st-err', 'audio-hint', 'audio-err-msg'];
  r.dom = {};
  elementos.forEach(id => { r.dom[id] = document.getElementById(id) ? 'OK' : 'NULL ⚠'; });

  // 6. btn-mic (el que causó el bug del grabador)
  r.dom['btn-mic'] = document.getElementById('btn-mic') ? 'OK' : 'NULL (normal si el sheet está cerrado)';

  // 7. SpeechRecognition disponible
  r.speechRecognition = (window.SpeechRecognition || window.webkitSpeechRecognition) ? 'DISPONIBLE ✓' : 'NO DISPONIBLE (iOS/Firefox)';

  // 8. Variables globales clave
  r.globals = {
    allLeads: typeof allLeads !== 'undefined' ? `${allLeads.length} leads` : 'NO DEFINIDA',
    calEventos: typeof calEventos !== 'undefined' ? `${(calEventos||[]).length} eventos` : 'NO DEFINIDA',
    colaboradores: typeof colaboradores !== 'undefined' ? `${colaboradores.length} colaboradores` : 'NO DEFINIDA',
  };

  console.log('=== DIAGNÓSTICO GEAT CRM ===');
  console.table(r);
  console.log('DOM:', r.dom);
  console.log('Globals:', r.globals);
  return r;
})();
