'use client'

import { useEffect } from 'react'
import {
  registerServiceWorker,
  getVapidPublicKey,
  subscribePush,
  saveSubscriptionToServer,
} from '@/lib/push-client'
import { getServerBase } from '@/lib/server-url'

const SERVER_URL = getServerBase()

function getToken(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('AGENT_CHAT_TOKEN') ?? ''
}

export function PushSetup() {
  useEffect(() => {
    async function setup() {
      if (typeof window === 'undefined') return
      if (!('Notification' in window)) return
      if (Notification.permission === 'denied') return

      const reg = await registerServiceWorker()
      if (!reg) return

      // Only auto-subscribe if permission already granted; otherwise wait for user action
      if (Notification.permission !== 'granted') return

      const publicKey = await getVapidPublicKey(SERVER_URL)
      if (!publicKey) return

      const sub = await subscribePush(reg, publicKey)
      if (!sub) return

      const token = getToken()
      if (token) await saveSubscriptionToServer(sub, SERVER_URL, token)
    }

    setup().catch(() => {})
  }, [])

  return null
}

export async function requestPushPermission(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return false

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return false

  const reg = await registerServiceWorker()
  if (!reg) return false

  const publicKey = await getVapidPublicKey(SERVER_URL)
  if (!publicKey) return false

  const sub = await subscribePush(reg, publicKey)
  if (!sub) return false

  const token = getToken()
  return token ? saveSubscriptionToServer(sub, SERVER_URL, token) : false
}
