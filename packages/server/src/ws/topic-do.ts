import { DurableObject } from 'cloudflare:workers'
import {
  encodeFrame, decodeFrame, createFrame, type WSFrame,
  topicCreateSchema, topicDeleteSchema, topicRenameSchema,
  topicSetModelSchema,
} from '@agent-chat/protocol'
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
  private piClient: PiClient | null = null
  private config: AppConfig | null = null

  // ─── DB init (called on every wake since isolate state resets) ───────────
  private ensureDb(): void {
    if (this.env?.DB) initDb(this.env.DB)
  }

  // ─── Config: persist to storage so it survives hibernation ───────────────
  async setConfig(config: AppConfig, topicId: string) {
    this.config = config
    await this.ctx.storage.put('config_json', JSON.stringify(config))
    await this.ctx.storage.put('topicId', topicId)
    await this.ensurePiClient()
  }

  private async restoreConfig(): Promise<void> {
    if (this.config) return
    const stored = await this.ctx.storage.get<string>('config_json')
    if (stored) this.config = JSON.parse(stored)
  }

  private async ensurePiClient(): Promise<PiClient | null> {
    await this.restoreConfig()
    if (!this.config) return null
    if (this.piClient) return this.piClient

    this.piClient = new PiClient(this.config)
    this.piClient.on('event', (event: Record<string, unknown>) => {
      const payload = event.payload as Record<string, unknown> | undefined
      if (!payload) return
      const kind = payload.kind as string
      if (kind === 'session.health') {
        this.broadcastAll('session.health', {
          topicId: event.sessionId,
          state: payload.state,
          lastError: payload.lastError,
        })
      }
    })
    return this.piClient
  }

  // ─── WebSocket handling ───────────────────────────────────────────────────
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === '/ws') return this.handleWsUpgrade(request)
    return new Response('Not Found', { status: 404 })
  }

  private async handleWsUpgrade(request: Request): Promise<Response> {
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

    // Load topics and SOPs from D1 on connect
    this.ensureDb()
    try {
      const topics = await topicRepo.listTopics()
      this.sendTo(server, 'topics.list', { topics })
    } catch (err) {
      logger.warn({ err }, 'Failed to load topics on connect')
      this.sendTo(server, 'topics.list', { topics: [] })
    }
    try {
      const templates = await sopRepo.listTemplates()
      this.sendTo(server, 'sop_template.list', { templates })
    } catch (err) {
      logger.warn({ err }, 'Failed to load SOP templates on connect')
    }

    this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS)
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
    try {
      const frame = decodeFrame(message)
      logger.info({ type: frame.t }, 'Client frame received')
      await this.handleClientFrame(ws, frame)
    } catch (err) {
      logger.warn({ err }, 'Invalid WS frame from client')
    }
  }

  async webSocketClose(_ws: WebSocket, code: number, reason: string): Promise<void> {
    logger.info({ code, reason }, 'WS client disconnected')
  }

  async webSocketError(_ws: WebSocket, error: unknown): Promise<void> {
    logger.error({ error }, 'WS client error')
  }

  async alarm(): Promise<void> {
    const now = Date.now()
    for (const ws of this.ctx.getWebSockets()) {
      const meta = this.ctx.getTags(ws)
      const lastPing = meta[0] ? Number(meta[0]) : now
      if (now - lastPing > HEARTBEAT_INTERVAL_MS + 5000) {
        ws.close(4001, 'Heartbeat timeout')
      }
    }
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS)
    }
  }

  // ─── Send helpers ─────────────────────────────────────────────────────────
  private sendTo(ws: WebSocket, type: string, data: unknown): void {
    if (ws.readyState === WebSocket.READY_STATE_OPEN) {
      ws.send(encodeFrame(createFrame(type as never, data)))
    }
  }

  broadcastAll(type: string, data: Record<string, unknown>): void {
    const raw = encodeFrame(createFrame(type as never, data))
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState === WebSocket.READY_STATE_OPEN) ws.send(raw)
    }
  }

  // ─── Frame dispatch ───────────────────────────────────────────────────────
  private async handleClientFrame(ws: WebSocket, frame: WSFrame): Promise<void> {
    this.ensureDb()

    switch (frame.t) {
      case 'ping': {
        this.sendTo(ws, 'pong', {})
        break
      }

      case 'topic.select': {
        this.sendTo(ws, 'topic.selected', frame.d)
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
          this.sendTo(ws, 'messages.history', { topicId: d.topicId, messages: msgs, partsByMessage })
        } catch (err) {
          logger.error({ err, topicId: d.topicId }, 'Failed to load messages')
        }
        break
      }

      case 'topic.create': {
        const data = topicCreateSchema.parse(frame.d)
        if (await topicRepo.getTopicByName(data.name)) {
          this.broadcastAll('error', { code: 'DUPLICATE_NAME', message: '同名话题已存在' })
          break
        }
        const topic = await topicRepo.createTopic({
          name: data.name,
          kind: 'normal',
          agentType: data.agentType,
          programmingSpecJson: data.programming ? JSON.stringify(data.programming) : null,
          sopTemplateId: data.sopTemplateId,
        })
        this.broadcastAll('topic.created', topic as unknown as Record<string, unknown>)
        const pi = await this.ensurePiClient()
        if (pi) {
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
            const result = await pi.createSession(sessionParams as Parameters<typeof pi.createSession>[0])
            const updated = await topicRepo.updateTopic(topic.id, { pi_session_id: result.sessionId })
            if (updated) this.broadcastAll('topic.updated', updated as unknown as Record<string, unknown>)
          } catch (err) {
            logger.error({ err, topicId: topic.id }, 'Failed to create PI session')
            this.broadcastAll('error', { code: 'PI_SESSION_FAILED', message: 'Failed to create agent session' })
          }
        }
        break
      }

      case 'topic.delete': {
        const data = topicDeleteSchema.parse(frame.d)
        const topic = await topicRepo.getTopic(data.id)
        if (!topic) break
        if (topic.kind !== 'normal') {
          this.broadcastAll('error', { code: 'LOCKED', message: 'System topics cannot be deleted' })
          break
        }
        await topicRepo.deleteTopic(data.id)
        this.broadcastAll('topic.deleted', { id: data.id })
        if (topic.pi_session_id) {
          const pi = await this.ensurePiClient()
          pi?.disconnectSession(topic.pi_session_id)
        }
        break
      }

      case 'topic.rename': {
        const data = topicRenameSchema.parse(frame.d)
        const updated = await topicRepo.updateTopic(data.id, { name: data.name })
        if (updated) this.broadcastAll('topic.updated', updated as unknown as Record<string, unknown>)
        break
      }

      case 'topic.setModel': {
        const data = topicSetModelSchema.parse(frame.d)
        const topic = await topicRepo.getTopic(data.id)
        if (!topic) break
        if (topic.pi_session_id) {
          const pi = await this.ensurePiClient()
          if (pi) {
            try {
              await pi.rpc('setSessionModel', { sessionId: topic.pi_session_id, model: data.model })
            } catch (err) {
              logger.warn({ err }, 'Failed to set model on PI')
            }
          }
        }
        const updated = await topicRepo.updateTopic(data.id, { current_model: data.model })
        if (updated) this.broadcastAll('topic.updated', updated as unknown as Record<string, unknown>)
        break
      }

      case 'cron.sync': {
        try {
          const jobs = await cronRepo.listCronJobs()
          this.sendTo(ws, 'cron.list', { crons: jobs.map(j => ({
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
        const d = frame.d as { content: string; topicId: string; mentions?: Array<{ id: string; name: string; downloadUrl: string }> }
        // Look up the specific topic's PI session, not the global one
        const topic = await topicRepo.getTopic(d.topicId)
        const sessionId = topic?.pi_session_id
        if (sessionId) {
          const pi = await this.ensurePiClient()
          if (pi) {
            try {
              await pi.rpc('sendUserMessage', {
                sessionId,
                content: d.content,
                mentionedArtifacts: d.mentions?.map(m => ({ id: m.id, name: m.name, downloadUrl: m.downloadUrl })),
              })
            } catch (err) {
              logger.error({ err, topicId: d.topicId }, 'Failed to send user message to PI')
            }
          }
        }
        break
      }

      case 'user.action': {
        const d = frame.d as { action: string; topicId: string }
        if (d.action === 'abort') {
          const topic = await topicRepo.getTopic(d.topicId)
          if (topic?.pi_session_id) {
            const pi = await this.ensurePiClient()
            if (pi) {
              try {
                await pi.rpc('abortSession', { sessionId: topic.pi_session_id })
              } catch (err) {
                logger.warn({ err }, 'Failed to abort session on PI')
              }
            }
          }
        }
        break
      }
    }
  }

  // Keep old broadcast name as alias for external callers (e.g. event-router)
  broadcast(type: string, data: Record<string, unknown>): void {
    this.broadcastAll(type, data)
  }
}
