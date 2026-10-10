/* FPL Cortex v2 service worker: app shell cache, network-first API, web push. */
const CACHE = 'cortex-v2-3';
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
  e.waitUntil(self.registration.showNotification(d.title || 'FPL Cortex', { body: d.body || '', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: d.key || 'cortex', renotify: true, vibrate: [120, 60, 120], timestamp: Date.now(), data: { url: d.url || '/app/' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || e.notification.data || '/app/', self.location.origin).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    const w = ws.find(c => c.url.startsWith(self.location.origin + '/app'));
    if (w) { w.navigate(url).catch(() => {}); return w.focus(); }
    return clients.openWindow(url);
  }));
});
// Browser rotated the push subscription: re-register it with the same prefs.
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    const cfg = await fetch('/api/account?route=config').then(r => r.json()).catch(() => ({}));
    if (!cfg.vapidPublicKey) return;
    const k = cfg.vapidPublicKey.replace(/-/g, '+').replace(/_/g, '/'); const raw = atob(k + '='.repeat((4 - k.length % 4) % 4));
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, c => c.charCodeAt(0)) });
    if (e.oldSubscription) await fetch('/api/account?route=push-unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: e.oldSubscription.endpoint }) }).catch(() => {});
    await fetch('/api/account?route=push-subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
  })());
});
