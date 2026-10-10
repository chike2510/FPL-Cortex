/* FPL Cortex v2 service worker: app shell cache, network-first API, web push. */
const CACHE = 'cortex-v2-2';
const SHELL = ['/app/', '/manifest.json', '/icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/classic/')) return;
  if (url.pathname.startsWith('/api/')) { e.respondWith(fetch(e.request).catch(() => caches.match(e.request))); return; }
  if (e.request.mode === 'navigate' && url.pathname.startsWith('/app')) { e.respondWith(fetch(e.request).catch(() => caches.match('/app/'))); return; }
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return res; })));
  }
});
self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json(); } catch { d = { title: 'FPL Cortex', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'FPL Cortex', { body: d.body || '', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: d.key || 'cortex', data: d.url || '/app/' }));
});
self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(clients.openWindow(e.notification.data || '/app/')); });
