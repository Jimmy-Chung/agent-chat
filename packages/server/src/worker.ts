import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createConfig, type Env, type AppConfig } from './config'
import type { TopicDurableObject } from './ws/topic-do'
import { initDb, runMigrations } from './db/migrate'
import { logger, setLogLevel } from './logger'
import { seedSystemTopics } from './seed'
import { initR2 } from './r2/client'
import { getD1 } from './db/migrate'

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

app.get('/debug', (c) => {
  return c.json({
    token: '***',
    piAdapterToken: '***',
    piAdapterUrl: 'set',
    initialized,
  })
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

    // WebSocket upgrade → route to DO
    if (url.pathname === '/ws') {
      try {
        const upgradeHeader = request.headers.get('Upgrade')
        if (upgradeHeader !== 'websocket') {
          return new Response('Expected Upgrade: websocket', { status: 426 })
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
        await stub.setConfig(appConfig, topicId)
        return stub.fetch(request)
      } catch (e) {
        return new Response(`ws error: ${String(e)}`, { status: 500 })
      }
    }

    return app.fetch(request)
  },
}
