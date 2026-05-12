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

interface PendingRpc {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

class PiSessionConn extends EventEmitter {
  private ws: WebSocket | null = null
  private rpcId = 0
  private pending = new Map<number, PendingRpc>()
  readonly sessionId: string
  private config: AppConfig

  constructor(sessionId: string, config: AppConfig) {
    super()
    this.sessionId = sessionId
    this.config = config
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = buildPiAdapterUrl(this.config.piAdapterUrl, this.config.piAdapterToken)
      const ws = new WebSocket(url)
      ws.addEventListener('open', () => {
        logger.info({ sessionId: this.sessionId }, 'PI session WS connected')
        resolve()
      })

      ws.addEventListener('message', (event) => {
        try {
          const frame = decodeFrame(
            typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data),
          )
          this.handleFrame(frame)
        } catch (err) {
          logger.warn({ err, sessionId: this.sessionId }, 'Failed to parse PI message')
        }
      })

      ws.addEventListener('close', (event) => {
        logger.info({ code: event.code, reason: event.reason, sessionId: this.sessionId }, 'PI session WS closed')
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
      default:
        logger.warn({ type: frame.t, sessionId: this.sessionId }, 'Unknown PI frame type')
    }
  }

  private resolveRpc(id: number, result?: unknown, error?: RpcError): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    clearTimeout(pending.timer)
    if (error) {
      pending.reject(new Error(`RPC error: ${error.code} - ${error.message}`))
    } else {
      pending.resolve(result)
    }
  }

  async rpc<K extends keyof PiRpcMethod>(
    method: K,
    params: PiRpcMethod[K]['params'],
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

      this.ws.send(encoded)
    })
  }

  close(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
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

  get isConnected(): boolean {
    return this.sessions.size > 0
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  async createSession(params: PiRpcMethod['createSession']['params']): Promise<PiRpcMethod['createSession']['result']> {
    const tempId = `pending-${Date.now()}`
    const conn = new PiSessionConn(tempId, this.config)
    await conn.connect()

    const result = await conn.rpc('createSession', params)
    const sessionId = (result as { sessionId: string }).sessionId
    ;(conn as { sessionId: string }).sessionId = sessionId

    await conn.rpc('attachSession', { sessionId })

    conn.on('event', (event: PIEvent) => {
      this.emit('event', event)
    })
    conn.on('close', () => {
      this.sessions.delete(sessionId)
      logger.info({ sessionId }, 'PI session removed from pool')
    })

    this.sessions.set(sessionId, conn)
    logger.info({ sessionId, totalSessions: this.sessions.size }, 'PI session created and connected')

    this.emit('event', {
      seq: 0,
      sessionId,
      ts: Date.now(),
      payload: { kind: 'session.health' as const, state: 'connected' as const, piSessionId: sessionId },
    })

    return result as PiRpcMethod['createSession']['result']
  }

  async reconnectSession(sessionId: string): Promise<void> {
    if (this.sessions.has(sessionId)) return

    const conn = new PiSessionConn(sessionId, this.config)
    await conn.connect()
    await conn.rpc('attachSession', { sessionId })

    conn.on('event', (event: PIEvent) => {
      this.emit('event', event)
    })
    conn.on('close', () => {
      this.sessions.delete(sessionId)
      logger.info({ sessionId }, 'PI session removed from pool')
    })

    this.sessions.set(sessionId, conn)
    logger.info({ sessionId, totalSessions: this.sessions.size }, 'PI session reconnected')

    this.emit('event', {
      seq: 0,
      sessionId,
      ts: Date.now(),
      payload: { kind: 'session.health' as const, state: 'connected' as const, piSessionId: sessionId },
    })
  }

  async rpc<K extends keyof PiRpcMethod>(
    method: K,
    params: PiRpcMethod[K]['params'],
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

    return conn.rpc(method, params)
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
