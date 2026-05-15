import { DurableObject } from 'cloudflare:workers'
import {
  encodeFrame, decodeFrame, createFrame, type WSFrame,
  topicCreateSchema, topicDeleteSchema, topicRenameSchema,
  topicSetModelSchema, topicDetachExtensionSchema, topicSetPlanModeSchema,
  topicResumeSchema, userActionSchema,
  userMessageRetrySchema, userMessageSchema,
  cronPauseSchema, cronDeleteSchema, cronEditSchema,
  searchQuerySchema, artifactUploadInitSchema, artifactUploadCompleteSchema, artifactDownloadInitSchema,
} from '@agent-chat/protocol'
import type { AppConfig } from '../config'
import { PiClient } from '../pi/client'
import { routePiEvents } from '../pi/event-router'
import { logger } from '../logger'
import { initDb } from '../db/migrate'
import * as topicRepo from '../db/repos/topic.repo'
import * as messageRepo from '../db/repos/message.repo'
import * as sopRepo from '../db/repos/sop_template.repo'
import * as cronRepo from '../db/repos/cron.repo'
import * as artifactRepo from '../db/repos/artifact.repo'
import * as interactionRepo from '../db/repos/interaction.repo'
import { createPendingUserMessage, deliverUserMessage, restoreExistingTopicSession, startAutoDelivery } from './message-delivery'
import { ARTIFACT_UPLOAD_MAX_BYTES } from '../r2/artifact-access'
import {
  artifactToPayload,
  completeArtifactUpload,
  errorToRpc,
  failArtifactUpload,
  initArtifactDownload,
  type ArtifactDownloadInitParams,
  type ArtifactUploadCompleteParams,
  type ArtifactUploadFailedParams,
  type ArtifactUploadRequestParams,
  type PendingUpload,
  requestArtifactUpload,
} from './artifact-control'

interface DOEnv {
  DB: D1Database
  R2?: R2Bucket
}

const HEARTBEAT_INTERVAL_MS = 30_000

