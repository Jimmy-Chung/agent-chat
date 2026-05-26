'use client'

import {
  getVapidPublicKey,
  registerServiceWorker,
  saveSubscriptionToServer,
  subscribePush,
} from '@/lib/push-client'
import { getServerBase } from '@/lib/server-url'
import { useTopicStore } from '@/stores/topic-store'
import { useEffect } from 'react'

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

  // AIT-175: when the user taps a system notification, the SW focuses the open
  // window and posts a navigate message. Route the SPA to the target topic so
  // the user lands on the conversation that triggered the notification.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator))
      return
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; topic?: string } | undefined
      if (data?.type === 'agent-chat:navigate' && data.topic) {
        useTopicStore.getState().selectTopic(data.topic)
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () =>
      navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [])

  return null
}

export async function requestPushPermission(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (!('Notification' in window) || !('serviceWorker' in navigator))
    return false

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
