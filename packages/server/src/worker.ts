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
import { createPairingRoutes, issueJitJwt } from './pairing/routes'
import { createAttentionRoutes } from './routes/attention'
import { piWsToHttpBase } from '@agent-chat/protocol'

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

// Device pairing API (AIT-216): /api/agent-chat/v1/pairing, /devices/token, /.well-known/jwks.json
app.route('/', createPairingRoutes(() => appConfig))

// Attention 分析 LLM 代理 (AIT-220): POST /api/agent-chat/v1/attention/interpret
app.route('/', createAttentionRoutes(() => appConfig))

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
    initialized,
  })
})

// Server-side PI event logs for debugging (BUG-044)
app.get('/server-logs', async (c) => {
  const sessionId = c.req.query('sessionId') ?? undefined
  const topicId = c.req.query('topicId') ?? undefined
  const messageId = c.req.query('messageId') ?? undefined
  const turnId = c.req.query('turnId') ?? undefined
  const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined
  const from = c.req.query('from') ? Number(c.req.query('from')) : undefined
  const to = c.req.query('to') ? Number(c.req.query('to')) : undefined
  return c.json(await getLogs({ sessionId, topicId, messageId, turnId, limit, from, to }))
})

app.post('/server-logs/clear', async (c) => {
  await clearLogs()
  return c.json({ ok: true, cleared: true })
})

// Proxy: fetch adapter /api/agent-chat/v1/adapter-status
// PI adapter URL comes from frontend query param since server has no server-side PI_ADAPTER_URL
app.get('/api/agent-chat/v1/adapter-status', async (c) => {
  const wssUrl = c.req.query('wssUrl')
  const piToken = c.req.query('piToken') || ''
  const deviceCredential = c.req.query('deviceCredential') || ''
  const adapterInstanceId = c.req.query('adapterInstanceId') || ''
  const pairedAdapterWssUrl = c.req.query('pairedAdapterWssUrl') || ''
  if (!wssUrl) return c.json({ version: 'not_configured', reachable: false, lastError: 'not_configured' })

  try {
    const url = `${piWsToHttpBase(wssUrl)}/adapter-status`
    const headers = await getAdapterHttpHeaders(wssUrl, piToken, deviceCredential, adapterInstanceId, new URL(c.req.url).origin, {
      fetchLiveAdapterInstanceId: false,
      allowAdapterRebind: true,
      adapterStatusWssUrl: pairedAdapterWssUrl || wssUrl,
    })
    if (!headers) return c.json({ version: 'unauthorized', reachable: false, lastError: 'Unauthorized' }, 401)
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return c.json({ version: 'unknown', reachable: false, lastError: `HTTP ${res.status}` })
    const data = await res.json() as Record<string, unknown>
    return c.json({ ...data, reachable: true }, 200, { 'Cache-Control': 'no-store' })
  } catch (err) {
    return c.json({
      version: 'unreachable',
      reachable: false,
      lastError: err instanceof Error ? err.message : String(err),
    })
  }
})

// ─── Provider config HTTP proxy → adapter ────────────────────────────────────
// The PI adapter URL + token come from the frontend as query params (same
// pattern as /api/agent-chat/v1/adapter-status).

const PI_PROXY_TIMEOUT_MS = 8_000

function piAdapterHeaders(piToken: string): Record<string, string> {
  return piToken ? { Authorization: `Bearer ${piToken}` } : {}
}

function piAdapterAuthToken(wssUrl: string, piToken: string): string {
  if (piToken) return piToken
  try {
    const url = new URL(wssUrl)
    return url.searchParams.get('access_token') || url.searchParams.get('token') || ''
  } catch {
    return ''
  }
}

function piAdapterHeadersFromConfig(wssUrl: string, piToken: string): Record<string, string> {
  return piAdapterHeaders(piAdapterAuthToken(wssUrl, piToken))
}

async function fetchAdapterInstanceId(wssUrl: string, headers: Record<string, string>): Promise<string | null> {
  const statusUrl = `${piWsToHttpBase(wssUrl)}/adapter-status`
  const attempts = Object.keys(headers).length > 0 ? [{}, headers] : [{}]
  try {
    for (const attemptHeaders of attempts) {
      const res = await fetch(statusUrl, {
        headers: attemptHeaders,
        signal: AbortSignal.timeout(5_000),
      })
      if (!res.ok) continue
      const data = await res.json() as { adapterInstanceId?: unknown; instanceId?: unknown }
      const id = typeof data.adapterInstanceId === 'string'
        ? data.adapterInstanceId
        : typeof data.instanceId === 'string'
          ? data.instanceId
          : null
      if (id) return id
    }
    return null
  } catch {
    return null
  }
}

