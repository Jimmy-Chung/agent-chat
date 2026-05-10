import type { WebSocket } from 'ws'
import { EventEmitter } from 'node:events'
import { config } from '../config'
import { logger } from '../logger'
import { decodeFrame, encodeFrame, createFrame } from '@agent-chat/protocol'
import type { WSFrame, ServerEvent } from '@agent-chat/protocol'

interface ClientConn {
  ws: WebSocket
  lastSeq: number
  lastPing: number
}

const HEARTBEAT_INTERVAL_MS = 30_000
const HEARTBEAT_TIMEOUT_MS = 35_000

export class WsHub extends EventEmitter {
  private clients = new Map<WebSocket, ClientConn>()
  private globalSeq = 0
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  get clientCount(): number {
    return this.clients.size
  }

  addClient(ws: WebSocket, token?: string): boolean {
    if (token !== config.token) {
      ws.close(4401, 'Unauthorized')
      logger.warn({ token }, 'WS auth failed')
      return false
    }

    const conn: ClientConn = {
      ws,
      lastSeq: 0,
      lastPing: Date.now(),
    }
    this.clients.set(ws, conn)
    logger.info({ clients: this.clients.size }, 'WS client connected')

    ws.on('message', (raw: WebSocket.Data) => {
      try {
        const frame = decodeFrame(raw.toString())
        logger.info({ type: frame.t }, 'Client frame received')
        this.handleClientFrame(conn, frame)
      } catch (err) {
        logger.warn({ err }, 'Invalid WS frame from client')
      }
    })

    ws.on('close', () => {
      this.clients.delete(ws)
      logger.info({ clients: this.clients.size }, 'WS client disconnected')
    })

    ws.on('pong', () => {
      conn.lastPing = Date.now()
    })

    return true
  }

  private handleClientFrame(conn: ClientConn, frame: WSFrame): void {
    this.emit('client-event', conn, frame)
    this.emit(`client:${frame.t}`, conn, frame)
  }

  broadcast(event: ServerEvent): void {
    this.globalSeq++
    const frame = createFrame(event.type, event.data, undefined, this.globalSeq)
    const raw = encodeFrame(frame)

    for (const [ws, conn] of this.clients) {
      if (ws.readyState === 1) {
        // WebSocket.OPEN
        ws.send(raw)
        conn.lastSeq = this.globalSeq
      }
    }
  }

  sendToClient(ws: WebSocket, event: ServerEvent): void {
    this.globalSeq++
    const frame = createFrame(event.type, event.data, undefined, this.globalSeq)
    const raw = encodeFrame(frame)
    if (ws.readyState === 1) {
      ws.send(raw)
      const conn = this.clients.get(ws)
      if (conn) conn.lastSeq = this.globalSeq
    }
  }

  startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now()
      for (const [ws, conn] of this.clients) {
        if (now - conn.lastPing > HEARTBEAT_TIMEOUT_MS) {
          logger.info('WS client heartbeat timeout, closing')
          ws.close(4001, 'Heartbeat timeout')
          this.clients.delete(ws)
        } else if (ws.readyState === 1) {
          ws.ping()
        }
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  closeAll(): void {
    for (const [ws] of this.clients) {
      ws.close(1001, 'Server shutting down')
    }
    this.clients.clear()
    this.stopHeartbeat()
  }
}

export const wsHub = new WsHub()
