// burncpu service worker — minimal app-shell cache + network-first for API.
// Strategy:
//   - precache the shell (index.html, favicon, manifest) at install
//   - API + RSS + media: pass through to network (no cache)
//   - hashed assets (/assets/*): cache-first (immutable per filename)
//   - HTML navigations: network-first with shell fallback for offline

const CACHE = 'burncpu-shell-v1';
const SHELL = ['/', '/index.html', '/favicon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

// Web Push: show the notification from the encrypted payload.
self.addEventListener('push', (event) => {
  let data = { title: 'burncpu', body: '', url: '/' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch (_) {}
  const opts = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/favicon.svg',
    data: { url: data.url },
    tag: data.kind || 'burncpu',
    renotify: false,
  };
  event.waitUntil(self.registration.showNotification(data.title, opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(clients.matchAll({ type: 'window' }).then((all) => {
    for (const c of all) {
      if (c.url.includes(url) && 'focus' in c) return c.focus();
    }
    return clients.openWindow(url);
  }));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API, RSS, or media — always live
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/rss/') ||
      url.pathname.startsWith('/media/') || url.pathname === '/healthz') {
    return;
  }

  // Hashed assets — cache-first
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit ||
        fetch(req).then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return resp;
        })),
    );
    return;
  }

  // HTML / navigation — network-first, fall back to cached shell on offline
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html')),
    );
  }
});
