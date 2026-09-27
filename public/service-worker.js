const CACHE_NAME = 'qdii-monitor-shell-v3';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './data/snapshot.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(SHELL.map((asset) => cache.add(asset).catch(() => null)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return markOffline(cached);
        if (request.mode === 'navigate') {
          const fallback = await caches.match('./index.html');
          if (fallback) return markOffline(fallback);
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      })
  );
});

async function markOffline(response) {
  const headers = new Headers(response.headers);
  headers.set('X-QDII-Offline', '1');
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
