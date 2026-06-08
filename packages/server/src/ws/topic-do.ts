import { DurableObject } from 'cloudflare:workers'
import {
  encodeFrame, decodeFrame, createFrame, type WSFrame,
  type Topic,
  topicCreateSchema, topicDeleteSchema, topicRenameSchema,
  topicSetModelSchema, topicSetAttentionTargetSchema, topicDetachExtensionSchema, topicSetPlanModeSchema,
  topicResumeSchema, userActionSchema,
  userMessageRetrySchema, userMessageSchema,
  sopTemplateSaveSchema, sopTemplateDeleteSchema, sopTemplateGenerateSchema,
  cronPauseSchema, cronDeleteSchema, cronEditSchema,
  searchQuerySchema, artifactUploadInitSchema, artifactUploadCompleteSchema, artifactDownloadInitSchema,
  mcpCommandSchema,
  providerRpcSchema,
} from '@agent-chat/protocol'
import type { TodoItem } from '@agent-chat/protocol'
import type { AppConfig } from '../config'
import { errorDetail } from '../error-detail'
import { PiClient } from '../pi/client'
import { routePiEvents } from '../pi/event-router'
import { logger } from '../logger'
import { logGatewayEvent } from '../server-logs'
import { initDb } from '../db/migrate'
import { issueJitJwt } from '../pairing/routes'
import * as topicRepo from '../db/repos/topic.repo'
import * as messageRepo from '../db/repos/message.repo'
import * as sopRepo from '../db/repos/sop_template.repo'
import * as cronRepo from '../db/repos/cron.repo'
import * as artifactRepo from '../db/repos/artifact.repo'
import * as interactionRepo from '../db/repos/interaction.repo'
import * as runtimeEventRepo from '../db/repos/topic_runtime_event.repo'
import { buildSessionParams, createPendingUserMessage, deliverUserMessage, restoreExistingTopicSession, startAutoDelivery } from './message-delivery'
import { ARTIFACT_UPLOAD_MAX_BYTES } from '../r2/artifact-access'
import {
  artifactToPayload,
  completeArtifactUpload,
  errorToRpc,
  failArtifactUpload,
  initArtifactDownload,
  rpcError,
  type ArtifactDownloadInitParams,
  type ArtifactUploadCompleteParams,
  type ArtifactUploadFailedParams,
  type ArtifactUploadRequestParams,
  type PendingUpload,
  requestArtifactUpload,
} from './artifact-control'
import { abortSessionWithTimeout, finalizeTopicAbort } from './abort-control'
import { listPendingInteractionHistory } from './interaction-history'
import { buildConnectedSessionHealthPayload } from './session-health'
import { buildSopDraftFromHistory, composeSopWorkflow, type SopNode } from '../sop/workflow'

interface DOEnv {
  DB: D1Database
  R2?: R2Bucket
}

const HEARTBEAT_INTERVAL_MS = 30_000

type SessionCreateTrigger = 'topic.create' | 'topic.select.retry'

