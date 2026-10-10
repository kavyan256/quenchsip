// Service worker: keeps the volunteer page's files on the phone so it opens without signal.
// API calls (/api/* or another origin) are never cached; taps are queued in IndexedDB by the page.
const CACHE = 'quench-v6';
const SHELL = ['v.html', 'v.js', 'api.js', 'queue.js', 'i18n.js', 'art.js', 'style.css', 'fonts/nunito-latin.woff2', 'core/tap.js', 'core/sync.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Network first (so updates arrive), cached copy when offline. v.html?e=..&s=.. matches the cached v.html.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});