export class TopicDurableObject extends DurableObject<DOEnv> {
  private piClient: PiClient | null = null
  private config: AppConfig | null = null
  private pendingUploads = new Map<string, PendingUpload>()

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
    // Route ALL PI events through the event-router (handles DB writes + broadcast)
    routePiEvents(this.piClient, this, this.config)
    this.piClient.on('rpc', async ({ sessionId, method, params, reply }) => {
      try {
        const result = await this.handleAdapterRpc(sessionId, method, params)
        reply(null, result)
      } catch (err) {
        reply(errorToRpc(err))
      }
    })
    return this.piClient
  }

  // After DO hibernation the piClient is recreated with no sessions — reconnect on demand
  private async ensureSession(pi: PiClient, sessionId: string): Promise<boolean> {
    if (pi.hasSession(sessionId)) return true
    try {
      await pi.reconnectSession(sessionId)
      return true
    } catch (err) {
      logger.error({ err, sessionId }, 'Failed to reconnect PI session')
      return false
    }
  }

  // ─── WebSocket handling ───────────────────────────────────────────────────
  async fetch(request: Request): Promise<Response> {
    await this.ctx.storage.put('baseUrl', new URL(request.url).origin)
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

  // ─── Alarm: keep alive while clients are connected ────────────────────────
  async alarm(): Promise<void> {
    const sockets = this.ctx.getWebSockets()
    if (sockets.length > 0) {
      // Send a ping to all connected clients to keep the connection alive
      for (const ws of sockets) {
        if (ws.readyState === WebSocket.READY_STATE_OPEN) {
          try {
            ws.send(encodeFrame(createFrame('ping' as never, {})))
          } catch {
            // ignore send errors; the WS error handler will clean up
          }
        }
      }
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

  // EventBroadcaster interface (used by routePiEvents)
  broadcast(type: string, data: unknown): void {
    this.broadcastAll(type, data as Record<string, unknown>)
  }

  private artifactToPayload(artifact: import('@agent-chat/protocol').Artifact): Record<string, unknown> {
    return artifactToPayload(artifact)
  }

  // ─── Cron helpers ─────────────────────────────────────────────────────────
  private cronJobToPayload(job: { id: string; origin_topic_id: string; cron_expr: string; prompt: string; status: string; next_run_at: number | null }) {
    return {
      cronId: job.id,
      originTopicId: job.origin_topic_id,
      cronExpr: job.cron_expr,
      prompt: job.prompt,
      status: job.status,
      lastRunAt: undefined as number | undefined,
      nextRunAt: job.next_run_at ?? undefined,
    }
  }

  private async syncCronsFromPi(pi: PiClient): Promise<void> {
    try {
      const result = await pi.rpcGlobal('listCrons', {}) as Array<{
        cronId: string
        originSessionId: string
        cronExpr: string
        prompt: string
        status: string
        lastRunAt?: number
        nextRunAt?: number
      }>
      for (const c of result) {
        const topics = await topicRepo.listTopics()
        const originTopic = topics.find(t => t.pi_session_id === c.originSessionId)
        const originTopicId = originTopic?.id ?? null
        const existing = await cronRepo.getCronJobByPiCronId(c.cronId)
        if (existing) {
          await cronRepo.updateCronJob(existing.id, {
            status: c.status as 'active' | 'paused' | 'error',
            cron_expr: c.cronExpr,
            prompt: c.prompt,
            next_run_at: c.nextRunAt,
          })
        } else if (originTopicId) {
          await cronRepo.createCronJob({
            originTopicId,
            piCronId: c.cronId,
            cronExpr: c.cronExpr,
            prompt: c.prompt,
            status: c.status as 'active' | 'paused' | 'error',
            nextRunAt: c.nextRunAt,
          })
        } else {
          logger.warn({ cronId: c.cronId, originSessionId: c.originSessionId }, 'Cron missing origin topic during sync')
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to sync crons from PI')
    }
  }

  private async handleAdapterRpc(sessionId: string, method: string, params: unknown): Promise<unknown> {
    this.ensureDb()
    await this.restoreConfig()
    const baseUrl = await this.ctx.storage.get<string>('baseUrl')
    const rpcParams = this.isRecord(params) ? { sessionId, ...params } : { sessionId }

    switch (method) {
      case 'artifact.upload.request':
        return requestArtifactUpload({
          env: this.env,
          config: this.config,
          baseUrl,
          pendingUploads: this.pendingUploads,
        }, rpcParams as ArtifactUploadRequestParams)

      case 'artifact.upload.complete': {
        const { artifact, result } = await completeArtifactUpload({
          env: this.env,
          config: this.config,
          baseUrl,
          pendingUploads: this.pendingUploads,
        }, rpcParams as unknown as ArtifactUploadCompleteParams)
        this.broadcastAll('artifact.added', this.artifactToPayload(artifact))
        return result
      }

      case 'artifact.upload.failed': {
        const { artifact, result } = await failArtifactUpload({
          env: this.env,
          config: this.config,
          baseUrl,
          pendingUploads: this.pendingUploads,
        }, rpcParams as ArtifactUploadFailedParams)
        this.broadcastAll('artifact.added', this.artifactToPayload(artifact))
        return result
      }

      case 'artifact.download.init':
      case 'getArtifactDownloadUrl':
        return initArtifactDownload({
          config: this.config,
          baseUrl,
        }, rpcParams as ArtifactDownloadInitParams)

      default: {
        const error = new Error(`Unknown adapter RPC method: ${method}`) as Error & { code: string }
        error.code = 'method_not_found'
        throw error
      }
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
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
        const d = frame.d as { topicId: string }
        this.sendTo(ws, 'topic.selected', frame.d)

        void this.ensurePiClient()
          .then((pi) => {
            if (!pi) return false
            return restoreExistingTopicSession(d.topicId, pi)
          })
          .catch((err) => {
            logger.warn({ err, topicId: d.topicId }, 'Failed to restore PI session on topic.select')
          })

        // Load artifacts for the selected topic
        try {
          if (d.topicId === 'system_artifact_pool') {
            const artifacts = await artifactRepo.listPoolArtifacts()
            this.sendTo(ws, 'artifact.list', { artifacts: artifacts.map(a => this.artifactToPayload(a)) })
          } else {
            const artifacts = await artifactRepo.listArtifactsByTopic(d.topicId)
            if (artifacts.length > 0) {
              this.sendTo(ws, 'artifact.list', { artifacts: artifacts.map(a => this.artifactToPayload(a)) })
            }
          }
        } catch (err) {
          logger.warn({ err, topicId: d.topicId }, 'Failed to load artifacts on topic.select')
        }

        // If selecting cron admin topic, sync crons from PI
        if (d.topicId === 'system_cron_admin') {
          const pi = await this.ensurePiClient()
          if (pi) await this.syncCronsFromPi(pi)
          try {
            const jobs = await cronRepo.listCronJobs()
            this.sendTo(ws, 'cron.list', { crons: jobs.map(j => this.cronJobToPayload(j)) })
          } catch (err) {
            logger.warn({ err }, 'Failed to load cron jobs')
          }
        }
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
        // Resolve SOP template params before topic creation so they're baked into
        // general_spec_json. Session creation is deferred to first message delivery
        // to avoid a race where user.message arrives before createSession completes.
        const sopTemplate = data.sopTemplateId ? await sopRepo.getTemplate(data.sopTemplateId) : undefined
        const generalSpecJson = sopTemplate
          ? JSON.stringify({
              systemPrompt: sopTemplate.system_prompt_addon ?? undefined,
              initialPlan: sopTemplate.plan_template ?? undefined,
              initialTodos: sopTemplate.todos_template_json
                ? JSON.parse(sopTemplate.todos_template_json)
                : undefined,
              workflowMode: sopTemplate.workflow_mode ?? undefined,
            })
          : null

        const topic = await topicRepo.createTopic({
          name: data.name,
          kind: 'normal',
          agentType: data.agentType,
          programmingSpecJson: data.programming ? JSON.stringify(data.programming) : null,
          generalSpecJson,
          sopTemplateId: data.sopTemplateId,
        })
        this.broadcastAll('topic.created', topic as unknown as Record<string, unknown>)
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

        // Handle artifacts based on strategy
        const artifacts = await artifactRepo.listArtifactsByTopic(data.id)
        if (artifacts.length > 0) {
          if (data.artifactStrategy === 'pool') {
            for (const a of artifacts) {
              await artifactRepo.updateArtifactTopic(a.id, null)
              this.broadcastAll('artifact.moved', { id: a.id, fromTopicId: data.id, toTopicId: null })
            }
          } else {
            for (const a of artifacts) {
              await artifactRepo.deleteArtifact(a.id)
              this.broadcastAll('artifact.deleted', { id: a.id })
            }
          }
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
          if (pi && await this.ensureSession(pi, topic.pi_session_id)) {
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

      case 'topic.detachExtension': {
        const data = topicDetachExtensionSchema.parse(frame.d)
        const topic = await topicRepo.getTopic(data.id)
        if (!topic || !topic.pi_session_id) break
        const pi = await this.ensurePiClient()
        if (pi && await this.ensureSession(pi, topic.pi_session_id)) {
          try {
            await pi.rpc('detachExtension', { sessionId: topic.pi_session_id })
          } catch (err) {
            logger.warn({ err }, 'Failed to detach extension from PI')
          }
        }
        const updated = await topicRepo.updateTopic(data.id, {
          agent_type: 'general',
          history_frozen_at: Date.now(),
        })
        if (updated) this.broadcastAll('topic.updated', updated as unknown as Record<string, unknown>)
        break
      }

      case 'topic.setPlanMode': {
        const data = topicSetPlanModeSchema.parse(frame.d)
        const topic = await topicRepo.getTopic(data.id)
        if (!topic) break
        if (topic.agent_type !== 'programming') {
          this.broadcastAll('error', { code: 'INVALID_TOPIC', message: 'Plan mode only applies to programming topics' })
          break
        }
        if (topic.pi_session_id) {
          const pi = await this.ensurePiClient()
          if (pi && await this.ensureSession(pi, topic.pi_session_id)) {
            try {
              await pi.rpc('setPlanMode', { sessionId: topic.pi_session_id, planMode: data.planMode })
            } catch (err) {
              logger.error({ err, topicId: data.id }, 'Failed to set plan mode on PI')
              this.broadcastAll('error', { code: 'PI_PLAN_MODE_FAILED', message: 'Failed to set plan mode' })
              break
            }
          }
        }
        const updated = await topicRepo.updateTopic(data.id, { plan_mode: data.planMode })
        if (updated) this.broadcastAll('topic.updated', updated as unknown as Record<string, unknown>)
        break
      }

      case 'topic.resume': {
        const data = topicResumeSchema.parse(frame.d)
        const topic = await topicRepo.getTopic(data.topicId)
        if (!topic || !topic.pi_session_id) break
        const pi = await this.ensurePiClient()
        if (!pi) break
        try {
          await restoreExistingTopicSession(data.topicId, pi)
          logger.info({ topicId: topic.id, sessionId: topic.pi_session_id }, 'PI session resumed')
        } catch (err) {
          logger.error({ err, topicId: topic.id }, 'Failed to resume PI session')
          this.broadcastAll('error', { code: 'PI_RESUME_FAILED', message: 'Failed to resume agent session' })
        }
        break
      }

      case 'cron.sync': {
        const pi = await this.ensurePiClient()
        if (pi) await this.syncCronsFromPi(pi)
        try {
          const jobs = await cronRepo.listCronJobs()
          this.sendTo(ws, 'cron.list', { crons: jobs.map(j => this.cronJobToPayload(j)) })
        } catch (err) {
          logger.warn({ err }, 'Failed to load cron jobs')
        }
        break
      }

      case 'cron.pause': {
        const data = cronPauseSchema.parse(frame.d)
        const job = await cronRepo.getCronJob(data.cronId)
        if (!job) break
        const pi = await this.ensurePiClient()
        if (pi) {
          try {
            await pi.rpc('pauseCron', { cronId: job.pi_cron_id })
          } catch (err) {
            logger.warn({ err }, 'Failed to pause cron on PI')
          }
        }
        const updated = await cronRepo.updateCronJob(data.cronId, { status: 'paused' })
        if (updated) this.broadcastAll('cron.upserted', this.cronJobToPayload(updated))
        break
      }

      case 'cron.resume': {
        // cron.resume re-activates a paused cron — forward to PI
        const d = frame.d as { cronId: string }
        const job = await cronRepo.getCronJob(d.cronId)
        if (!job) break
        const pi = await this.ensurePiClient()
        if (pi) {
          try {
            await pi.rpc('resumeCron' as never, { cronId: job.pi_cron_id } as never)
          } catch (err) {
            logger.warn({ err }, 'Failed to resume cron on PI')
          }
        }
        const updated = await cronRepo.updateCronJob(d.cronId, { status: 'active' })
        if (updated) this.broadcastAll('cron.upserted', this.cronJobToPayload(updated))
        break
      }

      case 'cron.delete': {
        const data = cronDeleteSchema.parse(frame.d)
        const job = await cronRepo.getCronJob(data.cronId)
        if (!job) break
        const pi = await this.ensurePiClient()
        if (pi) {
          try {
            await pi.rpc('deleteCron', { cronId: job.pi_cron_id })
          } catch (err) {
            logger.warn({ err }, 'Failed to delete cron on PI')
          }
        }
        await cronRepo.deleteCronJob(data.cronId)
        const jobs = await cronRepo.listCronJobs()
        this.broadcastAll('cron.list', { crons: jobs.map(j => this.cronJobToPayload(j)) })
        break
      }

      case 'cron.edit': {
        const data = cronEditSchema.parse(frame.d)
        const job = await cronRepo.getCronJob(data.cronId)
        if (!job) break
        const updated = await cronRepo.updateCronJob(data.cronId, {
          ...(data.cronExpr ? { cron_expr: data.cronExpr } : {}),
          ...(data.prompt ? { prompt: data.prompt } : {}),
        })
        if (updated) {
          const pi = await this.ensurePiClient()
          if (pi) {
            try {
              const topic = await topicRepo.getTopic(job.origin_topic_id)
              if (topic?.pi_session_id) {
                await pi.rpc('deleteCron', { cronId: job.pi_cron_id })
                const result = await pi.rpc('createCron', {
                  originSessionId: topic.pi_session_id,
                  cronExpr: updated.cron_expr,
                  prompt: updated.prompt,
                }) as { cronId: string }
                if (result.cronId && result.cronId !== job.pi_cron_id) {
                  await cronRepo.updateCronJob(updated.id, { pi_cron_id: result.cronId })
                }
              }
            } catch (err) {
              logger.warn({ err }, 'Failed to sync cron edit to PI')
            }
          }
          this.broadcastAll('cron.upserted', this.cronJobToPayload(updated))
        }
        break
      }

      case 'user.message': {
        const data = userMessageSchema.parse(frame.d)
        const topic = await topicRepo.getTopic(data.topicId)
        if (!topic) {
          logger.warn({ topicId: data.topicId }, 'Topic not found for user message')
          break
        }

        const msg = await createPendingUserMessage({
          topicId: data.topicId,
          content: data.content,
          mentions: data.mentions,
          clientMessageId: data.clientMessageId,
          broadcaster: this,
        })

        const pi = await this.ensurePiClient()
        if (!pi) break

        void startAutoDelivery({
          topicId: data.topicId,
          messageId: msg.id,
          content: data.content,
          mentions: data.mentions,
          pi,
          broadcaster: this,
          artifactAccess: {
            baseUrl: await this.ctx.storage.get<string>('baseUrl') ?? '',
            tokenSecret: this.config?.artifactTokenSecret ?? '',
          },
          manual: false,
        })
        break
      }

      case 'user.message.retry': {
        const data = userMessageRetrySchema.parse(frame.d)
        const parts = await messageRepo.getMessageParts(data.messageId)
        const textPart = parts.find((part) => part.kind === 'text')
        const content = textPart ? parseTextContent(textPart.content_json) : ''
        const pi = await this.ensurePiClient()
        if (!pi || !content) break

        await deliverUserMessage({
          topicId: data.topicId,
          messageId: data.messageId,
          content,
          pi,
          broadcaster: this,
          artifactAccess: {
            baseUrl: await this.ctx.storage.get<string>('baseUrl') ?? '',
            tokenSecret: this.config?.artifactTokenSecret ?? '',
          },
          manual: true,
        })
        break
      }

      case 'user.action': {
        const data = userActionSchema.parse(frame.d)

        if (data.action === 'abort') {
          const topic = await topicRepo.getTopic(data.topicId)
          if (topic?.pi_session_id) {
            const pi = await this.ensurePiClient()
            if (pi && await this.ensureSession(pi, topic.pi_session_id)) {
              try {
                await pi.rpc('abortSession', { sessionId: topic.pi_session_id })
              } catch (err) {
                logger.warn({ err }, 'Failed to abort session on PI')
              }
            }
          }
          this.broadcastAll('agent.status', { topicId: data.topicId, state: 'idle' })
          break
        }

        // approve / reject interaction
        if (data.interactionId) {
          const interaction = await interactionRepo.getInteraction(data.interactionId)
          if (!interaction || interaction.status !== 'pending') break

          const decision = data.action === 'approve' ? 'approve' : 'reject'
          await interactionRepo.updateInteraction(data.interactionId, {
            status: 'resolved',
            response_json: JSON.stringify({ decision }),
            resolved_at: Date.now(),
          })

          const topic = await topicRepo.getTopic(data.topicId)
          if (topic?.pi_session_id) {
            const pi = await this.ensurePiClient()
            if (pi && await this.ensureSession(pi, topic.pi_session_id)) {
              try {
                await pi.rpc('resolveInteraction', {
                  sessionId: topic.pi_session_id,
                  interactionId: data.interactionId,
                  decision,
                })
              } catch (err) {
                logger.warn({ err }, 'Failed to resolve interaction on PI')
              }
            }
          }
        }
        break
      }

      case 'artifact.upload.init': {
        const data = artifactUploadInitSchema.parse(frame.d)
        await this.restoreConfig()
        const baseUrl = await this.ctx.storage.get<string>('baseUrl')
        if (!this.env.R2 || !this.config || !baseUrl) {
          this.sendTo(ws, 'error', {
            code: 'ARTIFACT_UPLOAD_UNAVAILABLE',
            message: 'File upload is not available in this version',
          })
          break
        }
        if (data.sizeBytes > ARTIFACT_UPLOAD_MAX_BYTES) {
          this.sendTo(ws, 'error', {
            code: 'ARTIFACT_UPLOAD_TOO_LARGE',
            message: `File upload limit is ${Math.floor(ARTIFACT_UPLOAD_MAX_BYTES / 1024 / 1024)} MB`,
          })
          break
        }

        const result = await requestArtifactUpload({
          env: this.env,
          config: this.config,
          baseUrl,
          pendingUploads: this.pendingUploads,
        }, {
          name: data.name,
          mime: data.mime,
          sizeBytes: data.sizeBytes,
          topicId: data.topicId,
          source: 'uploaded',
          metadata: { uploadedVia: 'agent-chat' },
        })
        this.sendTo(ws, 'artifact.upload.ready', {
          uploadId: result.uploadId,
          uploadUrl: result.uploadUrl,
          method: result.method,
          expiresAt: result.expiresAt,
          maxBytes: result.maxBytes,
        })
        break
      }

      case 'artifact.upload.complete': {
        const data = artifactUploadCompleteSchema.parse(frame.d)
        const { artifact } = await completeArtifactUpload({
          env: this.env,
          config: this.config,
          baseUrl: await this.ctx.storage.get<string>('baseUrl'),
          pendingUploads: this.pendingUploads,
        }, {
          uploadId: data.uploadId,
          topicId: data.topicId,
          metadata: { uploadedVia: 'agent-chat' },
        })
        this.broadcastAll('artifact.added', this.artifactToPayload(artifact))
        break
      }

      case 'artifact.download.init': {
        const data = artifactDownloadInitSchema.parse(frame.d)
        await this.restoreConfig()
        const baseUrl = await this.ctx.storage.get<string>('baseUrl')
        try {
          const result = await initArtifactDownload({
            config: this.config,
            baseUrl,
          }, {
            artifactId: data.artifactId,
          })
          this.sendTo(ws, 'artifact.download.ready', result)
        } catch {
          this.sendTo(ws, 'error', {
            code: 'ARTIFACT_DOWNLOAD_UNAVAILABLE',
            message: 'Artifact download is not available',
          })
        }
        break
      }

      case 'search.query': {
        try {
          const data = searchQuerySchema.parse(frame.d)
          const results = await messageRepo.searchMessages(data.q, data.topicId)
          logger.info({ query: data.q, count: results.length }, 'Search completed')
          // Send results back to the requesting client only
          this.sendTo(ws, 'error', {
            code: 'SEARCH_RESULTS',
            message: JSON.stringify(results),
          })
        } catch (err) {
          logger.warn({ err }, 'Search failed')
        }
        break
      }
    }
  }
}

function parseTextContent(contentJson: string): string {
  try {
    const parsed = JSON.parse(contentJson) as { content?: string } | string
    return typeof parsed === 'string' ? parsed : parsed.content ?? ''
  } catch {
    return ''
  }
}
