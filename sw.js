/* FPL CORTEX — Service Worker v3 (Speed Optimised) */
const CACHE = 'fpl-cortex-v3';
const STATIC = ['/', '/index.html', '/style.css', '/script.js', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // API calls: network first, cache fallback
  if (url.pathname.startsWith('/api/') || url.hostname !== location.hostname || url.hostname.includes('corsproxy') || url.hostname.includes('allorigins')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  // Static assets: cache first, network fallback
  e.respondWith(caches.match(e.request).then(cached => {
    const net = fetch(e.request).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
      return res;
    });
    return cached || net;
  }));
});
self.addEventListener('push', e => {
  const data = e.data?.json() || { title:'FPL Cortex', body:'New update!' };
  e.waitUntil(self.registration.showNotification(data.title, { body:data.body, icon:'/manifest.json', tag:'fpl-cortex', data:data.url||'/' }));
});
self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(clients.openWindow(e.notification.data)); });