/**
 * Get Authorization headers for an HTTP proxy call to the adapter.
 * If deviceCredential + adapterInstanceId are provided (paired path), signs a
 * fresh JIT JWT so HTTP calls never use an expired pairing-time JWT.
 * Returns null when the credential is invalid — caller should respond 401.
 * Falls back to the legacy piToken / access_token-in-URL path otherwise.
 */
async function getAdapterHttpHeaders(
  wssUrl: string,
  piToken: string,
  deviceCredential: string,
  adapterInstanceId: string,
  iss: string,
  options?: {
    fetchLiveAdapterInstanceId?: boolean
    allowAdapterRebind?: boolean
    adapterStatusWssUrl?: string
  },
): Promise<Record<string, string> | null> {
  if (deviceCredential && adapterInstanceId) {
    let jwtAudience = adapterInstanceId
    if (options?.fetchLiveAdapterInstanceId !== false && options?.allowAdapterRebind) {
      const fallbackHeaders = piAdapterHeadersFromConfig(wssUrl, piToken)
      const liveAdapterInstanceId = await fetchAdapterInstanceId(options?.adapterStatusWssUrl ?? wssUrl, fallbackHeaders)
      if (liveAdapterInstanceId) jwtAudience = liveAdapterInstanceId
    }
    const jwt = await issueJitJwt(deviceCredential, jwtAudience, iss, {
      allowAdapterRebind: jwtAudience !== adapterInstanceId,
    })
    if (!jwt) return null
    return { Authorization: `Bearer ${jwt}` }
  }
  return piAdapterHeadersFromConfig(wssUrl, piToken)
}

function checkAgentChatToken(authHeader: string | undefined): boolean {
  if (!appConfig?.token) return true
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
  return token === appConfig.token
}

async function adapterResponse(res: Response): Promise<Response> {
  const contentType = res.headers.get('content-type') || 'application/octet-stream'
  const text = await res.text()
  return new Response(text, {
    status: res.status,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    },
  })
}

app.get('/api/agent-chat/v1/providers', async (c) => {
  if (!checkAgentChatToken(c.req.header('Authorization'))) return c.json({ error: 'Unauthorized' }, 401)
  const wssUrl = c.req.query('wssUrl')
  const piToken = c.req.query('piToken') || ''
  const deviceCredential = c.req.query('deviceCredential') || ''
  const adapterInstanceId = c.req.query('adapterInstanceId') || ''
  const pairedAdapterWssUrl = c.req.query('pairedAdapterWssUrl') || ''
  if (!wssUrl) return c.json({ error: 'wssUrl required' }, 400)
  const adapterHeaders = await getAdapterHttpHeaders(wssUrl, piToken, deviceCredential, adapterInstanceId, new URL(c.req.url).origin, {
    allowAdapterRebind: Boolean(pairedAdapterWssUrl),
    adapterStatusWssUrl: pairedAdapterWssUrl || wssUrl,
  })
  if (!adapterHeaders) return c.json({ error: 'Unauthorized' }, 401)
  const qs = new URLSearchParams()
  const group = c.req.query('group')
  if (group) qs.set('group', group)
  const res = await fetch(`${piWsToHttpBase(wssUrl)}/providers?${qs}`, {
    headers: adapterHeaders,
    signal: AbortSignal.timeout(PI_PROXY_TIMEOUT_MS),
  })
  return adapterResponse(res)
})

app.get('/api/agent-chat/v1/workspace', async (c) => {
  if (!checkAgentChatToken(c.req.header('Authorization'))) return c.json({ error: 'Unauthorized' }, 401)
  const wssUrl = c.req.query('wssUrl')
  const piToken = c.req.query('piToken') || ''
  const deviceCredential = c.req.query('deviceCredential') || ''
  const adapterInstanceId = c.req.query('adapterInstanceId') || ''
  const pairedAdapterWssUrl = c.req.query('pairedAdapterWssUrl') || ''
  if (!wssUrl) return c.json({ error: 'wssUrl required' }, 400)
  const adapterHeaders = await getAdapterHttpHeaders(wssUrl, piToken, deviceCredential, adapterInstanceId, new URL(c.req.url).origin, {
    allowAdapterRebind: Boolean(pairedAdapterWssUrl),
    adapterStatusWssUrl: pairedAdapterWssUrl || wssUrl,
  })
  if (!adapterHeaders) return c.json({ error: 'Unauthorized' }, 401)
  const res = await fetch(`${piWsToHttpBase(wssUrl)}/workspace`, {
    headers: adapterHeaders,
    signal: AbortSignal.timeout(PI_PROXY_TIMEOUT_MS),
  })
  return adapterResponse(res)
})

