const CACHE = 'fixmycity-shell-v6';
const SHELL = ['index.html', 'app/app.css', 'app/app.js', 'app/translate.js', 'app/config.js', 'app/home.css', 'app/home.js', 'app/tour.js', 'app/home.html', 'app/brand.css', 'app/brand.html'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch supabase/CDN requests
  e.respondWith(
    fetch(req)
      .then((res) => {
        // Only cache complete, same-origin responses (skip 206 partial ranges and opaque ones).
        if (res.ok && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
