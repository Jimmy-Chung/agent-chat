import type { PIEvent } from '@agent-chat/protocol'
import type { PiClient } from './client'
import * as topicRepo from '../db/repos/topic.repo'
import * as messageRepo from '../db/repos/message.repo'
import * as interactionRepo from '../db/repos/interaction.repo'
import * as artifactRepo from '../db/repos/artifact.repo'
import { artifactToPayload } from '../ws/artifact-control'
import * as usageRepo from '../db/repos/usage.repo'
import * as cronRepo from '../db/repos/cron.repo'
import * as pushRepo from '../db/repos/push-subscription.repo'
import { buildVapidAuthHeader } from '../lib/vapid'
import { encryptPushPayload } from '../lib/web-push'
import type { AppConfig } from '../config'
import { logger } from '../logger'

/**
 * Map the adapter's agent-state vocabulary to the WS-facing model.
 * The WS schema (ws-events.ts) carries state ∈ {idle, processing, aborting}
 * plus an optional phase ∈ {thinking, streaming, tool_use}; the adapter emits
 * a flatter set (thinking/streaming/tool/waiting_for_user/idle/aborting).
 */
export function mapAgentState(raw: string): {
  state: 'idle' | 'processing' | 'aborting'
  phase?: 'thinking' | 'streaming' | 'tool_use'
} {
  if (raw === 'idle' || raw === 'aborting') return { state: raw }
  if (raw === 'waiting_for_user') return { state: 'processing' }
  const phaseMap: Record<string, 'thinking' | 'streaming' | 'tool_use'> = {
    thinking: 'thinking',
    streaming: 'streaming',
    tool: 'tool_use',
  }
  return { state: 'processing', phase: phaseMap[raw] ?? 'thinking' }
}

export interface EventBroadcaster {
  broadcast(type: string, data: unknown): void
}

export interface PushPayload {
  title: string
  body: string
  tag?: string
  url?: string
}

async function sendPushToAll(payload: PushPayload, config: AppConfig): Promise<void> {
  if (!config.vapidPublicKey || !config.vapidPrivateKey) return
  const subs = await pushRepo.listSubscriptions()
  if (subs.length === 0) return

  await Promise.all(
    subs.map(async (sub) => {
      try {
        const { body, contentEncoding } = await encryptPushPayload(
          JSON.stringify(payload),
          sub,
        )
        const authHeader = await buildVapidAuthHeader(
          sub.endpoint,
          config.vapidPrivateKey,
          config.vapidPublicKey,
          config.vapidSubject,
        )
        const res = await fetch(sub.endpoint, {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/octet-stream',
            'Content-Encoding': contentEncoding,
            TTL: '86400',
          },
          body,
        })
        if (res.ok) {
          logger.info({ endpoint: sub.endpoint.slice(0, 60) }, 'Push sent OK')
        } else {
          const text = await res.text().catch(() => '')
          logger.warn({ status: res.status, body: text.slice(0, 200), endpoint: sub.endpoint.slice(0, 60) }, 'Push send failed (HTTP)')
          // 410 Gone or 404 → subscription expired, remove it
          if (res.status === 410 || res.status === 404) {
            await pushRepo.deleteSubscription(sub.endpoint).catch(() => {})
          }
        }
      } catch (err) {
        logger.warn({ err, endpoint: sub.endpoint.slice(0, 60) }, 'Push send failed (exception)')
      }
    }),
  )
}

const seenSeqBySession = new Map<string, Set<number>>()
const MAX_SEEN_SEQ_PER_SESSION = 2048
// Track current assistant messageId per session so error events can inject error text
const currentAssistantBySession = new Map<string, string>()
// Serialize events per session to prevent out-of-order broadcasts
const sessionQueues = new Map<string, Promise<void>>()

