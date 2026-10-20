// Service Worker: cache do shell (offline básico) + Web Push.
export {};
declare const self: any;

const CACHE = 'wall-v1';

self.addEventListener('install', (e: any) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png']))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e: any) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e: any) => {
  const req: Request = e.request;
  const url = new URL(req.url);
  // API nunca é cacheada (dados sempre frescos); só GET same-origin
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    // Rede primeiro; se offline, devolve o shell em cache
    e.respondWith(
      fetch(req)
        .then((r) => {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return r;
        })
        .catch(() => caches.match('/') as Promise<Response>)
    );
    return;
  }
  // Assets: cache primeiro, atualizando em segundo plano
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((r) => {
          if (r.ok) {
            const copy = r.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return r;
        })
        .catch(() => hit as Response);
      return hit || net;
    })
  );
});

// ---- PUSH ----
self.addEventListener('push', (e: any) => {
  let d: any = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { body: e.data?.text() };
  }
  e.waitUntil(
    self.registration.showNotification(d.title || 'Wall Dashboard', {
      body: d.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: d.url || '/' },
    })
  );
});

// Ao tocar na notificação: foca a PWA aberta ou abre uma nova
self.addEventListener('notificationclick', (e: any) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs: any[]) => {
      for (const c of cs) if ('focus' in c) return c.focus();
      return self.clients.openWindow(url);
    })
  );
});
