// Offline cache: the app keeps working at the pitch without signal.
// Always asks the server for the newest version first (bypassing the 10-minute
// browser cache GitHub Pages sets) and only falls back to the cache when offline.
const CACHE = 'kwsc-match-v32';
const FILES = ['./', './index.html', './handleiding.html', './manifest.webmanifest', './logo.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, {cache: 'reload'})))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const req = e.request;
  // only our own files; Firebase (live link) and other sites go straight to the network
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req.url, {cache: 'no-cache'})           // revalidate with the server every time
      .then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; })
      .catch(() => caches.match(req, {ignoreSearch: true}))   // offline: also serves index.html?volg=...
  );
});