// BUG-040 ④ — Turn watchdog: after sendUserMessage RPC is ack'd, give the adapter
// a budget to start producing the next assistant turn. If no PI event arrives for
// this topic within the budget, broadcast an error and force agent.status: idle so
// the UI exits loading and lets the user retry. The watchdog is cleared as soon as
// any PI event for that topic reaches the router (means adapter is alive).
interface PendingTurn {
  timer: ReturnType<typeof setTimeout>
  userMessageId: string
  startedAt: number
}
const pendingTurnsByTopic = new Map<string, PendingTurn>()
interface StreamDisconnectFinalizer {
  timer: ReturnType<typeof setTimeout>
  sessionId: string
  startedAt: number
}
const streamDisconnectFinalizersByTopic = new Map<string, StreamDisconnectFinalizer>()

export const DEFAULT_STREAM_DISCONNECT_FINALIZE_TIMEOUT_MS = 90_000

function resolveStreamDisconnectFinalizeTimeout(): number {
  const raw = typeof process !== 'undefined' ? process.env?.STREAM_DISCONNECT_FINALIZE_TIMEOUT_MS : undefined
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return DEFAULT_STREAM_DISCONNECT_FINALIZE_TIMEOUT_MS
}

export function startPendingTurnWatchdog(
  topicId: string,
  userMessageId: string,
  broadcaster: EventBroadcaster,
  timeoutMs: number,
): void {
  clearPendingTurnWatchdog(topicId)
  const timer = setTimeout(() => {
    pendingTurnsByTopic.delete(topicId)
    logger.warn(
      { topicId, userMessageId, timeoutMs },
      'Turn watchdog timed out — adapter produced no PI event after sendUserMessage',
    )
    broadcaster.broadcast('error', {
      code: 'TURN_NO_RESPONSE',
      message: 'Agent 在指定时间内没有响应，请重试。',
      details: { topicId, userMessageId, timeoutMs },
    })
    broadcaster.broadcast('agent.status', { topicId, state: 'idle' })
  }, timeoutMs)
  pendingTurnsByTopic.set(topicId, {
    timer,
    userMessageId,
    startedAt: Date.now(),
  })
}

export function clearPendingTurnWatchdog(topicId: string): void {
  const pending = pendingTurnsByTopic.get(topicId)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingTurnsByTopic.delete(topicId)
}

export function startStreamDisconnectFinalizer(
  topicId: string,
  sessionId: string,
  broadcaster: EventBroadcaster,
  timeoutMs = resolveStreamDisconnectFinalizeTimeout(),
): void {
  clearStreamDisconnectFinalizer(topicId)
  const timer = setTimeout(() => {
    streamDisconnectFinalizersByTopic.delete(topicId)
    void finalizeStreamingMessagesAfterDisconnect(topicId, sessionId, broadcaster, timeoutMs)
  }, timeoutMs)
  streamDisconnectFinalizersByTopic.set(topicId, {
    timer,
    sessionId,
    startedAt: Date.now(),
  })
}

export function clearStreamDisconnectFinalizer(topicId: string): void {
  const pending = streamDisconnectFinalizersByTopic.get(topicId)
  if (!pending) return
  clearTimeout(pending.timer)
  streamDisconnectFinalizersByTopic.delete(topicId)
}

async function finalizeStreamingMessagesAfterDisconnect(
  topicId: string,
  sessionId: string,
  broadcaster: EventBroadcaster,
  timeoutMs: number,
): Promise<void> {
  try {
    await messageRepo.flushParts()
  } catch (err) {
    logger.warn({ err, topicId, sessionId }, 'Failed to flush pending parts before disconnect finalize')
  }

  const messages = await messageRepo.listMessagesByTopic(topicId)
  const streamingMessages = messages.filter((message) => message.status === 'streaming')
  if (streamingMessages.length === 0) return

  const now = Date.now()
  logger.warn(
    { topicId, sessionId, timeoutMs, messageIds: streamingMessages.map((message) => message.id) },
    'Finalizing streaming messages after PI session disconnect timeout',
  )
  for (const message of streamingMessages) {
    await messageRepo.updateMessage(message.id, {
      status: 'aborted',
      finished_at: now,
      stop_reason: 'aborted',
    })
    broadcaster.broadcast('message.end', {
      topicId,
      messageId: message.id,
      stopReason: 'aborted',
    })
  }
  broadcaster.broadcast('agent.status', { topicId, state: 'idle' })
}

