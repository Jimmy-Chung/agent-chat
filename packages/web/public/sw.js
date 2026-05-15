// Service Worker for agent-chat — handles Web Push notifications
'use strict'

self.addEventListener('push', (event) => {
  if (!event.data) return
  let data = {}
  try {
    data = event.data.json()
  } catch {
    data = { body: event.data.text() }
  }
  const { title = 'agent-chat', body = '', tag, icon = '/icon-192.png', url = '/' } = data
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon,
      badge: '/icon-192.png',
      data: { url },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/'
  event.waitUntil(
    // biome-ignore lint: clients is a SW global
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        const existing = clientList.find((c) => 'focus' in c)
        if (existing) return existing.focus()
        // biome-ignore lint: clients is a SW global
        return clients.openWindow(url)
      })
  )
})
