import WebSocket from 'ws'
import { EventEmitter } from 'node:events'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { config } from '../config'
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

  constructor(sessionId: string) {
    super()
    this.sessionId = sessionId
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = config.piAdapterUrl
      const headers: Record<string, string> = {
        Authorization: `Bearer ${config.piAdapterToken}`,
      }
      const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy
      const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined

      this.ws = new WebSocket(url, { headers, agent })

      this.ws.on('open', () => {
        logger.info({ sessionId: this.sessionId }, 'PI session WS connected')
        resolve()
      })

      this.ws.on('message', (raw: WebSocket.Data) => {
        try {
          const frame = decodeFrame(raw.toString())
          this.handleFrame(frame)
        } catch (err) {
          logger.warn({ err, sessionId: this.sessionId }, 'Failed to parse PI message')
        }
      })

      this.ws.on('close', (code, reason) => {
        logger.info({ code, reason: reason.toString(), sessionId: this.sessionId }, 'PI session WS closed')
        // Emit synthetic session.health disconnected event before closing
        this.emit('event', {
          seq: 0,
          sessionId: this.sessionId,
          ts: Date.now(),
          payload: { kind: 'session.health' as const, state: 'disconnected' as const, piSessionId: this.sessionId },
        })
        this.emit('close')
      })

      this.ws.on('error', (err) => {
        logger.error({ err, sessionId: this.sessionId }, 'PI session WS error')
        if (this.ws?.readyState !== WebSocket.OPEN) reject(err)
      })
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

export class PiClient extends EventEmitter {
  private sessions = new Map<string, PiSessionConn>()

  get isConnected(): boolean {
    return this.sessions.size > 0
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  setUrl(_url: string): void {
    // Kept for API compatibility; per-session connections use config directly
  }

  async createSession(params: PiRpcMethod['createSession']['params']): Promise<PiRpcMethod['createSession']['result']> {
    // Open a new WS connection
    const tempId = `pending-${Date.now()}`
    const conn = new PiSessionConn(tempId)
    await conn.connect()

    // Send createSession RPC
    const result = await conn.rpc('createSession', params)
    const sessionId = (result as { sessionId: string }).sessionId

    // Update the conn's sessionId
    ;(conn as { sessionId: string }).sessionId = sessionId

    // Attach session to receive events
    await conn.rpc('attachSession', { sessionId })

    // Forward events from this session
    conn.on('event', (event: PIEvent) => {
      this.emit('event', event)
    })
    conn.on('close', () => {
      this.sessions.delete(sessionId)
      logger.info({ sessionId }, 'PI session removed from pool')
    })

    this.sessions.set(sessionId, conn)
    logger.info({ sessionId, totalSessions: this.sessions.size }, 'PI session created and connected')

    // Emit session.health connected
    this.emit('event', {
      seq: 0,
      sessionId,
      ts: Date.now(),
      payload: { kind: 'session.health' as const, state: 'connected' as const, piSessionId: sessionId },
    })

    return result as PiRpcMethod['createSession']['result']
  }

  /** Reconnect to an existing PI session (e.g. after server restart) */
  async reconnectSession(sessionId: string): Promise<void> {
    if (this.sessions.has(sessionId)) return

    const conn = new PiSessionConn(sessionId)
    await conn.connect()

    // Attach to receive events for this existing session
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

    // Emit session.health connected
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
    // Find the session connection from params
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

  /** Send an RPC that doesn't belong to a specific session (e.g. listCrons).
   *  Uses the first available session connection. */
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

export const piClient = new PiClient()
