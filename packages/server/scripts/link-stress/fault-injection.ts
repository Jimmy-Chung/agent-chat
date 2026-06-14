#!/usr/bin/env -S npx tsx
/**
 * AIT-258 real adapter fault-injection smoke.
 *
 * Requires adapter test-mode:
 *   AGENT_CHAT_TEST_HOOKS=1
 *   AGENT_CHAT_TEST_TOKEN=<independent test token>
 */

import WebSocket from 'ws'
import { decodeFrame, encodeFrame, createFrame, type WSFrame } from '@agent-chat/protocol'

const ADAPTER_HTTP_URL = (process.env.ADAPTER_HTTP_URL || 'https://workspace-pi-adapter.jimmy-jam.com').replace(/\/+$/, '')
const ADAPTER_WS_URL = process.env.ADAPTER_WS_URL || `${ADAPTER_HTTP_URL.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')}/api/agent-chat/v1/socket`
const SERVER_HTTP_URL = (process.env.SERVER_HTTP_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '')
const SERVER_TOKEN = process.env.AGENT_CHAT_TOKEN || 'test-token'
const TEST_TOKEN = process.env.AGENT_CHAT_TEST_TOKEN || process.env.TEST_HOOK_TOKEN || ''
const TURN_TIMEOUT_MS = Number(process.env.TURN_TIMEOUT_MS || 120_000)
const RECONNECT_TIMEOUT_MS = Number(process.env.RECONNECT_TIMEOUT_MS || 90_000)

type JsonRecord = Record<string, unknown>

interface AdapterStatus {
  version: string
  adapterInstanceId: string
  startupTime: number
}

interface PairingMaterial {
  deviceCredential: string
  accessToken: string
}

interface TestCounters {
  testRunId: string
  sessionId?: string
  authRejected: number
  jwt_expired: number
  jwt_invalid_audience: number
  reconnect: number
  pendingEventsDrained: number
  drainAttempt: number
  messageEnd: number
  wsClose: number
  keepaliveSent: number
  keepaliveAckIgnored: number
  keepaliveDropped: number
  keepaliveDelayed: number
  instanceIdDrift: number
  lastCloseCode?: number
  lastCloseReason?: string
}

interface TestResult {
  testRunId: string
  status: AdapterStatus
  jwt: { aud?: string; ttlSeconds?: number }
  sessionId?: string
  preflightCounters: TestCounters
  sessionCounters?: TestCounters
  globalCounters?: TestCounters
  logSummary?: Record<string, number>
}

function assertEnv(): void {
  if (!TEST_TOKEN) {
    throw new Error('missing AGENT_CHAT_TEST_TOKEN or TEST_HOOK_TOKEN')
  }
}

