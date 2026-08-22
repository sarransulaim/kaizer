/**
 * Service worker for push notifications.
 *
 * Intentionally minimal — no offline caching. Kitchen staff need to know when
 * they're looking at stale order data, and a cache that silently serves an old
 * board during a service is worse than a page that fails to load.
 */

self.addEventListener('push', (event) => {
  if (!event.data) return

  let data
  try {
    data = event.data.json()
  } catch {
    data = { title: 'Kaizr', body: event.data.text() }
  }

  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Kaizr', {
      body: data.body ?? '',
      icon: '/icon-192.png',
      badge: '/badge-96.png',
      vibrate: [100, 50, 100],
      // Replaces an earlier alert about the same thing instead of stacking.
      tag: data.tag ?? 'kaizr',
      renotify: Boolean(data.tag),
      data: { url: data.url ?? '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const target = event.notification.data?.url ?? '/'

  /* Focus an already-open window rather than launching a second copy of the
     app — tapping a prep alert should land on the running PWA. */
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.navigate(target)
            return client.focus()
          }
        }
        return self.clients.openWindow(target)
      }),
  )
})
