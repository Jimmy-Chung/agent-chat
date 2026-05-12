import { DurableObject } from 'cloudflare:workers'
import { encodeFrame, decodeFrame, createFrame, type WSFrame } from '@agent-chat/protocol'
import type { AppConfig } from '../config'
import { PiClient } from '../pi/client'
import { logger } from '../logger'
import { initDb } from '../db/migrate'
import * as topicRepo from '../db/repos/topic.repo'
import * as messageRepo from '../db/repos/message.repo'
import * as sopRepo from '../db/repos/sop_template.repo'
import * as cronRepo from '../db/repos/cron.repo'

interface DOEnv {
  DB: D1Database
}

const HEARTBEAT_INTERVAL_MS = 30_000

export class TopicDurableObject extends DurableObject<DOEnv> {
  private sessions = new Map<WebSocket, { lastPing: number }>()
  private piClient: PiClient | null = null
  private config: AppConfig | null = null
  private piSessionId: string | null = null
  private topicId: string | null = null

  private ensureDb(): void {
    if (this.env?.DB) {
      initDb(this.env.DB)
    }
  }

  async setConfig(config: AppConfig, topicId: string) {
    this.config = config
    this.topicId = topicId

    if (!this.piClient) {
      this.piClient = new PiClient(config)
      this.piClient.on('event', (event: Record<string, unknown>) => {
        const payload = event.payload as Record<string, unknown> | undefined
        if (!payload) return
        const kind = payload.kind as string
        if (kind === 'session.health') {
          this.broadcast('session.health', {
            topicId: event.sessionId,
            state: payload.state,
            lastError: payload.lastError,
          })
        }
      })
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

  private async handleWsUpgrade(request: Request): Promise<Response> {
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

    // Load real topics from D1
    try {
      this.ensureDb()
      const topics = await topicRepo.listTopics()
      this.sendToClient(server, 'topics.list', { topics })
    } catch (err) {
      logger.warn({ err }, 'Failed to load topics on connect')
      this.sendToClient(server, 'topics.list', { topics: [] })
    }

    // Send SOP templates
    try {
      const templates = await sopRepo.listTemplates()
      this.sendToClient(server, 'sop_template.list', { templates })
    } catch (err) {
      logger.warn({ err }, 'Failed to load SOP templates on connect')
    }

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
    this.ensureDb()

    switch (frame.t) {
      case 'topic.select': {
        this.sendToClient(ws, 'topic.selected', frame.d)
        break
      }

      case 'messages.load': {
        const d = frame.d as { topicId: string }
        try {
          const msgs = await messageRepo.listMessagesByTopic(d.topicId)
          const partsByMessage: Record<string, unknown[]> = {}
          for (const msg of msgs) {
            const parts = await messageRepo.getMessageParts(msg.id)
            if (parts.length > 0) partsByMessage[msg.id] = parts
          }
          this.sendToClient(ws, 'messages.history', {
            topicId: d.topicId,
            messages: msgs,
            partsByMessage,
          })
        } catch (err) {
          logger.error({ err, topicId: d.topicId }, 'Failed to load messages')
        }
        break
      }

      case 'topic.create': {
        const { topicCreateSchema } = await import('@agent-chat/protocol')
        const data = topicCreateSchema.parse(frame.d)
        if (await topicRepo.getTopicByName(data.name)) {
          this.broadcast('error', { code: 'DUPLICATE_NAME', message: '同名话题已存在' })
          return
        }
        const topic = await topicRepo.createTopic({
          name: data.name,
          kind: 'normal',
          agentType: data.agentType,
          programmingSpecJson: data.programming ? JSON.stringify(data.programming) : null,
          sopTemplateId: data.sopTemplateId,
        })
        this.broadcast('topic.created', topic as unknown as Record<string, unknown>)
        if (this.piClient) {
          try {
            const sopTemplate = data.sopTemplateId ? await sopRepo.getTemplate(data.sopTemplateId) : undefined
            const sessionParams: Record<string, unknown> = { kind: data.agentType, topicId: topic.id }
            if (data.agentType === 'programming') sessionParams.programming = data.programming
            if (sopTemplate) {
              sessionParams.general = {
                systemPrompt: sopTemplate.system_prompt_addon ?? undefined,
                initialPlan: sopTemplate.plan_template ?? undefined,
                initialTodos: sopTemplate.todos_template_json ? JSON.parse(sopTemplate.todos_template_json) : undefined,
              }
              sessionParams.workflowMode = sopTemplate.workflow_mode
            }
            const result = await this.piClient.createSession(sessionParams as Parameters<typeof this.piClient.createSession>[0])
            const updated = await topicRepo.updateTopic(topic.id, { pi_session_id: result.sessionId })
            if (updated) this.broadcast('topic.updated', updated as unknown as Record<string, unknown>)
          } catch (err) {
            logger.error({ err, topicId: topic.id }, 'Failed to create PI session')
            this.broadcast('error', { code: 'PI_SESSION_FAILED', message: 'Failed to create agent session' })
          }
        }
        break
      }

      case 'topic.delete': {
        const { topicDeleteSchema } = await import('@agent-chat/protocol')
        const data = topicDeleteSchema.parse(frame.d)
        const topic = await topicRepo.getTopic(data.id)
        if (!topic) break
        if (topic.kind !== 'normal') {
          this.broadcast('error', { code: 'LOCKED', message: 'System topics cannot be deleted' })
          break
        }
        await topicRepo.deleteTopic(data.id)
        this.broadcast('topic.deleted', { id: data.id })
        if (topic.pi_session_id && this.piClient) {
          this.piClient.disconnectSession(topic.pi_session_id)
        }
        break
      }

      case 'topic.rename': {
        const { topicRenameSchema } = await import('@agent-chat/protocol')
        const data = topicRenameSchema.parse(frame.d)
        const updated = await topicRepo.updateTopic(data.id, { name: data.name })
        if (updated) this.broadcast('topic.updated', updated as unknown as Record<string, unknown>)
        break
      }

      case 'topic.setModel': {
        const { topicSetModelSchema } = await import('@agent-chat/protocol')
        const data = topicSetModelSchema.parse(frame.d)
        const topic = await topicRepo.getTopic(data.id)
        if (!topic) break
        if (topic.pi_session_id && this.piClient) {
          try {
            await this.piClient.rpc('setSessionModel', { sessionId: topic.pi_session_id, model: data.model })
          } catch (err) {
            logger.warn({ err }, 'Failed to set model on PI')
          }
        }
        const updated = await topicRepo.updateTopic(data.id, { current_model: data.model })
        if (updated) this.broadcast('topic.updated', updated as unknown as Record<string, unknown>)
        break
      }

      case 'cron.sync': {
        try {
          const jobs = await cronRepo.listCronJobs()
          this.sendToClient(ws, 'cron.list', { crons: jobs.map(j => ({
            cronId: j.id,
            originTopicId: j.origin_topic_id,
            cronExpr: j.cron_expr,
            prompt: j.prompt,
            status: j.status,
            nextRunAt: j.next_run_at,
          })) })
        } catch (err) {
          logger.warn({ err }, 'Failed to load cron jobs')
        }
        break
      }

      case 'user.message': {
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

      case 'ping': {
        const session = this.sessions.get(ws)
        if (session) session.lastPing = Date.now()
        this.sendToClient(ws, 'pong', {})
        break
      }
    }
  }
}
