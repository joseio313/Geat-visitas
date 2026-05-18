const CACHE = 'crm-geat-v1';
const CORE = ['./', './index.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Supabase siempre va a la red — nunca cachear datos del CRM
  if (e.request.url.includes('supabase')) return;

  // Network-first para HTML: siempre intenta traer la versión nueva
  if (e.request.mode === 'navigate' || e.request.url.endsWith('index.html')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Cache-first para el resto (fonts, libs CDN, manifest, iconos)
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
