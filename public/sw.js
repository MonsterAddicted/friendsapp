// friendsapp service worker: shows push notifications and opens the app when tapped.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (e) => {
  let d = {}
  try {
    d = e.data ? e.data.json() : {}
  } catch {
    d = { body: e.data ? e.data.text() : '' }
  }
  e.waitUntil(
    self.registration.showNotification(d.title || 'friendsapp', {
      body: d.body || '',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      data: { url: d.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin) && 'focus' in c) {
          c.navigate(url)
          return c.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
