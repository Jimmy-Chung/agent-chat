import WebSocket from 'ws'
import { EventEmitter } from 'node:events'
import { config } from '../config'
import { logger } from '../logger'
import type { PIEvent } from '@agent-chat/protocol'
import type {
  PiRpcMethod,
  RpcRequest,
  RpcError,
} from '@agent-chat/protocol'

interface PendingRpc {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

export class PiClient extends EventEmitter {
  private ws: WebSocket | null = null
  private rpcId = 0
  private pending = new Map<number, PendingRpc>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1000
  private maxReconnectDelay = 30000
  private lastSeq = 0
  private connected = false
  private intentionalClose = false
  private urlOverride?: string

  get isConnected(): boolean {
    return this.connected
  }

  /** Override the PI Adapter URL (useful for testing) */
  setUrl(url: string): void {
    this.urlOverride = url
  }

  connect(): void {
    this.intentionalClose = false
    this.doConnect()
  }

  private doConnect(): void {
    if (this.intentionalClose) return

    const url = this.urlOverride ?? config.piAdapterUrl
    logger.info({ url }, 'Connecting to PI Adapter...')

    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.piAdapterToken}`,
    }

    this.ws = new WebSocket(url, { headers })

    this.ws.on('open', () => {
      logger.info('PI Adapter connected')
      this.connected = true
      this.reconnectDelay = 1000
      this.emit('connected')
    })

    this.ws.on('message', (raw: WebSocket.Data) => {
      try {
        const msg = JSON.parse(raw.toString()) as
          | { type: 'event'; data: PIEvent }
          | { type: 'rpc_result'; id: number; result?: unknown; error?: RpcError }
        if ('type' in msg && msg.type === 'event') {
          this.handleEvent(msg.data)
        } else if ('type' in msg && msg.type === 'rpc_result') {
          this.handleRpcResult(msg.id, msg.result, msg.error)
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to parse PI message')
      }
    })

    this.ws.on('close', (code, reason) => {
      logger.info({ code, reason: reason.toString() }, 'PI Adapter disconnected')
      this.connected = false
      this.emit('disconnected')
      this.scheduleReconnect()
    })

    this.ws.on('error', (err) => {
      logger.error({ err }, 'PI Adapter error')
    })
  }

  private handleEvent(event: PIEvent): void {
    if (event.seq > this.lastSeq) {
      this.lastSeq = event.seq
    }
    this.emit('event', event)
    this.emit(`event:${event.payload.kind}`, event)
  }

  private handleRpcResult(
    id: number,
    result?: unknown,
    error?: RpcError,
  ): void {
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
        reject(new Error('PI Adapter not connected'))
        return
      }

      const id = ++this.rpcId
      const msg: RpcRequest & { id: number } = { method, params, id }

      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`RPC timeout: ${method}`))
      }, 30000)

      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      })

      this.ws.send(JSON.stringify(msg))
    })
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose) return
    if (this.reconnectTimer) return

    logger.info({ delay: this.reconnectDelay }, 'Scheduling PI reconnect')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.reconnectDelay = Math.min(
        this.reconnectDelay * 2,
        this.maxReconnectDelay,
      )
      this.doConnect()
    }, this.reconnectDelay)
  }

  disconnect(): void {
    this.intentionalClose = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.connected = false
    // Reject all pending RPCs
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error('PI Adapter disconnected'))
      this.pending.delete(id)
    }
  }
}

export const piClient = new PiClient()
