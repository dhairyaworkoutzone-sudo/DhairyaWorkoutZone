// Brothers Gym — Service Worker
// Handles: Push notifications, offline cache, background sync

const CACHE = 'brothers-gym-v1';
const OFFLINE_URLS = ['/portal', '/manifest.json'];

// ── Install ──────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(OFFLINE_URLS)).then(() => self.skipWaiting())
  );
});

// ── Activate ─────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch — network first, cache fallback ────────────────
self.addEventListener('fetch', e => {
  // Only handle GET requests to same origin
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith(self.location.origin)) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Cache successful responses for portal pages
        if (res.ok && (e.request.url.includes('/portal') || e.request.url.includes('/manifest'))) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── Push Notification ─────────────────────────────────────
self.addEventListener('push', e => {
  let data = { title: 'Brothers Gym', body: 'You have a new notification', type: 'info' };
  try { data = { ...data, ...e.data.json() }; } catch(err) {}

  const icons = {
    live:       '🔴',
    expiry:     '⚠️',
    renewal:    '✅',
    announcement: '📢',
    info:       '💪'
  };

  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.type || 'general',
    renotify: true,
    requireInteraction: data.type === 'live' || data.type === 'expiry',
    data: { url: data.url || '/portal', type: data.type },
    actions: data.type === 'live'
      ? [{ action: 'watch', title: '▶ Watch Now' }, { action: 'dismiss', title: 'Dismiss' }]
      : data.type === 'expiry'
      ? [{ action: 'renew', title: '🔄 Renew Now' }, { action: 'dismiss', title: 'Later' }]
      : [{ action: 'open', title: 'Open App' }],
    vibrate: data.type === 'live' ? [200, 100, 200] : [100]
  };

  e.waitUntil(self.registration.showNotification(data.title || 'Brothers Gym 💪', options));
});

// ── Notification Click ────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const action = e.action;
  const data = e.notification.data || {};

  let url = '/portal';
  if (action === 'watch' || data.type === 'live') url = '/portal#live';
  if (action === 'renew' || data.type === 'expiry') url = '/portal#membership';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('/portal') && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── Background Sync (check membership on reconnect) ──────
self.addEventListener('sync', e => {
  if (e.tag === 'check-membership') {
    e.waitUntil(checkMembershipStatus());
  }
});

async function checkMembershipStatus() {
  try {
    const cache = await caches.open(CACHE);
    const sessReq = await cache.match('/api/session');
    if (!sessReq) return;
  } catch(e) {}
}