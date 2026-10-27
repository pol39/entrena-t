// Service worker mínimo: la app abre sin conexión (interfaz y librería de Excel en caché).
// Los datos de Supabase NUNCA se guardan aquí. Sube VERSION cuando publiques una versión nueva.
const VERSION = 'v1';
const CORE = `core-${VERSION}`;
const RUNTIME = `runtime-${VERSION}`;
const SHELL = [
  './', './index.html', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png',
  './lib/xlsx.full.min.js',
  './css/base.css', './css/components.css', './css/gym.css',
  './js/app.js', './js/auth.js', './js/clientApp.js', './js/clientData.js', './js/config.js',
  './js/consent.js', './js/excelParser.js', './js/fx.js', './js/importPlan.js', './js/metrics.js',
  './js/plans.js', './js/supabaseClient.js', './js/trainerApp.js', './js/trainerClients.js',
  './js/trainerPlans.js', './js/ui.js', './js/viewCycle.js', './js/viewGuide.js',
  './js/viewHome.js', './js/viewSession.js', './js/welcome.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CORE)
      // allSettled: si un archivo aún no existe, la instalación no falla
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CORE && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Archivos propios: primero la red (así ves los cambios al instante) y, sin conexión, la copia guardada.
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(CORE)).put(request, response.clone());
    return response;
  } catch {
    return (await caches.match(request)) || (request.mode === 'navigate' ? caches.match('./index.html') : Response.error());
  }
}

// Fuentes y librería de Supabase: copia guardada al instante y se refresca en segundo plano.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(request);
  const update = fetch(request)
    .then((r) => { if (r.ok || r.type === 'opaque') cache.put(request, r.clone()); return r; })
    .catch(() => cached);
  return cached || update;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.hostname.endsWith('.supabase.co')) return; // datos y vídeos: siempre en directo
  if (url.origin === self.location.origin) event.respondWith(networkFirst(request));
  else if (/(^|\.)(jsdelivr\.net|googleapis\.com|gstatic\.com)$/.test(url.hostname)) event.respondWith(staleWhileRevalidate(request));
});
