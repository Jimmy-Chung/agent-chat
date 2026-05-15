import { Hono } from 'hono'
import type { AppConfig } from '../config'
import * as pushRepo from '../db/repos/push-subscription.repo'
import { buildVapidAuthHeader } from '../lib/vapid'
import { encryptPushPayload } from '../lib/web-push'

export function createPushRoutes(config: AppConfig) {
  const app = new Hono()

  // Public: return VAPID public key for frontend subscription
  app.get('/vapid-key', (c) => {
    if (!config.vapidPublicKey) {
      return c.json({ error: 'Push not configured' }, 503)
    }
    return c.json({ publicKey: config.vapidPublicKey })
  })

  // Authenticated: save or update a push subscription
  app.post('/subscribe', async (c) => {
    const token =
      c.req.query('token') ?? c.req.header('Authorization')?.replace('Bearer ', '')
    if (token !== config.token) return c.json({ error: 'Unauthorized' }, 401)

    const body = await c.req.json<{ endpoint: string; p256dh: string; auth: string }>()
    if (!body?.endpoint || !body?.p256dh || !body?.auth) {
      return c.json({ error: 'Missing fields' }, 400)
    }
    await pushRepo.upsertSubscription(body.endpoint, body.p256dh, body.auth)
    return c.json({ ok: true })
  })

  // Authenticated: step-by-step push diagnosis
  app.post('/test', async (c) => {
    const token =
      c.req.query('token') ?? c.req.header('Authorization')?.replace('Bearer ', '')
    if (token !== config.token) return c.json({ error: 'Unauthorized' }, 401)
    if (!config.vapidPublicKey || !config.vapidPrivateKey) {
      return c.json({ error: 'VAPID not configured' }, 503)
    }

    const timeout = <T>(ms: number, p: Promise<T>): Promise<T> =>
      Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms))])

    const subs = await pushRepo.listSubscriptions()
    if (subs.length === 0) return c.json({ ok: true, sent: 0, message: 'No subscriptions' })

    const results: { endpoint: string; step: string; status: string }[] = []
    await Promise.all(
      subs.map(async (sub) => {
        const ep = sub.endpoint.slice(0, 60)
        let step = 'encrypt'
        try {
          const encrypted = await timeout(5000, encryptPushPayload(
            JSON.stringify({ title: 'agent-chat 测试', body: '推送链路工作正常 ✓', tag: 'test' }),
            sub,
          ))
          step = 'vapid'
          const authHeader = await timeout(5000, buildVapidAuthHeader(
            sub.endpoint,
            config.vapidPrivateKey,
            config.vapidPublicKey,
            config.vapidSubject,
          ))
          step = 'fetch'
          const res = await timeout(10000, fetch(sub.endpoint, {
            method: 'POST',
            headers: {
              Authorization: authHeader,
              'Content-Type': 'application/octet-stream',
              'Content-Encoding': encrypted.contentEncoding,
              TTL: '86400',
            },
            body: encrypted.body,
          }))
          const text = res.ok ? '' : await res.text().catch(() => '')
          results.push({ endpoint: ep, step: 'done', status: res.ok ? 'ok' : `HTTP ${res.status} ${text.slice(0, 120)}` })
        } catch (err) {
          results.push({ endpoint: ep, step, status: String(err) })
        }
      }),
    )
    return c.json({ ok: true, results })
  })

  // Dev diagnostic: test outbound fetch
  app.get('/test-fetch', async (c) => {
    const timeout = <T>(ms: number, p: Promise<T>): Promise<T> =>
      Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms))])
    try {
      const res = await timeout(8000, fetch('https://www.google.com/'))
      return c.json({ ok: true, status: (res as Response).status })
    } catch (err) {
      return c.json({ ok: false, error: String(err) })
    }
  })

  // Authenticated: remove a push subscription
  app.delete('/subscribe', async (c) => {
    const token =
      c.req.query('token') ?? c.req.header('Authorization')?.replace('Bearer ', '')
    if (token !== config.token) return c.json({ error: 'Unauthorized' }, 401)

    const body = await c.req.json<{ endpoint: string }>()
    if (!body?.endpoint) return c.json({ error: 'Missing endpoint' }, 400)
    await pushRepo.deleteSubscription(body.endpoint)
    return c.json({ ok: true })
  })

  return app
}
