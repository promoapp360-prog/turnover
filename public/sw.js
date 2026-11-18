// Service worker PWA: rende installabile il gestionale e mette in cache solo i file statici.
// I dati (API) non vengono mai messi in cache: sono sempre letti dal server.
const CACHE = 'pa-static-v1';
const SHELL = ['/admin/', '/admin/assets/admin.css', '/admin/assets/app.js', '/admin/assets/lib.js', '/favicon.svg'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/admin')) {
    // network-first: aggiornamenti immediati, cache solo se offline
    e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); if (r.ok) caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('/admin/'))));
  }
});
