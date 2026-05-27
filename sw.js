const CACHE = 'fleet-pro-v1';
const ASSETS = [
  '/',
  '/conductor.html',
  '/manifest.json',
  '/manifest-conductor.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {}))
  );
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
  // No interceptar peticiones de API ni socket.io
  if (e.request.url.includes('/api/') ||
      e.request.url.includes('/gps') ||
      e.request.url.includes('/socket.io')) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => cached))
  );
});

// Mantener SW vivo para GPS en segundo plano
self.addEventListener('message', e => {
  if (e.data === 'keepalive') {
    // Responder para mantener el worker activo
    e.source && e.source.postMessage('alive');
  }
});
