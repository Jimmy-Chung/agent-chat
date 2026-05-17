import { EventEmitter } from 'node:events'
import type { AppConfig } from '../config'
import { logger } from '../logger'
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
  constructor(code: string, message: string) {
    super(`RPC error: ${code} - ${message}`)
    this.name = 'PiRpcError'
    this.code = code
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

class PiSessionConn extends EventEmitter {
  private ws: WebSocket | null = null
  private rpcId = 0
  private pending = new Map<number, PendingRpc>()
  readonly sessionId: string
  private config: AppConfig
  private ready = false
  public lastSeq = 0
  private readyResolve: (() => void) | null = null
  private healthTimer: ReturnType<typeof setInterval> | null = null
  private lastMessageAt = 0

  constructor(sessionId: string, config: AppConfig) {
    super()
    this.sessionId = sessionId
    this.config = config
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

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = buildPiAdapterUrl(this.config.piAdapterUrl, this.config.piAdapterToken)
      const ws = new WebSocket(url)
      ws.addEventListener('open', async () => {
        logger.info({ sessionId: this.sessionId }, 'PI session WS connected')
        await this.waitForReady()
        this.startHealthProbe()
        resolve()
      })

      ws.addEventListener('message', (event) => {
        this.lastMessageAt = Date.now()
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
        }
      })

      ws.addEventListener('close', (event) => {
        logger.info({ code: event.code, reason: event.reason, sessionId: this.sessionId }, 'PI session WS closed')
        this.stopHealthProbe()
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
        if (ws.readyState !== WebSocket.OPEN) reject(err)
      })

      this.ws = ws
    })
  }

  private handleFrame(frame: WSFrame): void {
    switch (frame.t) {
      case 'pi.event':
      case 'event': {
        const event = piEventSchema.parse(frame.d)
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
      pending.reject(new PiRpcError(error.code, error.message))
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
        this.lastMessageAt = Date.now()
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

  private startHealthProbe(): void {
    this.lastMessageAt = Date.now()
    this.healthTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
      if (Date.now() - this.lastMessageAt > 300_000) {
        logger.warn({ sessionId: this.sessionId }, 'PI health probe timeout, closing')
        this.ws.close()
      }
    }, 20_000)
  }

  private stopHealthProbe(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer)
      this.healthTimer = null
    }
  }

  close(): void {
    this.stopHealthProbe()
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
  const url = new URL(rawUrl)
  if (token) url.searchParams.set('token', token)
  return url.toString()
}

export class PiClient extends EventEmitter {
  private sessions = new Map<string, PiSessionConn>()
  private config: AppConfig

  constructor(config: AppConfig) {
    super()
    this.config = config
  }

  private adoptSessionConn(conn: PiSessionConn, sessionId: string, action: 'created' | 'recreated' | 'reconnected'): void {
    conn.on('event', (event: PIEvent) => {
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

  get isConnected(): boolean {
    return this.sessions.size > 0
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  getLastSeq(sessionId: string): number {
    return this.sessions.get(sessionId)?.lastSeq ?? 0
  }

  async createSession(params: PiRpcMethod['createSession']['params']): Promise<PiRpcMethod['createSession']['result']> {
    const tempId = `pending-${Date.now()}`
    const conn = new PiSessionConn(tempId, this.config)

    try {
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

    const conn = new PiSessionConn(params.sessionId, this.config)

    try {
      await conn.connect()
      const result = await conn.rpc('recreateSession', params)
      const sessionId = (result as { sessionId: string }).sessionId

      await conn.rpc('attachSession', { sessionId, lastSeq: 0 })
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
    if (existing) {
      const lastSeq = existing.lastSeq
      await this.rpc('attachSession', { sessionId, lastSeq })
      return
    }

    const conn = new PiSessionConn(sessionId, this.config)

    try {
      await conn.connect()
      await conn.rpc('attachSession', { sessionId, lastSeq: 0 })
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

  async rpcGlobal<K extends keyof PiRpcMethod>(
    method: K,
    params: PiRpcMethod[K]['params'],
  ): Promise<PiRpcMethod[K]['result']> {
    const conn = this.sessions.values().next().value as PiSessionConn | undefined
    if (!conn) {
      throw new Error(`No PI session available for ${method}`)
    }
    return conn.rpc(method, params)
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
