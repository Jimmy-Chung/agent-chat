import { DurableObject } from 'cloudflare:workers'
import { encodeFrame, decodeFrame, createFrame, type WSFrame } from '@agent-chat/protocol'
import type { AppConfig } from '../config'
import { PiClient } from '../pi/client'
import { logger } from '../logger'

const HEARTBEAT_INTERVAL_MS = 30_000

export class TopicDurableObject extends DurableObject {
  private sessions = new Map<WebSocket, { lastPing: number }>()
  private piClient: PiClient | null = null
  private config: AppConfig | null = null
  private piSessionId: string | null = null
  private topicId: string | null = null

  async setConfig(config: AppConfig, topicId: string) {
    this.config = config
    this.topicId = topicId

    if (!this.piClient) {
      this.piClient = new PiClient(config)
    }

    // Check for stored PI session and reconnect if needed
    const stored = await this.ctx.storage.get<string>('pi_session_id')
    if (stored && !this.piSessionId) {
      this.piSessionId = stored
      try {
        await this.piClient.reconnectSession(stored)
      } catch (err) {
        logger.warn({ err, topicId }, 'Failed to reconnect PI session, clearing')
        this.piSessionId = null
        await this.ctx.storage.delete('pi_session_id')
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)

    if (pathname === '/ws') {
      return this.handleWsUpgrade(request)
    }

    return new Response('Not Found', { status: 404 })
  }

  private handleWsUpgrade(request: Request): Response {
    // Token validation before accepting WebSocket
    const url = new URL(request.url)
    const token =
      url.searchParams.get('token') ||
      request.headers.get('Authorization')?.replace('Bearer ', '')

    if (this.config && token !== this.config.token) {
      return new Response('Unauthorized', { status: 401 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    this.ctx.acceptWebSocket(server)
    this.sessions.set(server, { lastPing: Date.now() })

    // Send initial topics list
    this.sendToClient(server, 'topics.list', { topics: [] })

    // Set initial alarm
    this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS)

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
    try {
      const frame = decodeFrame(message)
      logger.info({ type: frame.t, topicId: this.topicId }, 'Client frame received')
      await this.handleClientFrame(ws, frame)
    } catch (err) {
      logger.warn({ err, topicId: this.topicId }, 'Invalid WS frame from client')
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    this.sessions.delete(ws)
    logger.info({ clients: this.sessions.size, code, reason, wasClean, topicId: this.topicId }, 'WS client disconnected')
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    logger.error({ error, topicId: this.topicId }, 'WS client error')
    this.sessions.delete(ws)
  }

  async alarm(): Promise<void> {
    const now = Date.now()
    for (const [ws, session] of this.sessions) {
      if (now - session.lastPing > HEARTBEAT_INTERVAL_MS + 5000) {
        logger.info({ topicId: this.topicId }, 'WS client heartbeat timeout, closing')
        ws.close(4001, 'Heartbeat timeout')
        this.sessions.delete(ws)
      }
    }

    // Re-schedule alarm
    if (this.sessions.size > 0) {
      await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS)
    }
  }

  private sendToClient(ws: WebSocket, type: string, data: unknown): void {
    if (ws.readyState === WebSocket.READY_STATE_OPEN) {
      const frame = createFrame(type as never, data)
      ws.send(encodeFrame(frame))
    }
  }

  broadcast(type: string, data: Record<string, unknown>): void {
    const frame = createFrame(type as never, data)
    const raw = encodeFrame(frame)
    for (const [ws] of this.sessions) {
      if (ws.readyState === WebSocket.READY_STATE_OPEN) {
        ws.send(raw)
      }
    }
  }

  private async handleClientFrame(ws: WebSocket, frame: WSFrame): Promise<void> {
    // Delegate to global handler pattern — emit events
    // The worker.ts will register handlers that bridge between DO and global operations
    switch (frame.t) {
      case 'topic.select': {
        this.sendToClient(ws, 'topic.selected', frame.d)
        break
      }
      case 'user.message': {
        // Forward to PI client
        if (this.piClient && this.piSessionId) {
          const d = frame.d as { content: string; topicId: string; mentions?: Array<{ id: string; name: string; downloadUrl: string }> }
          try {
            await this.piClient.rpc('sendUserMessage', {
              sessionId: this.piSessionId,
              content: d.content,
              mentionedArtifacts: d.mentions?.map((m) => ({ id: m.id, name: m.name, downloadUrl: m.downloadUrl })),
            })
          } catch (err) {
            logger.error({ err, topicId: this.topicId }, 'Failed to send user message to PI')
          }
        }
        break
      }
      case 'user.action': {
        const d = frame.d as { action: string; topicId: string; interactionId?: string }
        if (d.action === 'abort' && this.piClient && this.piSessionId) {
          try {
            await this.piClient.rpc('abortSession', { sessionId: this.piSessionId })
          } catch (err) {
            logger.warn({ err }, 'Failed to abort session on PI')
          }
        }
        break
      }
      case 'messages.load': {
        // Messages are loaded via the global handler since repo access is needed
        break
      }
      case 'ping': {
        const session = this.sessions.get(ws)
        if (session) session.lastPing = Date.now()
        this.sendToClient(ws, 'pong', {})
        break
      }
    }
  }
}
