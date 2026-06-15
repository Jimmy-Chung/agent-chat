import { planTextToItems, type PIEvent } from '@agent-chat/protocol'
import type { PiClient } from './client'
import * as topicRepo from '../db/repos/topic.repo'
import * as messageRepo from '../db/repos/message.repo'
import * as interactionRepo from '../db/repos/interaction.repo'
import * as artifactRepo from '../db/repos/artifact.repo'
import { artifactToPayload } from '../ws/artifact-control'
import * as usageRepo from '../db/repos/usage.repo'
import * as cronRepo from '../db/repos/cron.repo'
import * as pushRepo from '../db/repos/push-subscription.repo'
import * as runtimeEventRepo from '../db/repos/topic_runtime_event.repo'
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

export function toUserFacingAgentErrorMessage(rawMessage: string): string {
  const message = rawMessage.trim()
  const lower = message.toLowerCase()

  if (
    lower.includes('billing') ||
    lower.includes('quota') ||
    lower.includes('insufficient_quota') ||
    lower.includes('credit') ||
    lower.includes('payment required') ||
    lower.includes('402')
  ) {
    return '模型服务额度或账单不可用。请检查当前 Provider 的余额、套餐、额度或账单状态后重试。'
  }

  if (
    lower.includes('no api key') ||
    lower.includes('api key') ||
    lower.includes('/login') ||
    lower.includes('auth.json') ||
    lower.includes('oauth')
  ) {
    return '模型 Provider 未完成认证或当前账号不可用。请在运行 Adapter 的机器上执行 /login，或配置对应 API key，并确认账号未欠费、额度未耗尽。'
  }

  return message
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

function cronCompletionTitle(status: 'success' | 'failed' | 'timeout'): string {
  if (status === 'success') return '定时任务完成'
  if (status === 'timeout') return '定时任务超时'
  return '定时任务失败'
}

function cronCompletionBody(summary: string | null | undefined, prompt: string): string {
  return (summary?.trim() || prompt).slice(0, 120)
}

async function appendCronCompletionMessage(input: {
  topicId: string
  runId: string
  status: 'success' | 'failed' | 'timeout'
  summary: string | null
  prompt: string
  completedAt: number
  hub: EventBroadcaster
}): Promise<string | null> {
  const topic = await topicRepo.getTopic(input.topicId)
  if (!topic || topic.archived) return null

  const title = cronCompletionTitle(input.status)
  const body = cronCompletionBody(input.summary, input.prompt)
  const content = `${title}：${body}`
  const msg = await messageRepo.createMessage({
    topicId: input.topicId,
    role: 'cron',
    status: 'done',
    cronRunId: input.runId,
  })
  await messageRepo.createMessagePart({
    id: messageRepo.getStableTextPartId(msg.id, 'text'),
    messageId: msg.id,
    kind: 'text',
    contentJson: JSON.stringify({ content }),
  })
  await messageRepo.updateMessage(msg.id, {
    status: 'done',
    finished_at: input.completedAt,
    stop_reason: input.status,
  })
  input.hub.broadcast('message.start', {
    topicId: input.topicId,
    messageId: msg.id,
    role: 'cron',
    status: 'done',
  })
  input.hub.broadcast('message.delta', {
    topicId: input.topicId,
    messageId: msg.id,
    partId: messageRepo.getStableTextPartId(msg.id, 'text'),
    part: { kind: 'text', content },
  })
  input.hub.broadcast('message.end', {
    topicId: input.topicId,
    messageId: msg.id,
    stopReason: 'end_turn',
  })
  return msg.id
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
// Serialize routed events per session once they have been put back into seq order.
const sessionQueues = new Map<string, Promise<void>>()
const sessionReorderBuffers = new Map<string, SessionReorderBuffer>()
let piEventReorderWindowMs = 150

interface SessionReorderBuffer {
  pending: Map<number, PIEvent>
  nextSeq: number | null
  timer: ReturnType<typeof setTimeout> | null
}

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
const streamDisconnectFinalizePromisesByTopic = new Map<string, Promise<void>>()

export const DEFAULT_STREAM_DISCONNECT_FINALIZE_TIMEOUT_MS = 90_000
let streamDisconnectFinalizeTimeoutOverrideMs: number | null = null

export function setStreamDisconnectFinalizeTimeoutForTests(timeoutMs: number | null): void {
  streamDisconnectFinalizeTimeoutOverrideMs = timeoutMs
}

export function setPiEventReorderWindowForTests(ms: number): void {
  piEventReorderWindowMs = ms
}

function resolveStreamDisconnectFinalizeTimeout(): number {
  if (streamDisconnectFinalizeTimeoutOverrideMs !== null) return streamDisconnectFinalizeTimeoutOverrideMs
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
    const promise = finalizeStreamingMessagesAfterDisconnect(topicId, sessionId, broadcaster, timeoutMs)
      .catch((err) => {
        logger.error({ err, topicId, sessionId }, 'Failed to finalize streaming messages after PI disconnect')
      })
      .finally(() => {
        streamDisconnectFinalizePromisesByTopic.delete(topicId)
      })
    streamDisconnectFinalizePromisesByTopic.set(topicId, promise)
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

export async function waitForStreamDisconnectFinalizer(topicId: string): Promise<void> {
  await streamDisconnectFinalizePromisesByTopic.get(topicId)
}

export async function finalizeStreamingMessagesAfterDisconnectForTests(
  topicId: string,
  sessionId: string,
  broadcaster: EventBroadcaster,
): Promise<void> {
  await finalizeStreamingMessagesAfterDisconnect(
    topicId,
    sessionId,
    broadcaster,
    streamDisconnectFinalizeTimeoutOverrideMs ?? DEFAULT_STREAM_DISCONNECT_FINALIZE_TIMEOUT_MS,
  )
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

async function finalizeStreamingMessagesOnIdle(
  topicId: string,
  sessionId: string,
  broadcaster: EventBroadcaster,
): Promise<void> {
  try {
    await messageRepo.flushParts()
  } catch (err) {
    logger.warn({ err, topicId, sessionId }, 'Failed to flush pending parts before idle finalize')
  }

  const messages = await messageRepo.listMessagesByTopic(topicId)
  const streamingMessages = messages.filter((message) => message.status === 'streaming')
  if (streamingMessages.length === 0) return

  const now = Date.now()
  logger.warn(
    { topicId, sessionId, messageIds: streamingMessages.map((message) => message.id) },
    'Finalizing leftover streaming messages after agent.status idle',
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
}

export function routePiEvents(
  pi: PiClient,
  broadcaster: EventBroadcaster,
  config?: AppConfig,
  options?: { waitUntil?: (promise: Promise<unknown>) => void },
): void {
  pi.on('session.recreated', ({ sessionId }: { sessionId: string }) => {
    seenSeqBySession.delete(sessionId)
    const buffer = sessionReorderBuffers.get(sessionId)
    if (buffer?.timer) clearTimeout(buffer.timer)
    sessionReorderBuffers.delete(sessionId)
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

    if (isHealth) {
      enqueueRouteEvent(pi, event, broadcaster, config, options)
      return
    }

    enqueueReorderedEvent(pi, event, broadcaster, config, options)
  })
}

function enqueueRouteEvent(
  pi: PiClient,
  event: PIEvent,
  broadcaster: EventBroadcaster,
  config?: AppConfig,
  options?: { waitUntil?: (promise: Promise<unknown>) => void },
): void {
  const prev = sessionQueues.get(event.sessionId) ?? Promise.resolve()
  const next = prev
    .then(async () => {
      await routeEvent(event, broadcaster, config)
      if (event.seq > 0 && event.payload.kind !== 'session.health') {
        pi.markSeqRouted(event.sessionId, event.seq)
      }
    })
    .catch((err) => {
      logger.error({ err, kind: event.payload.kind }, 'Error routing PI event')
    })
  sessionQueues.set(event.sessionId, next)
  options?.waitUntil?.(next)
}

function enqueueReorderedEvent(
  pi: PiClient,
  event: PIEvent,
  broadcaster: EventBroadcaster,
  config?: AppConfig,
  options?: { waitUntil?: (promise: Promise<unknown>) => void },
): void {
  let buffer = sessionReorderBuffers.get(event.sessionId)
  if (!buffer) {
    buffer = {
      pending: new Map<number, PIEvent>(),
      nextSeq: event.seq === 1 || event.payload.kind === 'message.start' ? event.seq : null,
      timer: null,
    }
    sessionReorderBuffers.set(event.sessionId, buffer)
  }

  buffer.pending.set(event.seq, event)
  drainReorderBuffer(pi, event.sessionId, broadcaster, config, options)
}

function drainReorderBuffer(
  pi: PiClient,
  sessionId: string,
  broadcaster: EventBroadcaster,
  config?: AppConfig,
  options?: { waitUntil?: (promise: Promise<unknown>) => void },
): void {
  const buffer = sessionReorderBuffers.get(sessionId)
  if (!buffer) return

  if (buffer.timer) {
    clearTimeout(buffer.timer)
    buffer.timer = null
  }

  if (buffer.nextSeq === null) {
    const minSeq = minPendingSeq(buffer)
    if (minSeq === null) return
    if (minSeq !== 1) {
      scheduleReorderGapFlush(pi, sessionId, broadcaster, config, options)
      return
    }
    buffer.nextSeq = minSeq
  }

  while (buffer.nextSeq !== null) {
    const next = buffer.pending.get(buffer.nextSeq)
    if (!next) break
    buffer.pending.delete(buffer.nextSeq)
    enqueueRouteEvent(pi, next, broadcaster, config, options)
    buffer.nextSeq += 1
  }

  if (buffer.pending.size === 0) return
  scheduleReorderGapFlush(pi, sessionId, broadcaster, config, options)
}

function scheduleReorderGapFlush(
  pi: PiClient,
  sessionId: string,
  broadcaster: EventBroadcaster,
  config?: AppConfig,
  options?: { waitUntil?: (promise: Promise<unknown>) => void },
): void {
  const buffer = sessionReorderBuffers.get(sessionId)
  if (!buffer || buffer.timer) return

  buffer.timer = setTimeout(() => {
    const current = sessionReorderBuffers.get(sessionId)
    if (!current) return
    current.timer = null

    const minSeq = minPendingSeq(current)
    if (minSeq === null) return
    if (current.nextSeq === null || minSeq !== current.nextSeq) {
      logger.warn(
        { sessionId, expectedSeq: current.nextSeq, nextAvailableSeq: minSeq },
        'PI event seq gap timed out; routing next available event',
      )
      current.nextSeq = minSeq
    }
    drainReorderBuffer(pi, sessionId, broadcaster, config, options)
  }, piEventReorderWindowMs)
}

function minPendingSeq(buffer: SessionReorderBuffer): number | null {
  let min: number | null = null
  for (const seq of buffer.pending.keys()) {
    if (min === null || seq < min) min = seq
  }
  return min
}

async function findTopicIdBySession(sessionId: string): Promise<string | null> {
  const topics = await topicRepo.listTopics()
  const match = topics.find((t) => t.pi_session_id === sessionId)
  return match?.id ?? null
}

function cronJobToPayload(job: {
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
      const partId = kind === 'text'
        ? messageRepo.getStableTextPartId(payload.messageId, 'text')
        : kind === 'thinking'
          ? messageRepo.getStableTextPartId(payload.messageId, 'thinking')
          : messageRepo.getStableToolPartId(payload.messageId, 'tool_use', payload.part.toolUseId)
      messageRepo.bufferPartDelta(
        payload.messageId,
        kind === 'text'
          ? 'text'
          : kind === 'thinking'
            ? 'thinking'
            : 'tool_use',
        JSON.stringify(payload.part),
        partId,
      )
      hub.broadcast('message.delta', {
        topicId,
        messageId: payload.messageId,
        partId,
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
        const errorText = toUserFacingAgentErrorMessage(payload.errorMessage)
        const errorPart = await messageRepo.createMessagePart({
          id: messageRepo.getStableTextPartId(payload.messageId, 'text'),
          messageId: payload.messageId,
          kind: 'text',
          contentJson: JSON.stringify({ content: errorText }),
        })
        hub.broadcast('message.delta', {
          topicId,
          messageId: payload.messageId,
          partId: errorPart.id,
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
      const part = await messageRepo.createMessagePart({
        id: messageRepo.getStableToolPartId(payload.messageId, 'tool_use', payload.toolUseId),
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
        partId: part.id,
        name: payload.name,
        input: payload.input,
      })
      break
    }

    case 'tool.result': {
      if (!topicId) return
      if (!(await messageRepo.getMessage(payload.messageId))) break
      const part = await messageRepo.createMessagePart({
        id: messageRepo.getStableToolPartId(payload.messageId, 'tool_result', payload.toolUseId),
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
        partId: part.id,
        output: payload.output,
        isError: payload.isError,
      })
      break
    }

    case 'file.diff': {
      if (!topicId) return
      const part = await messageRepo.createMessagePart({
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
        partId: part.id,
        path: payload.path,
        before: payload.before,
        after: payload.after,
      })
      break
    }

    case 'todo.update': {
      if (!topicId) return
      const runtimePayload = payload as typeof payload & { messageId?: unknown }
      await runtimeEventRepo.createTopicRuntimeEvent({
        topicId,
        kind: 'todo',
        messageId: typeof runtimePayload.messageId === 'string' ? runtimePayload.messageId : null,
        payload: { input: { todos: Array.isArray(payload.items) ? payload.items : [] } },
      })
      hub.broadcast('todo.update', { topicId, items: payload.items })
      break
    }

    case 'plan.update': {
      if (!topicId) return
      const runtimePayload = payload as typeof payload & { messageId?: unknown }
      const plan = typeof payload.plan === 'string' ? payload.plan : ''
      await runtimeEventRepo.createTopicRuntimeEvent({
        topicId,
        kind: 'plan',
        messageId: typeof runtimePayload.messageId === 'string' ? runtimePayload.messageId : null,
        payload: { text: plan, items: planTextToItems(plan) },
      })
      hub.broadcast('plan.update', { topicId, plan: payload.plan })
      break
    }

    case 'interaction.request': {
      if (!topicId) return
      const interaction = await interactionRepo.createInteraction({
        id: payload.interactionId,
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
        await finalizeStreamingMessagesOnIdle(topicId, sessionId, hub)
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
      const originTopicId = payload.originTopicId ?? await findTopicIdBySession(payload.originSessionId) ?? null
      if (!originTopicId) {
        logger.warn(
          { originSessionId: payload.originSessionId },
          'Cron created without origin topic',
        )
      }
      const existing = await cronRepo.getCronJobByPiCronId(payload.cronId)
      if (existing) {
        await cronRepo.updateCronJob(existing.id, {
          ...(originTopicId && existing.origin_topic_id !== originTopicId
            ? { origin_topic_id: originTopicId }
            : {}),
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
      // AIT-194 — resolve originTopicId from payload, session, or cron job DB record.
      let originTopicId =
        payload.originTopicId ?? (await findTopicIdBySession(payload.originSessionId))

      // Always record the run and look up the job, even if topic is gone.
      const cronRun = await cronRepo.createCronRunByCronId({
        cronId: payload.cronId,
        runId: payload.runId,
        triggeredAt: payload.firedAt,
      })
      const job = await cronRepo.getCronJobByCronId(payload.cronId)

      // If still no originTopicId, fall back to the cron job's origin_topic_id.
      if (!originTopicId && job?.origin_topic_id) {
        originTopicId = job.origin_topic_id
      }

      // Check whether the origin topic still exists and is active.
      let originTopicActive = false
      if (originTopicId) {
        const topic = await topicRepo.getTopic(originTopicId)
        originTopicActive = !!(topic && !topic.archived)
      }

      if (cronRun && job) {
        hub.broadcast('cron.triggered', {
          cronId: payload.cronId,
          localCronId: job.id,
          originTopicId,
          originSessionId: payload.originSessionId,
          runId: payload.runId || cronRun.id,
          firedAt: payload.firedAt,
          originTopicActive,
        })
      } else {
        logger.warn({ cronId: payload.cronId }, 'cron.triggered: cron job or run not found')
      }

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
      const existing = await artifactRepo.getArtifact(payload.artifactId)
      if (existing) {
        // Monotonic guard: PI `seq` is monotonic within a session. The
        // dedup/reorder state in routePiEvents lives only in DO memory and is
        // reset on reconnect, so a replayed older artifact.created can be
        // re-routed after a newer one and clobber the row (observed: row stuck
        // at an earlier version than both later events and the R2 content).
        // Reject events that are not strictly newer than the stored cursor for
        // the same session; a different session is always a later edit and wins.
        const cursor = await artifactRepo.getArtifactEventCursor(payload.artifactId)
        const isStaleReplay =
          cursor?.lastEventSession === sessionId &&
          cursor?.lastEventSeq != null &&
          event.seq <= cursor.lastEventSeq
        if (isStaleReplay) {
          logger.info(
            { artifactId: payload.artifactId, sessionId, seq: event.seq, cursorSeq: cursor?.lastEventSeq },
            'artifact.created ignored: stale/replayed event behind cursor',
          )
          break
        }

        const nextMime = payload.mime ?? existing.mime
        const nextSizeBytes = payload.sizeBytes ?? existing.size_bytes
        const nextMetadataJson = payload.metadata
          ? JSON.stringify(payload.metadata)
          : existing.metadata_json
        const shouldUpdate =
          (payload.r2Key && payload.r2Key !== existing.r2_key) ||
          payload.name !== existing.name ||
          nextMime !== existing.mime ||
          nextSizeBytes !== existing.size_bytes ||
          nextMetadataJson !== existing.metadata_json

        if (shouldUpdate) {
          const artifact = await artifactRepo.updateArtifact(payload.artifactId, {
            topicId: existing.topic_id ?? topicId,
            originTopicId: existing.origin_topic_id ?? topicId,
            name: payload.name,
            mime: nextMime,
            sizeBytes: nextSizeBytes,
            r2Key: payload.r2Key ?? existing.r2_key,
            source: 'generated',
            uploadStatus: payload.r2Key ? 'uploaded' : existing.upload_status,
            failureCode: payload.r2Key ? null : existing.failure_code,
            failureMessage: payload.r2Key ? null : existing.failure_message,
            metadataJson: nextMetadataJson,
            lastEventSeq: event.seq,
            lastEventSession: sessionId,
          }) ?? existing
          hub.broadcast('artifact.added', artifactToPayload(artifact))
        } else {
          // Content unchanged but advance the cursor so a later replay of this
          // same seq stays cheap and the guard reflects the newest seen event.
          await artifactRepo.updateArtifact(payload.artifactId, {
            lastEventSeq: event.seq,
            lastEventSession: sessionId,
          })
        }
        break
      }
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
        lastEventSeq: event.seq,
        lastEventSession: sessionId,
      })
      hub.broadcast('artifact.added', artifactToPayload(artifact))
      break
    }

    case 'error': {
      if (!topicId) {
        hub.broadcast('error', { code: payload.code, message: toUserFacingAgentErrorMessage(payload.message) })
        break
      }
      const errorText = `[${payload.code}] ${toUserFacingAgentErrorMessage(payload.message)}`
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
      const originTopic = job.origin_topic_id ? await topicRepo.getTopic(job.origin_topic_id) : undefined
      const originTopicAvailable = Boolean(originTopic && !originTopic.archived)
      const runs = await cronRepo.listCronRuns(job.id)
      const runningRun = runs.find((r) => r.id === payload.runId) ?? runs.find((r) => r.status === 'running')
      const existingRun = runs.find((r) => r.id === payload.runId)
      let resultMessageId: string | null = null
      if (job.origin_topic_id) {
        resultMessageId = await appendCronCompletionMessage({
          topicId: job.origin_topic_id,
          runId: payload.runId,
          status: payload.status,
          summary: payload.summary,
          prompt: job.prompt,
          completedAt: payload.completedAt,
          hub,
        })
      }
      if (runningRun) {
        await cronRepo.updateCronRun(runningRun.id, {
          status: payload.status,
          finished_at: payload.completedAt,
          summary: payload.summary,
          duration_ms: payload.durationMs ?? payload.duration ?? null,
          ...(resultMessageId ? { result_message_id: resultMessageId } : {}),
        })
      } else if (!existingRun) {
        const createdRun = await cronRepo.createCronRun({
          cronId: job.id,
          runId: payload.runId,
          triggeredAt: payload.completedAt,
        })
        await cronRepo.updateCronRun(createdRun.id, {
          status: payload.status,
          finished_at: payload.completedAt,
          summary: payload.summary,
          duration_ms: payload.durationMs ?? payload.duration ?? null,
          ...(resultMessageId ? { result_message_id: resultMessageId } : {}),
        })
      }
      hub.broadcast('cron.run.completed', {
        cronId: payload.cronId,
        localCronId: job.id,
        runId: payload.runId,
        originTopicId: job.origin_topic_id,
        originTopicAvailable,
        originSessionId: payload.originSessionId,
        status: payload.status,
        summary: payload.summary,
        duration: payload.duration,
        durationMs: payload.durationMs ?? payload.duration,
        completedAt: payload.completedAt,
      })
      if (config) {
        sendPushToAll(
          {
            title: cronCompletionTitle(payload.status),
            body: cronCompletionBody(payload.summary, job.prompt),
            tag: `cron-${payload.cronId}`,
            url: originTopicAvailable && job.origin_topic_id ? `/?topic=${job.origin_topic_id}` : '/',
          },
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
