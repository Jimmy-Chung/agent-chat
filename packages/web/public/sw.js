// Service Worker for agent-chat — handles Web Push notifications.

// AIT-175: skip the system notification when the app is already in the
// foreground. The in-app WS UI reflects the update live, so a system
// notification would be a duplicate, noisy interruption.
function hasVisibleWindow(clientList) {
  return clientList.some((c) => c.visibilityState === 'visible')
}

self.addEventListener('push', (event) => {
  if (!event.data) return
  let data = {}
  try {
    data = event.data.json()
  } catch {
    data = { body: event.data.text() }
  }
  const {
    title = 'agent-chat',
    body = '',
    tag,
    icon = '/icon-192.png',
    url = '/',
  } = data
  event.waitUntil(
    // biome-ignore lint: clients is a SW global
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Foreground de-dup: a visible window means the user is already looking
        // at the app — don't pop a system notification on top of it.
        if (hasVisibleWindow(clientList)) return
        return self.registration.showNotification(title, {
          body,
          tag,
          icon,
          badge: '/icon-192.png',
          data: { url },
        })
      }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url ?? '/'
  // The push payload encodes the destination topic as `?topic=<id>`. Parse it so
  // we can route an already-open PWA window to that topic without a full reload.
  let topic = null
  try {
    topic = new URL(targetUrl, self.location.origin).searchParams.get('topic')
  } catch {
    topic = null
  }
  event.waitUntil(
    // biome-ignore lint: clients is a SW global
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Prefer focusing an existing same-origin window and routing it to the
        // target topic via postMessage (SPA navigation, no reload / state loss).
        const existing = clientList.find((c) => {
          try {
            return (
              new URL(c.url).origin === self.location.origin && 'focus' in c
            )
          } catch {
            return false
          }
        })
        if (existing) {
          if (topic)
            existing.postMessage({ type: 'agent-chat:navigate', topic })
          return existing.focus()
        }
        // No window open — open a fresh one at the topic URL.
        // biome-ignore lint: clients is a SW global
        return clients.openWindow(targetUrl)
      }),
  )
})
