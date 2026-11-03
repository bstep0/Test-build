/* SplashDesk service worker: app shell works offline; field data is served from the last good response. */
const SHELL = 'sd-shell-v2', API = 'sd-api';
const CORE = ['/', '/style.css', '/app.js', '/ui.js', '/theme.js', '/features.js', '/boot.js', '/dosing.js', '/geo.js', '/manifest.webmanifest', '/icon-192.png'];
const API_CACHEABLE = /^\/api\/(day\/[\d-]+|visits\/\d+|settings|techs|products|pool-history\/\d+|auth\/me|visits\/\d+\/photos)$/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL && k !== API).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'clear-api') caches.delete(API); });

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    if (!API_CACHEABLE.test(url.pathname)) return;
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(API)).put(req, res.clone());
        return res;
      } catch {
        const hit = await caches.match(req, { cacheName: API });
        return hit || new Response(JSON.stringify({ error: 'Offline and not saved on this device yet' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }
  if (/^\/(portal|quote|pay)\//.test(url.pathname)) return;
  e.respondWith((async () => {          // static: cached copy now, refreshed in the background
    const cache = await caches.open(SHELL), hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    return hit || (await net) || (req.mode === 'navigate' ? cache.match('/') : Response.error());
  })());
});
