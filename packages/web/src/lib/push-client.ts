'use client'

const SW_PATH = '/sw.js'

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.register(SW_PATH, { scope: '/' })
    return reg
  } catch (err) {
    console.warn('SW registration failed', err)
    return null
  }
}

export async function getVapidPublicKey(serverUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${serverUrl}/push/vapid-key`)
    if (!res.ok) return null
    const data = await res.json() as { publicKey?: string }
    return data.publicKey ?? null
  } catch {
    return null
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((base64.length + 3) % 4)
  const binary = atob(padded)
  const buf = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i)
  return buf
}

export async function subscribePush(
  reg: ServiceWorkerRegistration,
  vapidPublicKey: string,
): Promise<PushSubscription | null> {
  try {
    const existing = await reg.pushManager.getSubscription()
    if (existing) return existing
    return await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    })
  } catch (err) {
    console.warn('Push subscribe failed', err)
    return null
  }
}

export async function saveSubscriptionToServer(
  sub: PushSubscription,
  serverUrl: string,
  token: string,
): Promise<boolean> {
  const json = sub.toJSON()
  try {
    const res = await fetch(`${serverUrl}/push/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh ?? '',
        auth: json.keys?.auth ?? '',
      }),
    })
    return res.ok
  } catch {
    return false
  }
}
