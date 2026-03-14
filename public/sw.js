// Brothers Gym — Service Worker v3
// Handles: Push notifications, offline cache, background sync

const CACHE = 'brothers-gym-v3';
const OFFLINE_URLS = ['/portal', '/manifest.json', '/icon-192.png'];

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
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith(self.location.origin)) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok && (
          e.request.url.includes('/portal') ||
          e.request.url.includes('/manifest') ||
          e.request.url.includes('/icon-')
        )) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── Push Notification ─────────────────────────────────────
// Fires when server sends a push (or polled notification triggers it)
self.addEventListener('push', e => {
  let data = {
    title: 'Brothers Gym 💪',
    body: 'You have a new notification',
    type: 'info',
    url: '/portal'
  };
  try { data = { ...data, ...e.data.json() }; } catch(err) {}

  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.type || 'general',
    renotify: true,
    requireInteraction: data.type === 'live' || data.type === 'expiry' || data.type === 'announcement',
    data: { url: data.url || '/portal', type: data.type },
    actions: data.type === 'live'
      ? [{ action: 'watch',   title: '▶ Watch Now'     }, { action: 'dismiss', title: 'Dismiss' }]
      : data.type === 'expiry'
      ? [{ action: 'renew',   title: '🔄 Renew Now'    }, { action: 'dismiss', title: 'Later'   }]
      : data.type === 'announcement'
      ? [{ action: 'read',    title: '📢 Read Now'     }, { action: 'dismiss', title: 'Later'   }]
      : [{ action: 'open',    title: '💪 Open App'     }],
    vibrate: data.type === 'live'         ? [300, 100, 300, 100, 300]
           : data.type === 'expiry'       ? [200, 100, 200]
           : data.type === 'announcement' ? [150, 100, 150]
           : [100]
  };

  e.waitUntil(
    self.registration.showNotification(data.title || 'Brothers Gym 💪', options)
  );
});

// ── Notification Click ────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const action = e.action;
  const data   = e.notification.data || {};

  let url = '/portal';
  if (action === 'watch' || data.type === 'live')         url = '/portal';
  if (action === 'renew' || data.type === 'expiry')       url = '/portal';
  if (action === 'read'  || data.type === 'announcement') url = '/portal';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // If portal is already open, focus it
      for (const client of clientList) {
        if (client.url.includes('/portal') && 'focus' in client) {
          client.focus();
          // Tell the page which section to show
          client.postMessage({ type: 'navigate', section: data.type });
          return;
        }
      }
      // Otherwise open new window
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── Notification Close ────────────────────────────────────
self.addEventListener('notificationclose', e => {
  // Can be used for analytics in the future
  console.log('[SW] Notification dismissed:', e.notification.tag);
});

// ── Background Sync ───────────────────────────────────────
self.addEventListener('sync', e => {
  if (e.tag === 'check-membership') {
    e.waitUntil(checkMembershipStatus());
  }
  if (e.tag === 'poll-notifications') {
    e.waitUntil(pollNotifications());
  }
});

async function checkMembershipStatus() {
  try {
    const cache = await caches.open(CACHE);
    const sessReq = await cache.match('/api/session');
    if (!sessReq) return;
    // Could check expiry and notify here in future
  } catch(e) {}
}

async function pollNotifications() {
  // Background poll for push messages when online
  try {
    const cache  = await caches.open(CACHE);
    const sessRes = await cache.match('__session__');
    if (!sessRes) return;
    const sess = await sessRes.json();
    if (!sess || !sess.phone) return;
    const res  = await fetch('/api/push/poll?phone=' + encodeURIComponent(sess.phone));
    const msgs = await res.json();
    if (!Array.isArray(msgs) || !msgs.length) return;
    for (const m of msgs) {
      await self.registration.showNotification(m.title || 'Brothers Gym 💪', {
        body:   m.body,
        icon:   '/icon-192.png',
        badge:  '/icon-192.png',
        tag:    m.type || 'bg',
        data:   { url: m.url || '/portal', type: m.type },
        requireInteraction: ['live','expiry','announcement'].includes(m.type),
        vibrate: [200, 100, 200]
      });
    }
  } catch(e) {}
}

// ── Message from page ─────────────────────────────────────
self.addEventListener('message', e => {
  if (!e.data) return;

  if (e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  // Page sends session so SW can use it for background polling
  if (e.data.type === 'SAVE_SESSION') {
    caches.open(CACHE).then(cache => {
      cache.put('__session__', new Response(JSON.stringify(e.data.session), {
        headers: { 'Content-Type': 'application/json' }
      }));
    });
  }

  // Trigger immediate notification poll
  if (e.data.type === 'POLL_NOW') {
    pollNotifications();
  }
});