app.post('/api/agent-chat/v1/providers', async (c) => {
  if (!checkAgentChatToken(c.req.header('Authorization'))) return c.json({ error: 'Unauthorized' }, 401)
  const wssUrl = c.req.query('wssUrl')
  const piToken = c.req.query('piToken') || ''
  const deviceCredential = c.req.query('deviceCredential') || ''
  const adapterInstanceId = c.req.query('adapterInstanceId') || ''
  const pairedAdapterWssUrl = c.req.query('pairedAdapterWssUrl') || ''
  if (!wssUrl) return c.json({ error: 'wssUrl required' }, 400)
  const adapterHeaders = await getAdapterHttpHeaders(wssUrl, piToken, deviceCredential, adapterInstanceId, new URL(c.req.url).origin, {
    allowAdapterRebind: Boolean(pairedAdapterWssUrl),
    adapterStatusWssUrl: pairedAdapterWssUrl || wssUrl,
  })
  if (!adapterHeaders) return c.json({ error: 'Unauthorized' }, 401)
  const body = await c.req.json()
  const res = await fetch(`${piWsToHttpBase(wssUrl)}/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...adapterHeaders },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(PI_PROXY_TIMEOUT_MS),
  })
  return adapterResponse(res)
})

app.patch('/api/agent-chat/v1/providers/:id', async (c) => {
  if (!checkAgentChatToken(c.req.header('Authorization'))) return c.json({ error: 'Unauthorized' }, 401)
  const wssUrl = c.req.query('wssUrl')
  const piToken = c.req.query('piToken') || ''
  const deviceCredential = c.req.query('deviceCredential') || ''
  const adapterInstanceId = c.req.query('adapterInstanceId') || ''
  const pairedAdapterWssUrl = c.req.query('pairedAdapterWssUrl') || ''
  if (!wssUrl) return c.json({ error: 'wssUrl required' }, 400)
  const adapterHeaders = await getAdapterHttpHeaders(wssUrl, piToken, deviceCredential, adapterInstanceId, new URL(c.req.url).origin, {
    allowAdapterRebind: Boolean(pairedAdapterWssUrl),
    adapterStatusWssUrl: pairedAdapterWssUrl || wssUrl,
  })
  if (!adapterHeaders) return c.json({ error: 'Unauthorized' }, 401)
  const id = c.req.param('id')
  const body = await c.req.json()
  const res = await fetch(`${piWsToHttpBase(wssUrl)}/providers/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...adapterHeaders },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(PI_PROXY_TIMEOUT_MS),
  })
  return adapterResponse(res)
})

app.delete('/api/agent-chat/v1/providers/:id', async (c) => {
  if (!checkAgentChatToken(c.req.header('Authorization'))) return c.json({ error: 'Unauthorized' }, 401)
  const wssUrl = c.req.query('wssUrl')
  const piToken = c.req.query('piToken') || ''
  const deviceCredential = c.req.query('deviceCredential') || ''
  const adapterInstanceId = c.req.query('adapterInstanceId') || ''
  const pairedAdapterWssUrl = c.req.query('pairedAdapterWssUrl') || ''
  if (!wssUrl) return c.json({ error: 'wssUrl required' }, 400)
  const adapterHeaders = await getAdapterHttpHeaders(wssUrl, piToken, deviceCredential, adapterInstanceId, new URL(c.req.url).origin, {
    allowAdapterRebind: Boolean(pairedAdapterWssUrl),
    adapterStatusWssUrl: pairedAdapterWssUrl || wssUrl,
  })
  if (!adapterHeaders) return c.json({ error: 'Unauthorized' }, 401)
  const id = c.req.param('id')
  const res = await fetch(`${piWsToHttpBase(wssUrl)}/providers/${id}`, {
    method: 'DELETE',
    headers: adapterHeaders,
    signal: AbortSignal.timeout(PI_PROXY_TIMEOUT_MS),
  })
  return adapterResponse(res)
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

        // PI adapter config comes entirely from the frontend; server has no server-side config for it
        const config = { ...appConfig }
        const piWssUrl = url.searchParams.get('piWssUrl')
        const piTokenParam = url.searchParams.get('piToken')
        if (piWssUrl) config.piAdapterUrl = piWssUrl
        if (piTokenParam) config.piAdapterToken = piTokenParam
        const dc = url.searchParams.get('deviceCredential')
        const aid = url.searchParams.get('adapterInstanceId')
        if (dc) config.deviceCredential = dc
        if (aid) config.adapterInstanceId = aid
        config.serverOrigin = url.origin
        await stub.setConfig(config, topicId)
        return stub.fetch(request)
      } catch (e) {
        return new Response(`ws error: ${String(e)}`, { status: 500 })
      }
    }

    return app.fetch(request)
  },
}
