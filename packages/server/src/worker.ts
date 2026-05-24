import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createConfig, type Env, type AppConfig } from './config'
import type { TopicDurableObject } from './ws/topic-do'
import { initDb, runMigrations } from './db/migrate'
import { logger, setLogLevel } from './logger'
import { seedSystemTopics } from './seed'
import { initR2 } from './r2/client'
import { getD1 } from './db/migrate'
import { handleArtifactAccessRequest } from './r2/artifact-access'
import { createPushRoutes } from './routes/push'
import { getLogs, clearLogs } from './server-logs'

let initialized = false
let appConfig: AppConfig | null = null

async function initialize(env: Env) {
  if (initialized) return
  const config = createConfig(env)
  appConfig = config
  setLogLevel(config.logLevel as never)
  initDb(env.DB)
  await runMigrations()
  await seedSystemTopics()
  await initR2(config)
  initialized = true
  logger.info('Worker initialized')
}

const app = new Hono()
app.use('*', cors())

app.get('/healthz', async (c) => {
  try {
    const d1 = getD1()
    await d1.prepare('SELECT 1').first()
    return c.json({ status: 'ok', db: 'connected', timestamp: Date.now() })
  } catch {
    return c.json({ status: 'degraded', db: 'disconnected', timestamp: Date.now() }, 503)
  }
})

// Push notification routes — strip /push prefix before forwarding to sub-app
app.use('/push/*', async (c) => {
  if (!appConfig) return c.json({ error: 'not initialized' }, 500)
  const url = new URL(c.req.raw.url)
  url.pathname = url.pathname.replace(/^\/push/, '') || '/'
  return createPushRoutes(appConfig).fetch(new Request(url.toString(), c.req.raw))
})

app.get('/pi-healthz', async (c) => {
  const wssUrl = c.req.query('wssUrl')
  const piToken = c.req.query('piToken') || ''
  if (!wssUrl) return c.json({ ok: false, error: 'wssUrl query param required' }, 400)

  try {
    new URL(wssUrl)
  } catch {
    return c.json({ ok: false, error: 'Invalid wssUrl' }, 400)
  }

  const parsed = new URL(wssUrl)
  const healthzUrl = `${parsed.protocol === 'wss:' ? 'https' : 'http'}://${parsed.host}/healthz`

  try {
    const headers: Record<string, string> = {}
    if (piToken) headers['Authorization'] = `Bearer ${piToken}`
    const res = await fetch(healthzUrl, {
      headers,
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) {
      const text = await res.text()
      try {
        return c.json({ ok: false, ...JSON.parse(text) }, res.status as 200)
      } catch {
        return c.json({ ok: false, status: res.status }, res.status as 200)
      }
    }
    return c.json({ ok: true })
  } catch (err) {
    return c.json({ ok: false, error: String(err) }, 502)
  }
})

app.get('/debug', (c) => {
  return c.json({
    token: '***',
    piAdapterToken: '***',
    piAdapterUrl: 'set',
    initialized,
  })
})

// Server-side PI event logs for debugging (BUG-044)
app.get('/server-logs', (c) => {
  return c.json(getLogs())
})

app.post('/server-logs/clear', (c) => {
  clearLogs()
  return c.json({ ok: true, cleared: true })
})

export { TopicDurableObject } from './ws/topic-do'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      await initialize(env)
    } catch (e) {
      return new Response(`init error: ${String(e)}`, { status: 500 })
    }

    const url = new URL(request.url)

    if (!appConfig) return new Response('init error: config missing', { status: 500 })

    const artifactResponse = await handleArtifactAccessRequest(request, env, appConfig)
    if (artifactResponse) return artifactResponse

    // WebSocket upgrade → route to DO
    if (url.pathname === '/ws') {
      try {
        const secWebSocketKey = request.headers.get('Sec-WebSocket-Key')
        if (!secWebSocketKey) {
          return new Response('Expected WebSocket upgrade', { status: 426 })
        }

        // Validate token before forwarding to DO
        const token =
          url.searchParams.get('token') ||
          request.headers.get('Authorization')?.replace('Bearer ', '')
        if (!appConfig?.token || token !== appConfig.token) {
          return new Response('Unauthorized', { status: 401 })
        }

        const topicId = url.searchParams.get('topicId') || 'global'
        const doId = env.TOPIC_DO.idFromName(topicId)
        const stub = env.TOPIC_DO.get(doId) as DurableObjectStub<TopicDurableObject>

        // Allow frontend to override PI adapter config per connection
        const config = { ...appConfig }
        const piWssUrl = url.searchParams.get('piWssUrl')
        const piTokenParam = url.searchParams.get('piToken')
        if (piWssUrl) config.piAdapterUrl = piWssUrl
        if (piTokenParam) config.piAdapterToken = piTokenParam
        await stub.setConfig(config, topicId)
        return stub.fetch(request)
      } catch (e) {
        return new Response(`ws error: ${String(e)}`, { status: 500 })
      }
    }

    return app.fetch(request)
  },
}