type SopTemplatePayload = {
  id: string
  name: string
  icon: string | null
  description: string | null
  agent_type: 'programming' | 'general' | 'any'
  instruction: string
  input_contract: string | null
  output_contract: string
  plan_template: string | null
  todo_items_json: string | null
  builtin: boolean
  created_at: number
  updated_at: number
}

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
    const piConfigChanged = this.config?.piAdapterUrl !== config.piAdapterUrl
      || this.config?.piAdapterToken !== config.piAdapterToken
    this.config = config
    await this.ctx.storage.put('config_json', JSON.stringify(config))
    await this.ctx.storage.put('topicId', topicId)
    if (piConfigChanged && this.piClient) {
      this.piClient.disconnect()
      this.piClient = null
    }
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
    routePiEvents(this.piClient, this, this.config, {
      waitUntil: (promise) => this.ctx.waitUntil(promise),
    })
    this.piClient.on('rpc', async ({ sessionId, method, params, reply }) => {
      try {
        const result = await this.handleAdapterRpc(sessionId, method, params)
        reply(null, result)
      } catch (err) {
        reply(errorToRpc(err))
      }
    })
    // Persist lastSeq to DO storage so reconnects after hibernation use the
    // correct sequence number instead of 0, preventing context loss (BUG-052).
    this.piClient.onLastSeqUpdate = (sessionId, seq) => {
      void this.ctx.storage.put(`pi_last_seq:${sessionId}`, seq)
    }
    return this.piClient
  }

  private async waitForSessionId(topicId: string, timeoutMs: number): Promise<string | null> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const topic = await topicRepo.getTopic(topicId)
      if (topic?.pi_session_id) return topic.pi_session_id
      await new Promise((r) => setTimeout(r, 100))
    }
    return null
  }

  // After DO hibernation the piClient is recreated with no sessions — reconnect on demand.
  // Restores persisted lastSeq before reconnecting so attachSession uses the correct
  // sequence number instead of 0, reducing context loss after wake-up (BUG-052).
  private async ensureSession(pi: PiClient, sessionId: string): Promise<boolean> {
    if (pi.hasSession(sessionId)) return true
    try {
      const persistedSeq = await this.ctx.storage.get<number>(`pi_last_seq:${sessionId}`)
      if (persistedSeq) pi.restoreLastSeq(sessionId, persistedSeq)
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
      this.sendTo(server, 'sop_template.list', { templates: templates.map(sopTemplateToPayload) })
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

  // ─── Session background helpers ─────────────────────────────────────────

  private async restoreSessionInBackground(topicId: string, pi: PiClient): Promise<void> {
    try {
      await restoreExistingTopicSession(topicId, pi)
      logger.info({ topicId }, 'Background session restoration succeeded')
    } catch (err) {
      logger.warn({ err, topicId }, 'Background session restoration failed')
    }
  }

  private sessionCreateErrorPayload(err: unknown): Record<string, unknown> {
    return errorDetail(err) as unknown as Record<string, unknown>
  }

  private async logSessionCreateFailure(input: {
    trigger: SessionCreateTrigger
    topic: Topic
    params?: unknown
    err?: unknown
    code?: string
    message?: string
  }): Promise<void> {
    await logGatewayEvent({
      eventKind: 'topic.session_create.failed',
      topicId: input.topic.id,
      status: 'failed',
      payload: {
        trigger: input.trigger,
        topicName: input.topic.name,
        agentType: input.topic.agent_type,
        adapterUrl: this.config?.piAdapterUrl,
        params: input.params,
        ...(input.err
          ? this.sessionCreateErrorPayload(input.err)
          : { code: input.code, message: input.message }),
      },
    })
  }

  private async establishTopicSession(input: {
    ws: WebSocket
    topic: Topic
    trigger: SessionCreateTrigger
    providerId?: string
  }): Promise<boolean> {
    const { ws, topic, trigger, providerId } = input
    logger.info({ topicId: topic.id, trigger }, 'topic session gateway starting')

    try {
      const piForCreate = await this.ensurePiClient()
      logger.info({ topicId: topic.id, trigger, hasPi: !!piForCreate }, 'topic session gateway resolved PI client')
      if (!piForCreate) {
        await this.logSessionCreateFailure({
          trigger,
          topic,
          code: 'NO_PI_CLIENT',
          message: 'No PI client available',
        })
        this.broadcastAll('error', {
          code: 'PI_SESSION_FAILED',
          message: 'No PI client available',
          details: {
            topicId: topic.id,
            trigger,
            error: 'No PI client available',
          },
        })
        this.sendTo(ws, 'session.status', { topicId: topic.id, ready: false })
        return false
      }

      const params = buildSessionParams(topic) as Parameters<typeof piForCreate.createSession>[0]
      if (providerId) {
        (params as Record<string, unknown>).providerId = providerId
      }

      // Refresh the pairing JWT before opening a new WS connection to the adapter.
      // The piAdapterUrl carries an access_token with TTL=300s; after that window
      // every new createSession call would fail with jwt_expired. Use the stored
      // deviceCredential to mint a fresh JIT JWT just for this connection.
      const cfg = this.config!
      const prevUrl = cfg.piAdapterUrl
      if (cfg.deviceCredential && cfg.adapterInstanceId && cfg.serverOrigin) {
        const jwt = await issueJitJwt(
          cfg.deviceCredential,
          cfg.adapterInstanceId,
          cfg.serverOrigin,
        )
        if (jwt) {
          const base = prevUrl.replace(/[?&]access_token=[^&]*/, '').replace(/[?&]$/, '')
          const sep = base.includes('?') ? '&' : '?'
          cfg.piAdapterUrl = `${base}${sep}access_token=${encodeURIComponent(jwt)}`
        }
      }

      await logGatewayEvent({
        eventKind: 'topic.session_create.started',
        topicId: topic.id,
        status: 'started',
        payload: {
          trigger,
          topicName: topic.name,
          agentType: topic.agent_type,
          adapterUrl: this.config?.piAdapterUrl,
          params,
        },
      })
      logger.info({ topicId: topic.id, trigger, params }, 'topic session gateway calling createSession')
      const result = await piForCreate.createSession(params)
      logger.info({ topicId: topic.id, trigger, sessionId: result.sessionId }, 'topic session gateway createSession succeeded')
      const updated = await topicRepo.updateTopic(topic.id, { pi_session_id: result.sessionId })
      if (updated) {
        this.broadcastAll('topic.updated', updated as unknown as Record<string, unknown>)
      }
      await logGatewayEvent({
        eventKind: 'topic.session_create.succeeded',
        topicId: topic.id,
        sessionId: result.sessionId,
        status: 'succeeded',
        payload: {
          trigger,
          topicName: topic.name,
          agentType: topic.agent_type,
        },
      })
      this.sendTo(ws, 'session.status', { topicId: topic.id, ready: true })
      return true
    } catch (err) {
      logger.error({ err, topicId: topic.id, trigger }, 'createSession failed')
      await this.logSessionCreateFailure({
        trigger,
        topic,
        params: buildSessionParams(topic),
        err,
      })
      this.broadcastAll('error', {
        code: 'PI_SESSION_FAILED',
        message: 'Failed to create agent session',
        details: {
          topicId: topic.id,
          trigger,
          error: errorDetail(err),
        },
      })
      this.sendTo(ws, 'session.status', { topicId: topic.id, ready: false })
      return false
    }
  }

  // ─── Send helpers ─────────────────────────────────────────────────────────
  private sendTo(ws: WebSocket, type: string, data: unknown): void {
    if (ws.readyState === WebSocket.READY_STATE_OPEN) {
      ws.send(encodeFrame(createFrame(type as never, data)))
    }
  }

  broadcastAll(type: string, data: Record<string, unknown>): void {
    const sockets = this.ctx.getWebSockets()
    const states = sockets.map((ws) => ws.readyState)
    const raw = encodeFrame(createFrame(type as never, data))
    let sent = 0
    for (const ws of sockets) {
      if (ws.readyState !== WebSocket.READY_STATE_OPEN) continue
      try {
        ws.send(raw)
        sent += 1
      } catch (err) {
        logger.warn({ err, type, ...this.broadcastTraceFields(data) }, 'WS event broadcast failed')
      }
    }
    logger.info(
      { type, sockets: sockets.length, sent, states, ...this.broadcastTraceFields(data) },
      'WS event broadcasted',
    )
  }

  // EventBroadcaster interface (used by routePiEvents)
  broadcast(type: string, data: unknown): void {
    this.broadcastAll(type, data as Record<string, unknown>)
  }

  private broadcastTraceFields(data: Record<string, unknown>): Record<string, unknown> {
    return {
      topicId: data.topicId,
      messageId: data.messageId,
      clientMessageId: data.clientMessageId,
      artifactId: data.artifactId ?? data.id,
      interactionId: data.interactionId,
      cronId: data.cronId,
      status: data.status,
      code: data.code,
    }
  }

  private artifactToPayload(artifact: import('@agent-chat/protocol').Artifact): Record<string, unknown> {
    return artifactToPayload(artifact)
  }

  // ─── Cron helpers ─────────────────────────────────────────────────────────
  private cronJobToPayload(job: {
    id: string
    origin_topic_id: string | null
    pi_cron_id: string
    cron_expr: string
    prompt: string
    tags?: string[] | null
    status: string
    next_run_at: number | null
    created_at?: number
    updated_at?: number
  }) {
    return {
      cronId: job.pi_cron_id,
      localCronId: job.id,
      originTopicId: job.origin_topic_id,
      cronExpr: job.cron_expr,
      prompt: job.prompt,
      tags: job.tags ?? undefined,
      status: job.status,
      lastRunAt: undefined as number | undefined,
      nextRunAt: job.next_run_at ?? undefined,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    }
  }

  private async syncCronsFromPi(pi: PiClient): Promise<void> {
    try {
      const result = await pi.rpcGlobal('listCrons', {}) as Array<{
        cronId: string
        originTopicId?: string
        originSessionId: string
        cronExpr: string
        prompt: string
        tags?: string[]
        status: string
        lastRunAt?: number
        nextRunAt?: number
      }>
      for (const c of result) {
        const topics = await topicRepo.listTopics()
        const originTopic = topics.find(t => t.pi_session_id === c.originSessionId)
        const originTopicId = c.originTopicId ?? originTopic?.id ?? null
        const existing = await cronRepo.getCronJobByPiCronId(c.cronId)
        if (existing) {
          await cronRepo.updateCronJob(existing.id, {
            status: c.status as 'active' | 'paused' | 'error',
            cron_expr: c.cronExpr,
            prompt: c.prompt,
            next_run_at: c.nextRunAt,
            tags: c.tags,
          })
        } else if (originTopicId) {
          await cronRepo.createCronJob({
            originTopicId,
            piCronId: c.cronId,
            cronExpr: c.cronExpr,
            prompt: c.prompt,
            tags: c.tags,
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

        // Session gateway for topic.select:
        // - Existing topics (pi_session_id exists): ready:true immediately, restore in background.
        //   Delivery logic handles reconnection if session not in memory.
        // - New topics (pi_session_id is NULL): ready:false — createSession still in-flight,
        //   topic.create handler will send ready:true when it completes.
        const isSystemTopic = d.topicId.startsWith('system_')
        if (!isSystemTopic) {
          const pi = await this.ensurePiClient()
          const topic = await topicRepo.getTopic(d.topicId)
          const hasSession = !!topic?.pi_session_id
          this.sendTo(ws, 'session.status', { topicId: d.topicId, ready: hasSession })

          const connectedHealth = buildConnectedSessionHealthPayload({
            topicId: d.topicId,
            piSessionId: topic?.pi_session_id,
            isAttached: !!(pi && topic?.pi_session_id && pi.hasSession(topic.pi_session_id)),
          })
          if (connectedHealth) {
            this.sendTo(ws, 'session.health', connectedHealth)
          }

          if (hasSession && pi && !pi.hasSession(topic!.pi_session_id!)) {
            this.ctx.waitUntil(this.restoreSessionInBackground(d.topicId, pi))
          } else if (topic && topic.kind === 'normal' && !hasSession) {
            this.ctx.waitUntil(this.establishTopicSession({
              ws,
              topic,
              trigger: 'topic.select.retry',
            }))
          }
        }

        break
      }

      case 'messages.load': {
        const d = frame.d as { topicId: string }
        try {
          await messageRepo.flushParts()
          const msgs = await messageRepo.listMessagesByTopic(d.topicId)
          const partsByMessage: Record<string, unknown[]> = {}
          for (const msg of msgs) {
            const parts = await messageRepo.getMessageParts(msg.id)
            if (parts.length > 0) partsByMessage[msg.id] = parts
          }
          const latestTodo = await runtimeEventRepo.getLatestTopicRuntimeEvent(d.topicId, 'todo')
          const latestPlan = await runtimeEventRepo.getLatestTopicRuntimeEvent(d.topicId, 'plan')
          const todoPayload = parseRuntimePayload(latestTodo?.payload_json ?? null)
          const todos = (todoPayload.input as { todos?: unknown } | undefined)?.todos
          const planPayload = parseRuntimePayload(latestPlan?.payload_json ?? null)
          this.sendTo(ws, 'messages.history', {
            topicId: d.topicId,
            messages: msgs,
            partsByMessage,
            pendingInteractions: await listPendingInteractionHistory(d.topicId),
            todos: Array.isArray(todos) ? todos : undefined,
            plan: typeof planPayload.text === 'string' ? planPayload.text : undefined,
          })
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
        const requestedCwd = data.agentType === 'programming'
          ? data.programming?.cwd?.trim()
          : data.general?.cwd?.trim()
        if (requestedCwd) {
          const occupiedTopic = await topicRepo.getTopicByCwd(requestedCwd)
          if (occupiedTopic) {
            this.broadcastAll('error', {
              code: 'DUPLICATE_CWD',
              message: '已有同目录话题',
              details: {
                topicId: occupiedTopic.id,
                topicName: occupiedTopic.name,
                cwd: requestedCwd,
              },
            })
            break
          }
        }
        const selectedSopIds = data.sopIds?.length
          ? data.sopIds
          : data.sopTemplateId
            ? [data.sopTemplateId]
            : []
        const selectedSops = []
        for (const sopId of selectedSopIds) {
          const template = await sopRepo.getTemplate(sopId)
          if (!template) {
            this.broadcastAll('error', { code: 'SOP_NOT_FOUND', message: 'SOP 不存在' })
            return
          }
          if (template.agent_type !== 'any' && template.agent_type !== data.agentType) {
            this.broadcastAll('error', { code: 'SOP_AGENT_TYPE_MISMATCH', message: 'SOP 不适用于当前 Agent 类型' })
            return
          }
          selectedSops.push(template)
        }
        const sopWorkflow = composeSopWorkflow(selectedSops.map(sopTemplateToNode))

        const generalSpec = data.agentType === 'general'
          ? {
              ...data.general,
              ...(sopWorkflow
                ? {
                    systemPrompt: mergeSystemPrompt(undefined, sopWorkflow.composedInstruction),
                    initialPlan: sopWorkflow.composedPlan,
                    initialTodos: sopWorkflow.composedTodos,
                    sopWorkflow,
                  }
                : {}),
            }
          : undefined
        const generalSpecJson = generalSpec && Object.values(generalSpec).some((value) => value !== undefined)
          ? JSON.stringify(generalSpec)
          : null
        const programmingSpec = data.agentType === 'programming'
          ? {
              ...(data.programming ?? {}),
              ...(sopWorkflow
                ? {
                    systemPrompt: mergeSystemPrompt(undefined, sopWorkflow.composedInstruction),
                    sopWorkflow,
                  }
                : {}),
            }
          : undefined

        const topic = await topicRepo.createTopic({
          name: data.name,
          kind: 'normal',
          agentType: data.agentType,
          programmingSpecJson: programmingSpec && Object.values(programmingSpec).some((value) => value !== undefined)
            ? JSON.stringify(programmingSpec)
            : null,
          generalSpecJson,
          sopTemplateId: selectedSopIds[0] ?? null,
          currentProviderId: data.providerId ?? null,
          currentModel: data.model ?? null,
        })

        // Broadcast topic immediately so sidebar shows it, then establish session.
        this.broadcastAll('topic.created', {
          ...(topic as unknown as Record<string, unknown>),
          sessionReady: false,
        })

        // Session gateway: await createSession directly in the handler.
        // DO guarantees webSocketMessage handler runs to completion — no GC risk.
        await this.establishTopicSession({
          ws,
          topic,
          trigger: 'topic.create',
          providerId: data.providerId,
        })
        break
      }

      case 'sop_template.create': {
        const data = sopTemplateSaveSchema.parse(frame.d)
        await sopRepo.createTemplate({
          name: data.name,
          icon: data.icon ?? undefined,
          description: data.description ?? undefined,
          agentType: data.agent_type,
          instruction: data.instruction,
          inputContract: data.input_contract ?? null,
          outputContract: data.output_contract,
          planTemplate: data.plan_template ?? undefined,
          todoItemsJson: data.todo_items_json ?? null,
          builtin: false,
        })
        const templates = await sopRepo.listTemplates()
        this.broadcastAll('sop_template.list', { templates: templates.map(sopTemplateToPayload) })
        break
      }

      case 'sop_template.update': {
        const data = sopTemplateSaveSchema.parse(frame.d)
        if (!data.id) {
          this.broadcastAll('error', { code: 'SOP_ID_REQUIRED', message: 'SOP id 不能为空' })
          break
        }
        const updated = await sopRepo.updateTemplate(data.id, {
          name: data.name,
          icon: data.icon ?? null,
          description: data.description ?? null,
          agent_type: data.agent_type,
          instruction: data.instruction,
          input_contract: data.input_contract ?? null,
          output_contract: data.output_contract,
          plan_template: data.plan_template ?? null,
          todo_items_json: data.todo_items_json ?? null,
        })
        if (!updated) {
          this.broadcastAll('error', { code: 'SOP_NOT_FOUND', message: 'SOP 不存在或不可编辑' })
          break
        }
        const templates = await sopRepo.listTemplates()
        this.broadcastAll('sop_template.list', { templates: templates.map(sopTemplateToPayload) })
        break
      }

      case 'sop_template.delete': {
        const data = sopTemplateDeleteSchema.parse(frame.d)
        const deleted = await sopRepo.deleteTemplate(data.id)
        if (!deleted) {
          this.broadcastAll('error', { code: 'SOP_NOT_FOUND', message: 'SOP 不存在或不可删除' })
          break
        }
        const templates = await sopRepo.listTemplates()
        this.broadcastAll('sop_template.list', { templates: templates.map(sopTemplateToPayload) })
        break
      }

      case 'sop_template.generate': {
        const data = sopTemplateGenerateSchema.parse(frame.d)
        const topic = await topicRepo.getTopic(data.topicId)
        if (!topic) {
          this.broadcastAll('error', { code: 'TOPIC_NOT_FOUND', message: '话题不存在' })
          break
        }
        const messages = await messageRepo.listMessagesByTopic(data.topicId, 200)
        const history: Array<{ role: string; content: string }> = []
        for (const message of messages) {
          const parts = await messageRepo.getMessageParts(message.id)
          const content = parts
            .filter((part) => part.kind === 'text')
            .map((part) => parseTextContent(part.content_json))
            .filter(Boolean)
            .join('\n')
          if (content.trim()) history.push({ role: message.role, content })
        }
        const draft = buildSopDraftFromHistory({ topicName: topic.name, messages: history })
        this.sendTo(ws, 'sop_template.generated', {
          template: {
            name: draft.name,
            icon: null,
            description: draft.description ?? null,
            agent_type: draft.agent_type,
            instruction: draft.instruction,
            input_contract: draft.input_contract ?? null,
            output_contract: draft.output_contract,
            plan_template: draft.plan_template ?? null,
            todo_items_json: draft.todo_items ? JSON.stringify(draft.todo_items) : null,
          },
        })
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
        const updated = await topicRepo.updateTopic(data.id, { current_model: data.model })
        if (updated) this.broadcastAll('topic.updated', updated as unknown as Record<string, unknown>)
        if (topic.pi_session_id) {
          const pi = await this.ensurePiClient()
          if (pi && await this.ensureSession(pi, topic.pi_session_id)) {
            try {
              const result = await pi.rpc('setSessionModel', { sessionId: topic.pi_session_id, model: data.model })
              if (!result?.ok) {
                this.broadcastAll('error', {
                  code: 'MODEL_SWITCH_FAILED',
                  message: '模型已保存，但当前会话切换失败；重新进入话题后会使用新模型',
                  details: {
                    topicId: data.id,
                    model: data.model,
                  },
                })
                break
              }
            } catch (err) {
              logger.warn({ err }, 'Failed to set model on PI')
              this.broadcastAll('error', {
                code: 'MODEL_SWITCH_FAILED',
                message: '模型已保存，但当前会话切换失败；重新进入话题后会使用新模型',
                details: {
                  topicId: data.id,
                  model: data.model,
                  error: err instanceof Error ? err.message : String(err),
                },
              })
            }
          }
        }
        break
      }

      case 'topic.setAttentionTarget': {
        const data = topicSetAttentionTargetSchema.parse(frame.d)
        const updated = await topicRepo.updateTopic(data.id, { attention_target: data.target?.trim() || null })
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
              await pi.rpcWithRetry('setPlanMode', { sessionId: topic.pi_session_id, planMode: data.planMode })
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

      case 'mcp.command': {
        const data = mcpCommandSchema.parse(frame.d)
        if (!this.config) {
          this.sendTo(ws, 'mcp.command.error', { requestId: data.requestId, code: 'PI_UNAVAILABLE', message: 'Config not initialized' })
          break
        }
        try {
          const wssUrl = new URL(this.config.originalPiAdapterUrl || this.config.piAdapterUrl)
          const mcpUrl = `${wssUrl.protocol === 'wss:' ? 'https:' : 'http:'}//${wssUrl.host}/api/agent-chat/v1/mcp`
          logger.info({ mcpUrl, action: data.action, scope: data.scope }, 'MCP HTTP request')
          const headers: Record<string, string> = { 'Content-Type': 'application/json' }
          if (this.config.piAdapterToken) headers['Authorization'] = `Bearer ${this.config.piAdapterToken}`

          const adapterBody: Record<string, unknown> = {
            action: data.action,
            name: data.name,
            scope: data.scope,
            projectDir: data.projectDir,
          }
          if (data.action === 'add' && typeof data.command === 'string' && data.command.trim()) {
            const parts = data.command.trim().split(/\s+/)
            adapterBody.spec = { transport: 'stdio', command: parts[0], args: parts.slice(1) }
          }

          const res = await fetch(mcpUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(adapterBody),
            signal: AbortSignal.timeout(10_000),
          })
          if (!res.ok) {
            const body = await res.text()
            logger.error({ status: res.status, body }, 'MCP HTTP error response')
            throw new Error(`adapter returned HTTP ${res.status}: ${body.slice(0, 200)}`)
          }
          const result = await res.json() as { stdout: string; stderr: string; exitCode: number; servers?: Array<{ name: string; scope: string }> }
          this.sendTo(ws, 'mcp.command.result', { requestId: data.requestId, ...result })

          // After add/remove, notify adapter via PI WS to reload MCP config
          if (data.action === 'add' || data.action === 'remove') {
            try {
              const pi = await this.ensurePiClient()
              if (pi && pi.isConnected) {
                await pi.rpcGlobal('runMcpCommand', { action: 'list', name: undefined, spec: undefined })
                logger.info({ action: data.action, name: data.name, scope: data.scope }, 'MCP config change notified to adapter')
              }
            } catch (notifyErr) {
              logger.warn({ err: notifyErr, action: data.action }, 'Failed to notify adapter of MCP config change')
            }
          }
        } catch (err) {
          logger.error({ err, action: data.action }, 'MCP HTTP request failed')
          this.sendTo(ws, 'mcp.command.error', {
            requestId: data.requestId,
            code: 'PI_MCP_COMMAND_FAILED',
            message: err instanceof Error ? err.message : String(err),
          })
        }
        break
      }

      case 'provider.rpc': {
        const data = providerRpcSchema.parse(frame.d)
        const pi = await this.ensurePiClient()
        if (!pi) {
          this.sendTo(ws, 'provider.rpc.error', {
            requestId: data.requestId,
            code: 'PI_UNAVAILABLE',
            message: 'Config not initialized',
          })
          break
        }
        try {
          let result: unknown
          if (data.method === 'switchSessionProvider') {
            const topicId = (data.params as Record<string, unknown>).topicId as string
            if (!topicId) {
              this.sendTo(ws, 'provider.rpc.error', {
                requestId: data.requestId,
                code: 'INVALID_PARAMS',
                message: 'topicId is required for switchSessionProvider',
              })
              break
            }
            const topic = await topicRepo.getTopic(topicId)
            if (!topic?.pi_session_id) {
              this.sendTo(ws, 'provider.rpc.error', {
                requestId: data.requestId,
                code: 'NO_SESSION',
                message: 'No PI session for this topic',
              })
              break
            }
            result = await pi.rpc('switchSessionProvider', {
              sessionId: topic.pi_session_id,
              providerId: (data.params as Record<string, unknown>).providerId as string,
            })
            // adapter will emit session.health during switch — no extra handling needed
          } else {
            // listProviderConfigs / addProviderConfig / updateProviderConfig / removeProviderConfig / getUsage
            // are session-agnostic — use rpcGlobal (transient session to adapter)
            result = await pi.rpcGlobal(data.method, data.params)
          }
          this.sendTo(ws, 'provider.rpc.result', { requestId: data.requestId, result })
        } catch (err) {
          logger.warn({ err, method: data.method }, 'Provider RPC relay failed')
          this.sendTo(ws, 'provider.rpc.error', {
            requestId: data.requestId,
            code: 'PI_RPC_FAILED',
            message: err instanceof Error ? err.message : String(err),
          })
        }
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
        const job = await cronRepo.getCronJobByCronId(data.cronId)
        if (!job) break
        const pi = await this.ensurePiClient()
        if (pi) {
          try {
            await pi.rpcGlobal('pauseCron', { cronId: data.cronId })
          } catch (err) {
            logger.warn({ err }, 'Failed to pause cron on PI')
          }
        }
        const updated = await cronRepo.updateCronJob(job.id, { status: 'paused' })
        if (updated) this.broadcastAll('cron.upserted', this.cronJobToPayload(updated))
        break
      }

      case 'cron.resume': {
        // cron.resume re-activates a paused cron — forward to PI
        const d = frame.d as { cronId: string }
        const job = await cronRepo.getCronJobByCronId(d.cronId)
        if (!job) break
        const pi = await this.ensurePiClient()
        if (pi) {
          try {
            await pi.rpcGlobal('resumeCron', { cronId: d.cronId })
          } catch (err) {
            logger.warn({ err }, 'Failed to resume cron on PI')
          }
        }
        const updated = await cronRepo.updateCronJob(job.id, { status: 'active' })
        if (updated) this.broadcastAll('cron.upserted', this.cronJobToPayload(updated))
        break
      }

      case 'cron.delete': {
        const data = cronDeleteSchema.parse(frame.d)
        const job = await cronRepo.getCronJobByCronId(data.cronId)
        if (!job) break
        const pi = await this.ensurePiClient()
        if (pi) {
          try {
            await pi.rpcGlobal('deleteCron', { cronId: data.cronId })
          } catch (err) {
            logger.warn({ err }, 'Failed to delete cron on PI')
          }
        }
        await cronRepo.deleteCronJob(job.id)
        const jobs = await cronRepo.listCronJobs()
        this.broadcastAll('cron.list', { crons: jobs.map(j => this.cronJobToPayload(j)) })
        break
      }

      case 'cron.edit': {
        const data = cronEditSchema.parse(frame.d)
        const job = await cronRepo.getCronJobByCronId(data.cronId)
        if (!job) break
        const updated = await cronRepo.updateCronJob(job.id, {
          ...(data.cronExpr ? { cron_expr: data.cronExpr } : {}),
          ...(data.prompt ? { prompt: data.prompt } : {}),
          ...(data.tags !== undefined ? { tags: data.tags } : {}),
        })
        if (updated) {
          const pi = await this.ensurePiClient()
          if (pi) {
            try {
              await pi.rpcGlobal('updateCron', {
                cronId: data.cronId,
                ...(data.cronExpr ? { cronExpr: data.cronExpr } : {}),
                ...(data.prompt ? { prompt: data.prompt } : {}),
                ...(data.tags !== undefined ? { tags: data.tags } : {}),
              })
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
        let topic = await topicRepo.getTopic(data.topicId)
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

        // Wait for PI session to be ready if topic was just created (race with concurrent topic.create)
        const sessionReady = topic.pi_session_id || await this.waitForSessionId(data.topicId, 3000)
        if (!sessionReady) {
          // No session and not forthcoming — delivery will handle needs_retry
        }

        this.ctx.waitUntil(startAutoDelivery({
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
        }))
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
          this.broadcastAll('agent.status', { topicId: data.topicId, state: 'aborting' })
          const topic = await topicRepo.getTopic(data.topicId)
          if (topic?.pi_session_id) {
            const sessionId = topic.pi_session_id
            const pi = await this.ensurePiClient()
            if (pi && await this.ensureSession(pi, sessionId)) {
              try {
                await abortSessionWithTimeout(() => pi.rpc('abortSession', { sessionId }))
              } catch (err) {
                logger.warn({ err }, 'Failed to abort session on PI')
              }
            }
          }
          await finalizeTopicAbort(data.topicId, this)
          break
        }

        // approve / reject / choose interaction
        if (data.interactionId) {
          const interaction = await interactionRepo.getInteraction(data.interactionId)
          if (!interaction || interaction.status !== 'pending') break

          const decision = data.action === 'choose' ? 'choose' : data.action === 'approve' ? 'approve' : 'reject'
          const responsePayload = data.action === 'choose' && data.choice
            ? { decision, choice: data.choice }
            : { decision }
          await interactionRepo.updateInteraction(data.interactionId, {
            status: 'resolved',
            response_json: JSON.stringify(responsePayload),
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
                  ...(data.action === 'choose' && data.choice ? { choice: data.choice } : {}),
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
          await this.ensureGeneratedArtifactUploaded(data.artifactId)
          const result = await initArtifactDownload({
            config: this.config,
            baseUrl,
          }, {
            artifactId: data.artifactId,
          })
          this.sendTo(ws, 'artifact.download.ready', result)
        } catch (err) {
          const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : 'ARTIFACT_DOWNLOAD_UNAVAILABLE'
          const message = err instanceof Error ? err.message : 'Artifact download is not available'
          this.sendTo(ws, 'error', {
            code,
            message,
            details: { artifactId: data.artifactId },
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

  private async ensureGeneratedArtifactUploaded(artifactId: string): Promise<void> {
    const artifact = await artifactRepo.getArtifact(artifactId)
    if (!artifact || artifact.r2_key || artifact.source !== 'generated') return

    const filePath = artifactPathFromMetadata(artifact.metadata_json)
    if (!filePath) {
      throw new Error('Generated artifact has no local path')
    }

    const topicId = artifact.topic_id ?? artifact.origin_topic_id
    if (!topicId) {
      throw new Error('Generated artifact is not linked to a topic')
    }
    const topic = await topicRepo.getTopic(topicId)
    if (!topic?.pi_session_id) {
      throw new Error('Generated artifact topic has no active adapter session')
    }

    const pi = await this.ensurePiClient()
    if (!pi) {
      throw new Error('Adapter is not connected')
    }

    const result = await pi.rpc('uploadGeneratedArtifact', {
      sessionId: topic.pi_session_id,
      topicId,
      artifactId: artifact.id,
      filePath,
    })
    if (result.uploadStatus !== 'uploaded') {
      const failedArtifact = await artifactRepo.getArtifact(result.artifactId)
      throw rpcError(
        failedArtifact?.failure_code ?? 'artifact_upload_failed',
        failedArtifact?.failure_message ?? 'Generated artifact upload failed',
      )
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

function artifactPathFromMetadata(metadataJson: string | null | undefined): string | null {
  if (!metadataJson) return null
  try {
    const parsed = JSON.parse(metadataJson) as { path?: unknown; filePath?: unknown; file_path?: unknown }
    const path = parsed.path ?? parsed.filePath ?? parsed.file_path
    return typeof path === 'string' && path.trim() ? path : null
  } catch {
    return null
  }
}

function sopTemplateToPayload(template: sopRepo.SopTemplate): SopTemplatePayload {
  return {
    id: template.id,
    name: template.name,
    icon: template.icon,
    description: template.description,
    agent_type: template.agent_type,
    instruction: template.instruction,
    input_contract: template.input_contract,
    output_contract: template.output_contract,
    plan_template: template.plan_template,
    todo_items_json: template.todo_items_json,
    builtin: template.builtin,
    created_at: template.created_at,
    updated_at: template.updated_at,
  }
}

function parseTodoItems(value: string | null): TodoItem[] | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as TodoItem[]
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function parseRuntimePayload(value: string | null): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function sopTemplateToNode(template: sopRepo.SopTemplate): SopNode {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    agent_type: template.agent_type,
    instruction: template.instruction,
    input_contract: template.input_contract,
    output_contract: template.output_contract,
    plan_template: template.plan_template,
    todo_items: parseTodoItems(template.todo_items_json),
    created_at: template.created_at,
    updated_at: template.updated_at,
  }
}

function mergeSystemPrompt(existing: string | undefined, addition: string | undefined): string | undefined {
  if (!addition?.trim()) return existing
  if (!existing?.trim()) return addition
  return `${existing.trim()}\n\n${addition.trim()}`
}