export function routePiEvents(
  pi: PiClient,
  broadcaster: EventBroadcaster,
  config?: AppConfig,
): void {
  pi.on('session.recreated', ({ sessionId }: { sessionId: string }) => {
    seenSeqBySession.delete(sessionId)
  })

  pi.on('event', (event: PIEvent) => {
    // AIT-150 ② — session.health events carry seq=0 and must not be filtered by
    // seq dedup; they are control-plane signals emitted on connect/disconnect.
    const isHealth = event.payload.kind === 'session.health'
    if (!isHealth) {
      let seenSeq = seenSeqBySession.get(event.sessionId)
      if (!seenSeq) {
        seenSeq = new Set<number>()
        seenSeqBySession.set(event.sessionId, seenSeq)
      }
      if (seenSeq.has(event.seq)) return
      seenSeq.add(event.seq)
      if (seenSeq.size > MAX_SEEN_SEQ_PER_SESSION) {
        const oldest = seenSeq.values().next().value as number | undefined
        if (oldest !== undefined) seenSeq.delete(oldest)
      }
    }

    logger.info(
      {
        kind: event.payload.kind,
        sessionId: event.sessionId,
        seq: event.seq,
        // BUG-046 — correlation keys for end-to-end alignment with adapter logs.
        turnId: event.turnId,
        messageId: (event.payload as { messageId?: string }).messageId,
      },
      'PI event received',
    )

    // BUG-044: Debug — log full event payload for message.delta (echo investigation)
    if (event.payload.kind === 'message.delta') {
      logger.info(
        {
          messageId: event.payload.messageId,
          part: event.payload.part,
          fullEvent: JSON.stringify(event),
        },
        'BUG-044: message.delta full payload',
      )
    }

    const prev = sessionQueues.get(event.sessionId) ?? Promise.resolve()
    sessionQueues.set(event.sessionId, prev.then(() => routeEvent(event, broadcaster, config)).catch((err) => {
      logger.error({ err, kind: event.payload.kind }, 'Error routing PI event')
    }))
  })
}

async function findTopicIdBySession(sessionId: string): Promise<string | null> {
  const topics = await topicRepo.listTopics()
  const match = topics.find((t) => t.pi_session_id === sessionId)
  return match?.id ?? null
}

function cronJobToPayload(job: {
  id: string
  origin_topic_id: string
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
    lastRunAt: undefined,
    nextRunAt: job.next_run_at ?? undefined,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  }
}