function parseMsg(raw: WebSocket.Data): string {
  return typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString() : new TextDecoder().decode(raw as ArrayBuffer)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function jwtSummary(token: string): { aud?: string; ttlSeconds?: number } {
  const [, payload] = token.split('.')
  if (!payload) return {}
  try {
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { aud?: string; exp?: number }
    return {
      aud: typeof json.aud === 'string' ? json.aud : undefined,
      ttlSeconds: typeof json.exp === 'number' ? json.exp - Math.floor(Date.now() / 1000) : undefined,
    }
  } catch {
    return {}
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (err) {
    const cause = err instanceof Error && 'cause' in err ? (err as Error & { cause?: unknown }).cause : undefined
    throw new Error(`${init?.method || 'GET'} ${url} fetch failed: ${err instanceof Error ? err.message : String(err)}${cause ? `; cause=${String(cause)}` : ''}`)
  }
  const text = await res.text()
  let body: unknown = undefined
  if (text) {
    try { body = JSON.parse(text) } catch { body = text }
  }
  if (!res.ok) {
    throw new Error(`${init?.method || 'GET'} ${url} -> ${res.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`)
  }
  return body as T
}

async function testGet<T>(path: string): Promise<T> {
  return fetchJson<T>(`${ADAPTER_HTTP_URL}${path}`, {
    headers: { authorization: `Bearer ${TEST_TOKEN}` },
  })
}

async function testPost<T>(path: string, body: unknown): Promise<T> {
  return fetchJson<T>(`${ADAPTER_HTTP_URL}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TEST_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

async function readStatus(): Promise<AdapterStatus> {
  const status = await fetchJson<AdapterStatus>(`${ADAPTER_HTTP_URL}/api/agent-chat/v1/adapter-status`)
  if (!status.adapterInstanceId || !status.startupTime) throw new Error(`invalid adapter status: ${JSON.stringify(status)}`)
  return status
}

async function createPairingMaterial(status: AdapterStatus): Promise<PairingMaterial> {
  const adapterWssUrl = ADAPTER_WS_URL
  const create = await fetchJson<{ pairingSessionId: string; pairingUrl: string; desktopPollToken: string }>(`${SERVER_HTTP_URL}/api/agent-chat/v1/pairing/sessions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${SERVER_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      adapterWssUrl,
      adapterInstanceId: status.adapterInstanceId,
      displayName: `AIT-258 fault ${Date.now()}`,
    }),
  })
  const nonce = new URL(create.pairingUrl).searchParams.get('nonce')
  if (!nonce) throw new Error('pairingUrl did not include nonce')

  await fetchJson(`${SERVER_HTTP_URL}/api/agent-chat/v1/pairing/sessions/${create.pairingSessionId}/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nonce, deviceHint: { name: 'AIT-258 e2e', platform: 'codex' } }),
  })

  const desktop = await fetchJson<{ verificationCode: string }>(`${SERVER_HTTP_URL}/api/agent-chat/v1/pairing/sessions/${create.pairingSessionId}/desktop-status`, {
    headers: { authorization: `Bearer ${create.desktopPollToken}` },
  })
  if (!desktop.verificationCode) throw new Error('pairing desktop-status did not return verificationCode')

  const verified = await fetchJson<{ deviceCredential: string }>(`${SERVER_HTTP_URL}/api/agent-chat/v1/pairing/sessions/${create.pairingSessionId}/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: desktop.verificationCode }),
  })

  const token = await fetchJson<{ accessToken: string }>(`${SERVER_HTTP_URL}/api/agent-chat/v1/devices/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      deviceCredential: verified.deviceCredential,
      adapterInstanceId: status.adapterInstanceId,
      adapterWssUrl,
      allowAdapterRebind: true,
    }),
  })

  return { deviceCredential: verified.deviceCredential, accessToken: token.accessToken }
}

function buildWsUrl(accessToken: string, testRunId: string): string {
  const url = new URL(ADAPTER_WS_URL)
  url.searchParams.set('access_token', accessToken)
  url.searchParams.set('testRunId', testRunId)
  return url.toString()
}

function sendRpc(ws: WebSocket, method: string, params: unknown, id: string): void {
  ws.send(encodeFrame(createFrame('rpc', { method, params }, id)))
}

async function openWs(accessToken: string, testRunId: string): Promise<WebSocket> {
  const ws = new WebSocket(buildWsUrl(accessToken, testRunId))
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ws open timeout')), 15_000)
    ws.once('open', () => {
      clearTimeout(timer)
      resolve()
    })
    ws.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
  return ws
}

async function waitForRpcResult(ws: WebSocket, id: string, timeoutMs: number): Promise<JsonRecord> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => cleanup(() => reject(new Error(`rpc ${id} timeout`))), timeoutMs)
    const onMessage = (data: WebSocket.Data) => {
      let frame: WSFrame
      try { frame = decodeFrame(parseMsg(data)) } catch { return }
      if (frame.id !== id) return
      if (frame.t === 'rpc.result') {
        cleanup(() => resolve((frame.d ?? {}) as JsonRecord))
      } else if (frame.t === 'rpc.error') {
        cleanup(() => reject(new Error(`rpc ${id} error: ${JSON.stringify(frame.d)}`)))
      }
    }
    const cleanup = (done: () => void) => {
      clearTimeout(timer)
      ws.off('message', onMessage)
      done()
    }
    ws.on('message', onMessage)
  })
}

async function waitForMessageEnd(ws: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => cleanup(() => reject(new Error('message.end timeout'))), timeoutMs)
    const onMessage = (data: WebSocket.Data) => {
      let frame: WSFrame
      try { frame = decodeFrame(parseMsg(data)) } catch { return }
      if (frame.t === 'keepalive') {
        ws.send(encodeFrame(createFrame('keepalive_ack', { kind: 'keepalive_ack' })))
        return
      }
      const event = frame.t === 'event' || frame.t === 'pi.event' ? frame.d as JsonRecord : undefined
      const payload = event?.payload as JsonRecord | undefined
      if (payload?.kind === 'message.end') cleanup(resolve)
      if (payload?.kind === 'error') cleanup(() => reject(new Error(`adapter event error: ${JSON.stringify(payload)}`)))
    }
    const cleanup = (done: () => void) => {
      clearTimeout(timer)
      ws.off('message', onMessage)
      done()
    }
    ws.on('message', onMessage)
  })
}

async function waitForClose(ws: WebSocket, timeoutMs: number): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => cleanup(() => reject(new Error('ws close timeout'))), timeoutMs)
    const onClose = (code: number, reason: Buffer) => cleanup(() => resolve({ code, reason: reason.toString() }))
    const onError = () => {
      // A rejected websocket handshake emits error before close. For negative
      // auth probes the HTTP status is the signal; the close event may not fire.
    }
    const cleanup = (done: () => void) => {
      clearTimeout(timer)
      ws.off('close', onClose)
      ws.off('error', onError)
      done()
    }
    ws.on('close', onClose)
    ws.on('error', onError)
  })
}

async function getCounters(testRunId: string, sessionId?: string): Promise<TestCounters> {
  const query = new URLSearchParams({ testRunId })
  if (sessionId) query.set('sessionId', sessionId)
  const res = await testGet<{ ok: true; counters: TestCounters }>(`/api/agent-chat/v1/test/counters?${query.toString()}`)
  return res.counters
}

async function logSummary(from: number, to: number, testRunId: string, sessionId: string): Promise<Record<string, number>> {
  const authQuery = new URLSearchParams({ from: String(from), to: String(to), limit: '1000', testRunId })
  const sessionQuery = new URLSearchParams({ from: String(from), to: String(to), limit: '1000', sessionId })
  const [authEntries, sessionEntries] = await Promise.all([
    fetchJson<unknown>(`${ADAPTER_HTTP_URL}/logs?${authQuery.toString()}`),
    fetchJson<unknown>(`${ADAPTER_HTTP_URL}/logs?${sessionQuery.toString()}`),
  ])
  const text = `${JSON.stringify(authEntries)}\n${JSON.stringify(sessionEntries)}`
  return {
    jwt_invalid_audience: (text.match(/jwt_invalid_audience/g) ?? []).length,
    jwt_expired: (text.match(/jwt_expired/g) ?? []).length,
    graceDrain: (text.match(/Grace period canceled \(reconnect\), draining pending events/g) ?? []).length,
    needs_retry: (text.match(/needs_retry/g) ?? []).length,
    test_disconnect: (text.match(/test_disconnect/g) ?? []).length,
  }
}

async function run(): Promise<TestResult> {
  assertEnv()
  const testRunId = `ait-258-${Date.now().toString(36)}`
  const startMs = Date.now()
  const status = await readStatus()
  console.log(`Adapter ${status.version}, instance=${status.adapterInstanceId}, startup=${status.startupTime}`)
  console.log(`testRunId=${testRunId}`)

  await testPost('/api/agent-chat/v1/test/auth-fault', { mode: 'jwt_expired', count: 1 })
  const badWs = new WebSocket(`${ADAPTER_WS_URL}?access_token=invalid&testRunId=${encodeURIComponent(testRunId)}`)
  await waitForClose(badWs, 15_000).catch(() => undefined)
  await testPost('/api/agent-chat/v1/test/instance-id-drift', { testRunId, adapterInstanceId: `test-drift-${Date.now()}` })
  await testPost('/api/agent-chat/v1/test/keepalive-fault', { dropOutbound: true, durationMs: 1_000 })
  const preflightCounters = await getCounters(testRunId)
  console.log(`preflight counters=${JSON.stringify(preflightCounters)}`)

  const pairing = await createPairingMaterial(status)
  const jwt = jwtSummary(pairing.accessToken)
  console.log(`JIT JWT aud=${jwt.aud ?? '(missing)'}, ttl=${jwt.ttlSeconds ?? '(missing)'}`)

  const ws1 = await openWs(pairing.accessToken, testRunId)
  sendRpc(ws1, 'createSession', {
    kind: 'programming',
    programming: {
      extension: 'claude-code',
      yolo: true,
      cwd: `/tmp/ait-258-${testRunId}`,
      permissionMode: 'bypassPermissions',
    },
  }, 'create-1')
  const created = await waitForRpcResult(ws1, 'create-1', 60_000)
  const sessionId = String(created.sessionId || '')
  if (!sessionId) throw new Error(`createSession returned no sessionId: ${JSON.stringify(created)}`)
  console.log(`sessionId=${sessionId}`)

  const clientMessageId = `cm-${testRunId}`
  sendRpc(ws1, 'sendUserMessage', {
    sessionId,
    content: 'hi，请用一句话回复，用于 AIT-258 故障注入前置验证。',
    clientMessageId,
  }, 'send-1')
  await waitForRpcResult(ws1, 'send-1', 30_000)
  await waitForMessageEnd(ws1, TURN_TIMEOUT_MS)
  console.log('initial turn message.end received')

  const closePromise = waitForClose(ws1, 15_000)
  await testPost('/api/agent-chat/v1/test/disconnect-session', { sessionId, afterMs: 0, closeCode: 1001 })
  const closed = await closePromise
  console.log(`hook disconnect closeCode=${closed.code}, reason=${closed.reason}`)

  const ws2 = await openWs(pairing.accessToken, testRunId)
  sendRpc(ws2, 'attachSession', { sessionId, lastSeq: 0 }, 'attach-1')
  await waitForRpcResult(ws2, 'attach-1', RECONNECT_TIMEOUT_MS)
  console.log('attachSession after hook disconnect succeeded')

  await delay(1_000)
  const sessionCounters = await getCounters(testRunId, sessionId)
  const globalCounters = await getCounters(testRunId)
  const endMs = Date.now()
  const logs = await logSummary(startMs, endMs, testRunId, sessionId).catch((err) => ({ logs_error: String(err) } as Record<string, number>))
  console.log(`session counters=${JSON.stringify(sessionCounters)}`)
  console.log(`global counters=${JSON.stringify(globalCounters)}`)
  console.log(`log summary=${JSON.stringify(logs)}`)

  ws2.close()

  if (jwt.aud !== status.adapterInstanceId) throw new Error(`JWT aud mismatch: ${jwt.aud} !== ${status.adapterInstanceId}`)
  if (preflightCounters.jwt_expired < 1) throw new Error('auth-fault preflight did not record jwt_expired')
  if (preflightCounters.instanceIdDrift < 1) throw new Error('instance-id-drift preflight did not record counter')
  if (sessionCounters.wsClose < 1) throw new Error('disconnect-session did not record wsClose')
  if ((sessionCounters.reconnect + globalCounters.reconnect) < 1) throw new Error('attachSession did not record reconnect')
  if (sessionCounters.drainAttempt < 1) throw new Error('reconnect did not drain grace entry')
  if (logs.jwt_invalid_audience > 0) throw new Error('unexpected jwt_invalid_audience in test logs')

  return { testRunId, status, jwt, sessionId, preflightCounters, sessionCounters, globalCounters, logSummary: logs }
}

run()
  .then((result) => {
    console.log('\nAIT-258 fault injection passed')
    console.log(JSON.stringify({
      testRunId: result.testRunId,
      version: result.status.version,
      sessionId: result.sessionId,
      jwt: result.jwt,
      preflight: result.preflightCounters,
      session: result.sessionCounters,
      logs: result.logSummary,
    }, null, 2))
  })
  .catch((err) => {
    console.error('\nAIT-258 fault injection failed')
    console.error(err instanceof Error ? err.stack || err.message : String(err))
    process.exit(1)
  })
