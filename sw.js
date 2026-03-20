/* FPL Cortex — Service Worker */
const CACHE = 'fpl-cortex-v1';
const STATIC = ['/', '/index.html', '/style.css', '/script.js'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Cache-first for static assets, network-first for API
  if (url.pathname.startsWith('/api/') || url.hostname !== location.hostname) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
  } else {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const net = fetch(e.request).then(res => {
          if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          return res;
        });
        return cached || net;
      })
    );
  }
});

// Push notification handler
self.addEventListener('push', e => {
  const data = e.data?.json() || { title: 'FPL Cortex', body: 'New update available' };
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/manifest.json',
    badge: '/manifest.json',
    tag: 'fpl-cortex',
    data: data.url || '/',
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data));
});