async function routeEvent(event: PIEvent, hub: EventBroadcaster, config?: AppConfig): Promise<void> {
  const payload = event.payload
  const sessionId = event.sessionId
  const topicId = await findTopicIdBySession(sessionId)

  // BUG-040 ④ — Any real PI event proves the adapter is alive for this turn.
  // Clear the watchdog before further routing.
  if (topicId) clearPendingTurnWatchdog(topicId)

  switch (payload.kind) {
    case 'message.start': {
      if (!topicId) return
      clearStreamDisconnectFinalizer(topicId)
      let msg = await messageRepo.getMessage(payload.messageId)
      if (!msg) {
        msg = await messageRepo.createMessage({
          topicId,
          role: 'assistant',
          id: payload.messageId,
        })
      }
      currentAssistantBySession.set(sessionId, msg.id)
      hub.broadcast('message.start', {
        topicId,
        messageId: msg.id,
        role: 'assistant',
      })
      hub.broadcast('agent.status', { topicId, state: 'processing', phase: 'streaming' })
      break
    }

    case 'message.delta': {
      if (!topicId) return
      const kind = payload.part.kind
      messageRepo.bufferPartDelta(
        payload.messageId,
        kind === 'text'
          ? 'text'
          : kind === 'thinking'
            ? 'thinking'
            : 'tool_use',
        JSON.stringify(payload.part),
      )
      hub.broadcast('message.delta', {
        topicId,
        messageId: payload.messageId,
        part: payload.part,
      })
      if (kind === 'text' || kind === 'thinking') {
        hub.broadcast('agent.status', { topicId, state: 'processing', phase: 'streaming' })
      }
      break
    }

    case 'message.end': {
      if (!topicId) return
      clearStreamDisconnectFinalizer(topicId)
      await messageRepo.flushParts()

      // If the SDK returned an error, inject the error text as a text part before finalizing
      if (payload.stopReason === 'error' && payload.errorMessage) {
        const errorText = payload.errorMessage
        await messageRepo.createMessagePart({
          messageId: payload.messageId,
          kind: 'text',
          contentJson: JSON.stringify({ content: errorText }),
        })
        hub.broadcast('message.delta', {
          topicId,
          messageId: payload.messageId,
          part: { kind: 'text', content: errorText },
        })
      }

      await messageRepo.updateMessage(payload.messageId, {
        status: 'done',
        finished_at: Date.now(),
        stop_reason: payload.stopReason,
      })
      hub.broadcast('message.end', {
        topicId,
        messageId: payload.messageId,
        stopReason: payload.stopReason,
      })
      // Derive agent.status idle as a defensive fallback when adapter forgets to push it
      // (e.g. CLI crash / forceEnd / keepalive timeout paths — see AIT-137).
      // Skip 'tool_use' because the agent is still working: a tool.result will follow.
      if (payload.stopReason !== 'tool_use') {
        hub.broadcast('agent.status', { topicId, state: 'idle' })
        // Web Push only for real turn endings — a 'tool_use' stop is just the agent
        // pausing to call a tool (a tool.result + more output follow), so pushing
        // "有新回复" on every tool call spams the user. Final replies / errors push;
        // interaction.request (approvals/choices) pushes separately below.
        if (config) {
          const topic = await topicRepo.getTopic(topicId)
          sendPushToAll(
            { title: 'agent-chat', body: `${topic?.name ?? '话题'} 有新回复`, tag: `msg-${topicId}`, url: `/?topic=${topicId}` },
            config,
          ).catch(() => {})
        }
      }
      break
    }

    case 'tool.call': {
      if (!topicId) return
      if (!(await messageRepo.getMessage(payload.messageId))) break
      await messageRepo.createMessagePart({
        messageId: payload.messageId,
        kind: 'tool_use',
        contentJson: JSON.stringify({
          toolUseId: payload.toolUseId,
          name: payload.name,
          input: payload.input,
        }),
      })
      hub.broadcast('tool.call', {
        topicId,
        toolUseId: payload.toolUseId,
        messageId: payload.messageId,
        name: payload.name,
        input: payload.input,
      })
      break
    }

    case 'tool.result': {
      if (!topicId) return
      if (!(await messageRepo.getMessage(payload.messageId))) break
      await messageRepo.createMessagePart({
        messageId: payload.messageId,
        kind: 'tool_result',
        contentJson: JSON.stringify({
          toolUseId: payload.toolUseId,
          output: payload.output,
          isError: payload.isError,
        }),
      })
      hub.broadcast('tool.result', {
        topicId,
        toolUseId: payload.toolUseId,
        messageId: payload.messageId,
        output: payload.output,
        isError: payload.isError,
      })
      break
    }

    case 'file.diff': {
      if (!topicId) return
      await messageRepo.createMessagePart({
        messageId: payload.messageId,
        kind: 'file_diff',
        contentJson: JSON.stringify({
          path: payload.path,
          before: payload.before,
          after: payload.after,
        }),
      })
      hub.broadcast('file.diff', {
        topicId,
        messageId: payload.messageId,
        path: payload.path,
        before: payload.before,
        after: payload.after,
      })
      break
    }

    case 'todo.update': {
      if (!topicId) return
      hub.broadcast('todo.update', { topicId, items: payload.items })
      break
    }

    case 'plan.update': {
      if (!topicId) return
      hub.broadcast('plan.update', { topicId, plan: payload.plan })
      break
    }

    case 'interaction.request': {
      if (!topicId) return
      const interaction = await interactionRepo.createInteraction({
        topicId,
        messageId: payload.messageId,
        kind: payload.interactionKind,
        prompt: payload.prompt,
        optionsJson: payload.options
          ? JSON.stringify(payload.options)
          : null,
      })
      hub.broadcast('interaction.request', {
        topicId,
        interactionId: interaction.id,
        messageId: payload.messageId,
        interactionKind: payload.interactionKind,
        prompt: payload.prompt,
        options: payload.options,
        defaultTimeoutMs: payload.defaultTimeoutMs,
      })
      if (config) {
        sendPushToAll(
          { title: 'agent-chat · 需要审批', body: payload.prompt.slice(0, 120), tag: `approval-${interaction.id}`, url: `/?topic=${topicId}` },
          config,
        ).catch(() => {})
      }
      break
    }

    case 'agent.status': {
      if (!topicId) return
      if (payload.state === 'idle') {
        clearStreamDisconnectFinalizer(topicId)
      }
      hub.broadcast('agent.status', { topicId, ...mapAgentState(payload.state) })
      break
    }

    case 'agent.progress': {
      if (!topicId) return
      hub.broadcast('agent.progress', {
        topicId,
        phase: payload.phase,
        message: payload.message,
        metadata: payload.metadata,
      })
      break
    }

    case 'cron.created': {
      const originTopicId = payload.originTopicId ?? await findTopicIdBySession(payload.originSessionId)
      if (!originTopicId) {
        logger.warn(
          { originSessionId: payload.originSessionId },
          'Cron created but origin session not found',
        )
        return
      }
      const existing = await cronRepo.getCronJobByPiCronId(payload.cronId)
      if (existing) {
        await cronRepo.updateCronJob(existing.id, {
          status: payload.status,
          cron_expr: payload.cronExpr,
          prompt: payload.prompt,
          next_run_at: payload.nextRunAt,
          tags: payload.tags,
        })
      } else {
        await cronRepo.createCronJob({
          originTopicId,
          piCronId: payload.cronId,
          cronExpr: payload.cronExpr,
          prompt: payload.prompt,
          tags: payload.tags,
          status: payload.status,
          nextRunAt: payload.nextRunAt,
        })
      }
      const job = await cronRepo.getCronJobByPiCronId(payload.cronId)
      if (job) {
        hub.broadcast('cron.upserted', cronJobToPayload(job))
      }
      break
    }

    case 'cron.triggered': {
      const originTopicId = payload.originTopicId ?? await findTopicIdBySession(payload.originSessionId)
      if (!originTopicId) {
        logger.warn(
          { originSessionId: payload.originSessionId },
          'Cron triggered but origin session not found',
        )
        return
      }
      const cronRun = await cronRepo.createCronRunByCronId({
        cronId: payload.cronId,
        runId: payload.runId,
        triggeredAt: payload.firedAt,
      })
      const job = await cronRepo.getCronJobByCronId(payload.cronId)
      if (!cronRun || !job) {
        logger.warn({ cronId: payload.cronId }, 'cron.triggered: cron job not found')
        return
      }
      hub.broadcast('cron.triggered', {
        cronId: payload.cronId,
        localCronId: job.id,
        originTopicId,
        originSessionId: payload.originSessionId,
        runId: payload.runId || cronRun.id,
        firedAt: payload.firedAt,
      })
      break
    }

    case 'usage.delta': {
      await usageRepo.createUsageRecord({
        topicId,
        messageId: payload.messageId,
        model: payload.model,
        inputTokens: payload.inputTokens,
        outputTokens: payload.outputTokens,
      })
      break
    }

    case 'artifact.created': {
      logger.info(
        {
          artifactId: payload.artifactId,
          name: payload.name,
          metadata: payload.metadata,
          sessionId,
          topicId,
        },
        'PI artifact.created payload received',
      )
      if (await artifactRepo.getArtifact(payload.artifactId)) break
      const artifact = await artifactRepo.createArtifact({
        id: payload.artifactId,
        topicId,
        originTopicId: topicId,
        name: payload.name,
        mime: payload.mime,
        sizeBytes: payload.sizeBytes,
        r2Key: payload.r2Key ?? '',
        source: 'generated',
        metadataJson: payload.metadata
          ? JSON.stringify(payload.metadata)
          : undefined,
      })
      hub.broadcast('artifact.added', artifactToPayload(artifact))
      break
    }

    case 'error': {
      if (!topicId) {
        hub.broadcast('error', { code: payload.code, message: payload.message })
        break
      }
      const errorText = `[${payload.code}] ${payload.message}`
      const errMsg = await messageRepo.createMessage({ topicId, role: 'system' })
      await messageRepo.createMessagePart({
        messageId: errMsg.id,
        kind: 'text',
        contentJson: JSON.stringify({ content: errorText }),
      })
      await messageRepo.updateMessage(errMsg.id, {
        status: 'done',
        finished_at: Date.now(),
        stop_reason: 'error',
      })
      hub.broadcast('message.start', { topicId, messageId: errMsg.id, role: 'system' })
      hub.broadcast('message.delta', { topicId, messageId: errMsg.id, part: { kind: 'text', content: errorText } })
      hub.broadcast('message.end', { topicId, messageId: errMsg.id, stopReason: 'error' })
      break
    }

    case 'session.health': {
      if (!topicId) return
      if (payload.state === 'connected') {
        clearStreamDisconnectFinalizer(topicId)
      } else if (payload.state === 'disconnected') {
        const messages = await messageRepo.listMessagesByTopic(topicId)
        if (messages.some((message) => message.status === 'streaming')) {
          startStreamDisconnectFinalizer(topicId, sessionId, hub)
        }
      }
      hub.broadcast('session.health', {
        topicId,
        state: payload.state,
        piSessionId: payload.piSessionId,
        lastError: payload.lastError,
      })
      break
    }

    case 'cron.run.completed': {
      const job = await cronRepo.getCronJobByCronId(payload.cronId)
      if (!job) {
        logger.warn({ cronId: payload.cronId }, 'cron.run.completed: cron job not found')
        return
      }
      const runs = await cronRepo.listCronRuns(job.id)
      const runningRun = runs.find((r) => r.id === payload.runId) ?? runs.find((r) => r.status === 'running')
      if (runningRun) {
        await cronRepo.updateCronRun(runningRun.id, {
          status: payload.status,
          finished_at: payload.completedAt,
        })
      }
      hub.broadcast('cron.run.completed', {
        cronId: payload.cronId,
        localCronId: job.id,
        runId: payload.runId,
        originTopicId: job.origin_topic_id,
        originSessionId: payload.originSessionId,
        status: payload.status,
        summary: payload.summary,
        duration: payload.duration,
        durationMs: payload.durationMs ?? payload.duration,
        completedAt: payload.completedAt,
      })
      if (config) {
        const statusLabel = payload.status === 'success' ? '完成' : '失败'
        sendPushToAll(
          { title: `定时任务${statusLabel}`, body: payload.summary?.slice(0, 120) ?? job.prompt.slice(0, 120), tag: `cron-${payload.cronId}`, url: `/?topic=${job.origin_topic_id}` },
          config,
        ).catch(() => {})
      }
      break
    }

    case 'cron.updated': {
      const existing = await cronRepo.getCronJobByCronId(payload.cronId)
      if (!existing) {
        logger.warn({ cronId: payload.cronId }, 'cron.updated: cron job not found')
        return
      }
      const updated = await cronRepo.updateCronJob(existing.id, {
        status: payload.status,
        ...(payload.cronExpr ? { cron_expr: payload.cronExpr } : {}),
        ...(payload.prompt ? { prompt: payload.prompt } : {}),
        ...(payload.tags !== undefined ? { tags: payload.tags } : {}),
        next_run_at: payload.nextRunAt,
      })
      if (updated) hub.broadcast('cron.upserted', cronJobToPayload(updated))
      break
    }

    case 'cron.deleted': {
      await cronRepo.deleteCronJobByCronId(payload.cronId)
      const jobs = await cronRepo.listCronJobs()
      hub.broadcast('cron.list', { crons: jobs.map((j) => cronJobToPayload(j)) })
      break
    }

    default: {
      logger.warn({ kind: (payload as Record<string, unknown>).kind }, 'Unknown PI event kind')
    }
  }
}
