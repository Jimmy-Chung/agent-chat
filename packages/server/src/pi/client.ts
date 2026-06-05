import { EventEmitter } from 'node:events'
import type { AppConfig } from '../config'
import { errorDetail } from '../error-detail'
import { logger } from '../logger'
import { logPiEvent } from '../server-logs'
import { issueJitJwt } from '../pairing/routes'
import { buildPiWsUrl } from '@agent-chat/protocol'
import {
  encodeFrame,
  decodeFrame,
  createFrame,
  piEventSchema,
  type PIEvent,
  type WSFrame,
  type PiRpcMethod,
  type RpcError,
} from '@agent-chat/protocol'

export class PiRpcError extends Error {
  readonly code: string
  readonly detail: unknown
  constructor(code: string, message: string, detail?: unknown) {
    super(`RPC error: ${code} - ${message}`)
    this.name = 'PiRpcError'
    this.code = code
    this.detail = detail
  }
}

interface PendingRpc {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

export interface AdapterRpcRequest {
  sessionId: string
  id: string
  method: string
  params: unknown
  reply: (error: RpcError | null, result?: unknown) => void
}

const ADAPTER_READY_TIMEOUT_MS = 3_000

/**
 * Replace (or append) the `access_token` query param in an adapter WS URL with a
 * freshly-minted JWT. Preserves any other params and avoids leaving a dangling
 * separator. Exported for unit testing.
 */
export function setAccessTokenParam(rawUrl: string, jwt: string): string {
  const base = rawUrl.replace(/[?&]access_token=[^&]*/, '').replace(/[?&]$/, '')
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}access_token=${encodeURIComponent(jwt)}`
}

class PiSessionConn extends EventEmitter {
  private ws: WebSocket | null = null
  private rpcId = 0
  private pending = new Map<number, PendingRpc>()
  readonly sessionId: string
  private config: AppConfig
  private ready = false
  public lastSeq = 0
  private readyResolve: (() => void) | null = null

  constructor(sessionId: string, config: AppConfig) {
    super()
    this.sessionId = sessionId
    this.config = config
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  private waitForReady(): Promise<void> {
    if (this.ready) return Promise.resolve()
    return new Promise<void>((resolve) => {
      this.readyResolve = resolve
      setTimeout(() => {
        if (!this.ready) {
          logger.warn({ sessionId: this.sessionId }, 'adapter.ready timeout, proceeding anyway')
          this.ready = true
          resolve()
        }
      }, ADAPTER_READY_TIMEOUT_MS)
    })
  }

  private attemptConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = buildPiWsUrl(this.config.piAdapterUrl, this.config.piAdapterToken)
      const maskedUrl = url.replace(/(access_token|token)=[^&]+/g, '$1=***')
      logger.info({ url: maskedUrl, sessionId: this.sessionId }, 'PI session WS connecting')
      const ws = new WebSocket(url)
      let settled = false
      ws.addEventListener('open', async () => {
        logger.info({ sessionId: this.sessionId }, 'PI session WS connected')
        await this.waitForReady()
        settled = true
        resolve()
      })

      ws.addEventListener('message', (event) => {
        let frame: WSFrame | null = null
        try {
          frame = decodeFrame(
            typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data),
          )
          this.handleFrame(frame)
        } catch (err) {
          const d = frame?.d as { payload?: { kind?: unknown } } | undefined
          logger.warn({
            err,
            frameType: frame?.t,
            payloadKind: typeof d?.payload?.kind === 'string' ? d.payload.kind : undefined,
            sessionId: this.sessionId,
          }, 'Failed to parse PI message')
          // AIT-150 ③ — protocol errors indicate a broken connection; close and signal
          this.emit('event', {
            seq: 0,
            sessionId: this.sessionId,
            ts: Date.now(),
            payload: { kind: 'session.health' as const, state: 'reconnecting' as const, piSessionId: this.sessionId },
          })
          this.emit('event', {
            seq: 0,
            sessionId: this.sessionId,
            ts: Date.now(),
            payload: { kind: 'session.health' as const, state: 'disconnected' as const, piSessionId: this.sessionId },
          })
          this.emit('close')
          if (ws.readyState === WebSocket.OPEN) {
            ws.close()
          }
        }
      })

      ws.addEventListener('close', (event) => {
        logger.info({ code: event.code, reason: event.reason, sessionId: this.sessionId }, 'PI session WS closed')
        if (!settled) {
          settled = true
          reject(new PiRpcError(
            `ws_close_${event.code}`,
            event.reason || `PI adapter WebSocket closed before ready (code ${event.code})`,
            { code: event.code, reason: event.reason },
          ))
        }
        // AIT-150 ④ — emit reconnecting first so UI shows transient state,
        // then disconnected. Full reconnect loop deferred to future version.
        this.emit('event', {
          seq: 0,
          sessionId: this.sessionId,
          ts: Date.now(),
          payload: { kind: 'session.health' as const, state: 'reconnecting' as const, piSessionId: this.sessionId },
        })
        this.emit('event', {
          seq: 0,
          sessionId: this.sessionId,
          ts: Date.now(),
          payload: { kind: 'session.health' as const, state: 'disconnected' as const, piSessionId: this.sessionId },
        })
        this.emit('close')
      })

      ws.addEventListener('error', (err) => {
        logger.error({ err, sessionId: this.sessionId }, 'PI session WS error')
        if (ws.readyState !== WebSocket.OPEN && !settled) {
          settled = true
          // Wrap the raw error Event in a PiRpcError so callers/logs get a real
          // message instead of "[object Object]" (which hid a jwt_expired reject).
          const msg = (err as { message?: string })?.message || 'PI adapter WS error before open'
          reject(new PiRpcError('ws_error', msg, { type: (err as { type?: string })?.type }))
        }
      })

      this.ws = ws
    })
  }

  async connect(maxRetries = 3): Promise<void> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.attemptConnect()
        return
      } catch (err) {
        if (attempt < maxRetries - 1) {
          const delay = 500 * (attempt + 1)
          logger.warn({ err, sessionId: this.sessionId, attempt, delay }, 'PI session WS connect failed, retrying')
          await new Promise(r => setTimeout(r, delay))
        } else {
          throw err
        }
      }
    }
  }

  private handleFrame(frame: WSFrame): void {
    switch (frame.t) {
      case 'pi.event':
      case 'event': {
        const raw = frame.d as Record<string, unknown>
        // keepalive events may omit sessionId/seq/ts — skip full PIEvent parsing
        if (raw?.payload && typeof raw.payload === 'object' && (raw.payload as Record<string, unknown>).kind === 'keepalive') {
          return
        }
        const event = piEventSchema.parse(frame.d)
        // Log PI event for debugging (BUG-044) with cross-hop correlation (BUG-046).
        void logPiEvent(this.sessionId, event)
        if (event.payload?.kind === 'adapter.ready') {
          logger.info({ sessionId: this.sessionId, adapterInstanceId: (event.payload as { adapterInstanceId?: string }).adapterInstanceId }, 'adapter.ready received')
          this.ready = true
          this.readyResolve?.()
          this.readyResolve = null
          return
        }
        if (event.seq > this.lastSeq) this.lastSeq = event.seq
        this.emit('event', event)
        break
      }
      case 'rpc.result': {
        const id = frame.id ? Number(frame.id) : 0
        const d = frame.d as Record<string, unknown>
        const result = d.result !== undefined ? d.result : d
        this.resolveRpc(id, result, undefined)
        break
      }
      case 'rpc.error': {
        const id = frame.id ? Number(frame.id) : 0
        this.resolveRpc(id, undefined, frame.d as RpcError)
        break
      }
      case 'rpc': {
        const d = frame.d as { method?: unknown; params?: unknown }
        const method = typeof d.method === 'string' ? d.method : ''
        const id = frame.id ?? ''
        if (!method || !id) {
          this.sendRpcError(id, { code: 'invalid_rpc', message: 'Invalid RPC frame' })
          break
        }
        this.emit('rpc', {
          sessionId: this.sessionId,
          id,
          method,
          params: d.params,
          reply: (error: RpcError | null, result?: unknown) => {
            if (error) this.sendRpcError(id, error)
            else this.sendRpcResult(id, result ?? {})
          },
        } satisfies AdapterRpcRequest)
        break
      }
      case 'keepalive': {
        // Adapter heartbeat — send ack back so adapter knows we're alive
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(encodeFrame(createFrame('keepalive_ack', { kind: 'keepalive_ack' })))
        }
        break
      }
      default:
        logger.warn({ type: frame.t, sessionId: this.sessionId }, 'Unknown PI frame type')
    }
  }

  private sendRpcResult(id: string, result: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(encodeFrame(createFrame('rpc.result', result, id)))
  }

  private sendRpcError(id: string, error: RpcError): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(encodeFrame(createFrame('rpc.error', error, id)))
  }

  private resolveRpc(id: number, result?: unknown, error?: RpcError): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    clearTimeout(pending.timer)
    if (error) {
      const detail = errorDetail(error)
      pending.reject(new PiRpcError(String(detail.code ?? 'rpc_error'), detail.message, error))
    } else {
      pending.resolve(result)
    }
  }

  async rpc<K extends keyof PiRpcMethod>(
    method: K,
    params: PiRpcMethod[K]['params'],
    options?: { signal?: AbortSignal },
  ): Promise<PiRpcMethod[K]['result']> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error(`PI session ${this.sessionId} not connected`))
        return
      }

      const id = ++this.rpcId
      const frame = createFrame('rpc', { method, params }, String(id))
      const encoded = encodeFrame(frame)
      logger.info({ id, method, sessionId: this.sessionId }, 'PI RPC sending')

      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`RPC timeout: ${method} (session ${this.sessionId})`))
      }, 30000)

      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      })

      if (options?.signal) {
        const onAbort = () => {
          const entry = this.pending.get(id)
          if (entry) {
            clearTimeout(entry.timer)
            this.pending.delete(id)
            reject(new Error(`RPC aborted: ${method} (session ${this.sessionId})`))
          }
        }
        options.signal.addEventListener('abort', onAbort, { once: true })
      }

      try {
        this.ws.send(encoded)
      } catch (err) {
        // ws.send threw — connection is dead. Clean up pending entry and close.
        const entry = this.pending.get(id)
        if (entry) {
          clearTimeout(entry.timer)
          this.pending.delete(id)
        }
        reject(new Error(`RPC send failed: ${method} (session ${this.sessionId})`))
      }
    })
  }

  close(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.ready = false
    this.readyResolve = null
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('PI session disconnected'))
    }
    this.pending.clear()
    this.removeAllListeners()
  }
}

export function buildPiAdapterUrl(rawUrl: string, token: string): string {
  return buildPiWsUrl(rawUrl, token)
}

export class PiClient extends EventEmitter {
  private sessions = new Map<string, PiSessionConn>()
  private lastSeqBySession = new Map<string, number>()
  private config: AppConfig
  /** Optional hook: called whenever a session's lastSeq advances. Used by the
   *  Durable Object to persist the value across hibernation so reconnects after
   *  wake-up use the correct seq instead of 0. */
  onLastSeqUpdate?: (sessionId: string, seq: number) => void

  constructor(config: AppConfig) {
    super()
    this.config = config
  }

  /** Restore a persisted lastSeq (e.g. from DO storage after hibernation). */
  restoreLastSeq(sessionId: string, seq: number): void {
    const current = this.lastSeqBySession.get(sessionId) ?? 0
    if (seq > current) this.lastSeqBySession.set(sessionId, seq)
  }

  private adoptSessionConn(conn: PiSessionConn, sessionId: string, action: 'created' | 'recreated' | 'reconnected'): void {
    conn.on('event', (event: PIEvent) => {
      if (event.seq > 0) {
        const lastSeq = this.lastSeqBySession.get(event.sessionId) ?? 0
        if (event.seq > lastSeq) {
          this.lastSeqBySession.set(event.sessionId, event.seq)
          this.onLastSeqUpdate?.(event.sessionId, event.seq)
        }
      }
      this.emit('event', event)
    })
    conn.on('rpc', (request: AdapterRpcRequest) => {
      this.emit('rpc', request)
    })
    conn.on('close', () => {
      this.sessions.delete(sessionId)
      logger.info({ sessionId }, 'PI session removed from pool')
    })

    this.sessions.set(sessionId, conn)
    logger.info({ sessionId, totalSessions: this.sessions.size }, `PI session ${action} and connected`)

    this.emit('event', {
      seq: 0,
      sessionId,
      ts: Date.now(),
      payload: { kind: 'session.health' as const, state: 'connected' as const, piSessionId: sessionId },
    })
  }

  private cleanupTransientConn(conn: PiSessionConn): void {
    conn.close()
  }

  protected createSessionConn(sessionId: string): PiSessionConn {
    return new PiSessionConn(sessionId, this.config)
  }

  // Mint a fresh adapter access_token before opening a NEW WS connection.
  // The pairing JWT embedded in piAdapterUrl has TTL≈300s; the WS handshake only
  // checks it at connect time, so a live connection survives expiry but any
  // reconnect/recreate after an idle window reuses the now-expired token and the
  // adapter rejects it with `jwt_expired` → persistent red dots that a retry
  // can't clear. The session gateway already refreshes before createSession, but
  // the delivery reconnect/recreate paths did not — this closes that gap by
  // re-signing from the long-lived deviceCredential. No-op on the unpaired/debug
  // path (no deviceCredential), where the URL token is used as-is.
  private async refreshAccessToken(): Promise<void> {
    const cfg = this.config
    if (!cfg.deviceCredential || !cfg.adapterInstanceId || !cfg.serverOrigin) return
    const jwt = await issueJitJwt(cfg.deviceCredential, cfg.adapterInstanceId, cfg.serverOrigin)
    if (!jwt) return
    cfg.piAdapterUrl = setAccessTokenParam(cfg.piAdapterUrl, jwt)
  }

  get isConnected(): boolean {
    return this.sessions.size > 0
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  getLastSeq(sessionId: string): number {
    return Math.max(
      this.sessions.get(sessionId)?.lastSeq ?? 0,
      this.lastSeqBySession.get(sessionId) ?? 0,
    )
  }

  async createSession(params: PiRpcMethod['createSession']['params']): Promise<PiRpcMethod['createSession']['result']> {
    const tempId = `pending-${Date.now()}`
    const conn = this.createSessionConn(tempId)

    try {
      await this.refreshAccessToken()
      await conn.connect()
      const result = await conn.rpc('createSession', params)
      const sessionId = (result as { sessionId: string }).sessionId
      ;(conn as { sessionId: string }).sessionId = sessionId

      // Adapter v1.6.0 auto-attaches on createSession — skip explicit attachSession
      // await conn.rpc('attachSession', { sessionId, lastSeq: 0 })
      this.adoptSessionConn(conn, sessionId, 'created')

      return result as PiRpcMethod['createSession']['result']
    } catch (err) {
      this.cleanupTransientConn(conn)
      throw err
    }
  }

  async recreateSession(params: PiRpcMethod['recreateSession']['params']): Promise<PiRpcMethod['recreateSession']['result']> {
    const existing = this.sessions.get(params.sessionId)
    if (existing) {
      existing.close()
      this.sessions.delete(params.sessionId)
    }

    const conn = this.createSessionConn(params.sessionId)

    try {
      await this.refreshAccessToken()
      await conn.connect()
      const result = await conn.rpc('recreateSession', params)
      const sessionId = (result as { sessionId: string }).sessionId

      // Resume from the seq we already persisted instead of replaying from
      // scratch. lastSeq:0 forced the adapter to re-send the entire event
      // stream; combined with session.recreated clearing seq-dedup and the
      // non-idempotent part accumulation, the replayed deltas got appended onto
      // already-finalized messages → duplicated assistant content. Using the
      // tracked lastSeq makes recreate resume like reconnect. (Belt-and-braces:
      // message.repo also drops deltas for messages already marked 'done'.)
      await conn.rpc('attachSession', { sessionId, lastSeq: this.getLastSeq(sessionId) })
      this.adoptSessionConn(conn, sessionId, 'recreated')
      this.emit('session.recreated', { sessionId })

      return result as PiRpcMethod['recreateSession']['result']
    } catch (err) {
      this.cleanupTransientConn(conn)
      throw err
    }
  }

  async reconnectSession(sessionId: string): Promise<void> {
    const existing = this.sessions.get(sessionId)
    const lastSeq = this.getLastSeq(sessionId)
    if (existing?.isConnected) {
      await this.rpc('attachSession', { sessionId, lastSeq })
      return
    }

    // Remove stale session that exists but has a closed WS
    if (existing) {
      existing.close()
      this.sessions.delete(sessionId)
    }

    const conn = this.createSessionConn(sessionId)

    try {
      await this.refreshAccessToken()
      await conn.connect()
      await conn.rpc('attachSession', { sessionId, lastSeq })
      this.adoptSessionConn(conn, sessionId, 'reconnected')
    } catch (err) {
      this.cleanupTransientConn(conn)
      throw err
    }
  }

  async rpc<K extends keyof PiRpcMethod>(
    method: K,
    params: PiRpcMethod[K]['params'],
    options?: { signal?: AbortSignal },
  ): Promise<PiRpcMethod[K]['result']> {
    const p = params as Record<string, unknown>
    const sessionId = p.sessionId as string | undefined
    if (!sessionId) {
      throw new Error(`RPC ${method} requires sessionId`)
    }

    const conn = this.sessions.get(sessionId)
    if (!conn) {
      throw new Error(`PI session ${sessionId} not found`)
    }

    return conn.rpc(method, params, options)
  }

  async rpcWithRetry<K extends keyof PiRpcMethod>(
    method: K,
    params: PiRpcMethod[K]['params'],
    options?: { signal?: AbortSignal },
  ): Promise<PiRpcMethod[K]['result']> {
    try {
      return await this.rpc(method, params, options)
    } catch (err) {
      const p = params as Record<string, unknown>
      const sessionId = p.sessionId as string | undefined
      if (!sessionId) throw err
      logger.warn({ err, method, sessionId }, 'RPC failed, reconnecting and retrying')
      try {
        await this.reconnectSession(sessionId)
      } catch (reconnectErr) {
        logger.error({ err: reconnectErr, sessionId }, 'Reconnect failed after RPC error')
        throw err
      }
      return await this.rpc(method, params, options)
    }
  }

  async rpcGlobal<K extends keyof PiRpcMethod>(
    method: K,
    params: PiRpcMethod[K]['params'],
  ): Promise<PiRpcMethod[K]['result']> {
    // Always use a transient connection for global (session-agnostic) RPCs.
    // Reusing an active session's WS would send the frame on the session channel,
    // where the adapter does not route global methods like updateProviderConfig.
    const transient = this.createSessionConn(`global-${Date.now()}`)
    try {
      await transient.connect()
      return await transient.rpc(method, params)
    } finally {
      transient.close()
    }
  }

  disconnectSession(sessionId: string): void {
    const conn = this.sessions.get(sessionId)
    if (conn) {
      conn.close()
      this.sessions.delete(sessionId)
    }
  }

  disconnect(): void {
    for (const [, conn] of this.sessions) {
      conn.close()
    }
    this.sessions.clear()
  }
}
