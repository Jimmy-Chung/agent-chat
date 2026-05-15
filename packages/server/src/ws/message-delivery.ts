import type { ArtifactRef, Message, PIEvent, Topic } from '@agent-chat/protocol'
import type { PiClient } from '../pi/client'
import * as messageRepo from '../db/repos/message.repo'
import * as topicRepo from '../db/repos/topic.repo'
import * as artifactRepo from '../db/repos/artifact.repo'
import { logger } from '../logger'
import {
  ARTIFACT_URL_TTL_MS,
  buildArtifactAccessUrl,
  createArtifactTokenWithSecret,
} from '../r2/artifact-access'

export interface MessageDeliveryBroadcaster {
  broadcast(type: string, data: unknown): void
}

export const AUTO_RETRY_DELAY_MS = 5000

// Overridable in tests to skip the minimum wait without fake timers
export let _minRetryWaitMs = AUTO_RETRY_DELAY_MS
export function _setMinRetryWaitForTest(ms: number): void {
  _minRetryWaitMs = ms
}
const AUTO_RETRY_ATTEMPTS = 2
const restorePromisesBySession = new Map<string, Promise<boolean>>()

interface DeliverUserMessageInput {
  topicId: string
  messageId: string
  content: string
  mentions?: ArtifactRef[]
  pi: PiClient
  broadcaster: MessageDeliveryBroadcaster
  artifactAccess?: {
    baseUrl: string
    tokenSecret: string
  }
  manual: boolean
}

interface CreateUserMessageInput {
  topicId: string
  content: string
  mentions?: ArtifactRef[]
  clientMessageId?: string
  broadcaster: MessageDeliveryBroadcaster
}

export async function createPendingUserMessage(input: CreateUserMessageInput): Promise<Message> {
  const clientMessageId = input.clientMessageId ?? `cm-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const msg = await messageRepo.createMessage({
    topicId: input.topicId,
    role: 'user',
    status: 'pending',
    clientMessageId,
    maxRetries: 2,
  })

  await messageRepo.createMessagePart({
    messageId: msg.id,
    kind: 'text',
    contentJson: JSON.stringify({ content: input.content }),
  })
  await messageRepo.indexMessageForSearch(msg.id, input.topicId, input.content)

  input.broadcaster.broadcast('message.start', {
    topicId: input.topicId,
    messageId: msg.id,
    role: 'user',
    status: 'pending',
    clientMessageId,
    retryCount: 0,
    maxRetries: 2,
  })
  input.broadcaster.broadcast('message.delta', {
    topicId: input.topicId,
    messageId: msg.id,
    part: { kind: 'text', content: input.content },
  })
  broadcastDelivery(input.broadcaster, input.topicId, msg.id, 'pending', 0, 2)

  return msg
}

export function startAutoDelivery(input: DeliverUserMessageInput): Promise<'delivered' | 'retryable' | 'reverted'> {
  return deliverUserMessage({ ...input, manual: false })
}

export async function deliverUserMessage(input: DeliverUserMessageInput): Promise<'delivered' | 'retryable' | 'reverted'> {
  const msg = await messageRepo.getMessage(input.messageId)
  if (!msg) return 'reverted'
  if (msg.status === 'done') return 'delivered'

  if (input.manual) {
    const nextRetryCount = msg.retry_count + 1
    await messageRepo.updateMessage(msg.id, {
      status: 'retrying',
      retry_count: nextRetryCount,
    })
    broadcastDelivery(input.broadcaster, input.topicId, msg.id, 'retrying', nextRetryCount, msg.max_retries)
    const delivered = await attemptDelivery(input, msg, {
      retryCount: nextRetryCount,
      forceSessionRecovery: true,
      allowRecreate: true,
    })
    if (delivered) return 'delivered'
    return handleRetryFailure(input, msg, nextRetryCount)
  }

  const deliveryStart = Date.now()

  if (await attemptDelivery(input, msg, { retryCount: msg.retry_count, forceSessionRecovery: false })) {
    return 'delivered'
  }

  // Guarantee at least _minRetryWaitMs from initial send before auto-retry loop.
  // Without this guard, if session setup fails instantly (PI not reachable), the loop
  // runs with no delay, violating the 5-second response window defined in FEAT-029.
  const elapsed = Date.now() - deliveryStart
  if (elapsed < _minRetryWaitMs) {
    await new Promise<void>((resolve) => setTimeout(resolve, _minRetryWaitMs - elapsed))
  }

  for (let attempt = 1; attempt <= AUTO_RETRY_ATTEMPTS; attempt += 1) {
    await messageRepo.updateMessage(msg.id, { status: 'retrying' })
    broadcastDelivery(input.broadcaster, input.topicId, msg.id, 'retrying', msg.retry_count, msg.max_retries)
    // Auto-retry: reconnect only, never recreate (preserves active session)
    if (await attemptDelivery(input, msg, { retryCount: msg.retry_count, forceSessionRecovery: false, allowRecreate: false })) {
      return 'delivered'
    }
  }

  return handleRetryFailure(input, msg, msg.retry_count)
}

export async function restoreExistingTopicSession(
  topicId: string,
  pi: PiClient,
): Promise<boolean> {
  const topic = await topicRepo.getTopic(topicId)
  if (!topic?.pi_session_id) return false
  return enterTopicSession(topic, pi)
}

export async function enterTopicSession(topic: Topic, pi: PiClient): Promise<boolean> {
  if (!topic.pi_session_id) return false
  const sessionId = topic.pi_session_id
  const existing = restorePromisesBySession.get(sessionId)
  if (existing) return existing

  const promise = (async () => {
    try {
      try {
        await pi.reconnectSession(sessionId)
        return true
      } catch (err) {
        logger.warn({ err, topicId: topic.id, sessionId }, 'attach failed while entering topic session')
      }

      try {
        await pi.recreateSession({ ...buildSessionParams(topic), sessionId })
        return true
      } catch (err) {
        logger.warn({ err, topicId: topic.id, sessionId }, 'recreate failed while entering topic session')
        return false
      }
    } finally {
      restorePromisesBySession.delete(sessionId)
    }
  })()

  restorePromisesBySession.set(sessionId, promise)
  return promise
}

async function attemptDelivery(
  input: DeliverUserMessageInput,
  msg: Message,
  options: { retryCount: number; forceSessionRecovery: boolean; allowRecreate?: boolean },
): Promise<boolean> {
  const topic = await topicRepo.getTopic(input.topicId)
  const sessionId = await ensureDeliverableSession(topic, input.pi, {
    allowCreate: true,
    forceResume: options.forceSessionRecovery,
    allowRecreate: options.allowRecreate ?? true,
  })
  if (!topic || !sessionId) return false

  const responseWaiter = waitForDeliveryResponse(input.pi, sessionId, AUTO_RETRY_DELAY_MS)
  try {
    const mentionedArtifacts = await buildMentionedArtifactRefs(input)
    await withTimeout(
      input.pi.rpc('sendUserMessage', {
        sessionId,
        clientMessageId: msg.client_message_id ?? msg.id,
        content: input.content,
        mentionedArtifacts,
        streamingBehavior: 'followUp',
      }),
      AUTO_RETRY_DELAY_MS,
      'sendUserMessage no response',
    )
    await responseWaiter.promise
    await messageRepo.updateMessage(msg.id, {
      status: 'done',
      finished_at: Date.now(),
      stop_reason: 'end_turn',
      retry_count: options.retryCount,
    })
    input.broadcaster.broadcast('message.end', {
      topicId: input.topicId,
      messageId: msg.id,
      stopReason: 'end_turn',
    })
    broadcastDelivery(input.broadcaster, input.topicId, msg.id, 'done', options.retryCount, msg.max_retries)
    return true
  } catch (err) {
    responseWaiter.cancel()
    logger.warn(
      {
        err,
        topicId: input.topicId,
        messageId: msg.id,
        manual: input.manual,
        retryCount: options.retryCount,
        forceSessionRecovery: options.forceSessionRecovery,
      },
      'sendUserMessage delivery attempt failed',
    )
    return false
  }
}

async function buildMentionedArtifactRefs(input: DeliverUserMessageInput): Promise<Array<{ id: string; name: string; downloadUrl: string }> | undefined> {
  if (!input.mentions?.length) return undefined
  const refs: Array<{ id: string; name: string; downloadUrl: string }> = []
  for (const mention of input.mentions) {
    if (mention.downloadUrl) {
      refs.push({ id: mention.id, name: mention.name, downloadUrl: mention.downloadUrl })
      continue
    }
    const artifact = await artifactRepo.getArtifact(mention.id)
    if (!artifact?.r2_key || !input.artifactAccess) {
      refs.push({ id: mention.id, name: mention.name, downloadUrl: '' })
      continue
    }
    const token = await createArtifactTokenWithSecret(input.artifactAccess.tokenSecret, {
      action: 'download',
      key: artifact.r2_key,
      expiresAt: Date.now() + ARTIFACT_URL_TTL_MS,
    })
    refs.push({
      id: mention.id,
      name: mention.name,
      downloadUrl: buildArtifactAccessUrl(input.artifactAccess.baseUrl, 'download', artifact.r2_key, token, artifact.name),
    })
  }
  return refs
}

function waitForDeliveryResponse(
  pi: PiClient,
  sessionId: string,
  timeoutMs: number,
): { promise: Promise<void>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let settled = false
  let onEvent: ((event: PIEvent) => void) | null = null

  const cleanup = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (onEvent && typeof (pi as { off?: unknown }).off === 'function') {
      ;(pi as { off: (event: string, listener: (event: PIEvent) => void) => void }).off('event', onEvent)
      onEvent = null
    }
  }

  const promise = new Promise<void>((resolve, reject) => {
    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (err) reject(err)
      else resolve()
    }

    onEvent = (event: PIEvent) => {
      if (event.sessionId !== sessionId) return
      const kind = event.payload.kind

      if (kind === 'error') {
        if (isAlreadyProcessingFollowUpNotice(event.payload.message)) return
        finish(new Error(`PI event error: ${event.payload.code} - ${event.payload.message}`))
        return
      }
      if (kind === 'usage.delta') return
      if (kind === 'session.health' && event.payload.state === 'disconnected') {
        finish(new Error(`PI session disconnected: ${event.payload.lastError ?? sessionId}`))
        return
      }
      finish()
    }

    pi.on('event', onEvent)
    timer = setTimeout(() => finish(new Error('sendUserMessage no agent event')), timeoutMs)
  })

  return {
    promise,
    cancel: cleanup,
  }
}

function isAlreadyProcessingFollowUpNotice(message: string): boolean {
  return message.includes('already processing') && message.includes('followUp')
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  promise.catch(() => undefined)
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function ensureDeliverableSession(
  topic: Topic | undefined,
  pi: PiClient,
  options: { allowCreate: boolean; forceResume: boolean; allowRecreate: boolean },
): Promise<string | null> {
  if (!topic) return null
  if (topic.pi_session_id) {
    const inFlight = restorePromisesBySession.get(topic.pi_session_id)
    if (inFlight && await inFlight) {
      return topic.pi_session_id
    }
    const restored = await restoreSession(topic, pi, {
      allowCreate: false,
      forceResume: options.forceResume,
      allowRecreate: options.allowRecreate,
    })
    if (restored) return topic.pi_session_id
  }
  if (!options.allowCreate) return null

  // Only create a brand-new session when the topic has never had one.
  // If restore failed for an existing session, return null (show retry UI)
  // rather than clobbering the active session with a new one.
  if (topic.pi_session_id) return null

  try {
    const result = await pi.createSession(buildSessionParams(topic))
    const sessionId = result.sessionId
    await topicRepo.updateTopic(topic.id, { pi_session_id: sessionId })
    return sessionId
  } catch (err) {
    logger.warn({ err, topicId: topic.id }, 'create failed before message delivery')
    return null
  }
}

async function restoreSession(
  topic: Topic,
  pi: PiClient,
  options: { allowCreate: boolean; forceResume: boolean; allowRecreate: boolean },
): Promise<string | null> {
  if (!topic.pi_session_id) return null
  if (pi.hasSession(topic.pi_session_id) && !options.forceResume) return topic.pi_session_id

  if (options.forceResume && pi.hasSession(topic.pi_session_id)) {
    pi.disconnectSession(topic.pi_session_id)
  }

  try {
    await pi.reconnectSession(topic.pi_session_id)
    return topic.pi_session_id
  } catch (err) {
    logger.warn({ err, topicId: topic.id, sessionId: topic.pi_session_id }, 'resume failed before message delivery')
  }

  // recreateSession only on manual retry — auto-retry preserves the active session
  if (!options.allowRecreate) return null

  try {
    await pi.recreateSession({ ...buildSessionParams(topic), sessionId: topic.pi_session_id })
    return topic.pi_session_id
  } catch (err) {
    logger.warn({ err, topicId: topic.id, sessionId: topic.pi_session_id }, 'recreate failed before message delivery')
    return null
  }
}

function buildSessionParams(topic: Topic): Parameters<PiClient['createSession']>[0] {
  return {
    kind: topic.agent_type,
    topicId: topic.id,
    programming: topic.programming_spec_json ? JSON.parse(topic.programming_spec_json) : undefined,
    general: topic.general_spec_json ? JSON.parse(topic.general_spec_json) : undefined,
    initialModel: topic.current_model ?? undefined,
  } as Parameters<PiClient['createSession']>[0]
}

async function handleRetryFailure(
  input: DeliverUserMessageInput,
  msg: Message,
  retryCount: number,
): Promise<'retryable' | 'reverted'> {
  if (input.manual && retryCount >= msg.max_retries) {
    await messageRepo.deleteMessage(msg.id)
    input.broadcaster.broadcast('message.delivery', {
      topicId: input.topicId,
      messageId: msg.id,
      status: 'error',
      retryCount,
      maxRetries: msg.max_retries,
    })
    return 'reverted'
  }

  await messageRepo.updateMessage(msg.id, {
    status: 'needs_retry',
    retry_count: retryCount,
  })
  broadcastDelivery(input.broadcaster, input.topicId, msg.id, 'needs_retry', retryCount, msg.max_retries)
  return 'retryable'
}

function broadcastDelivery(
  broadcaster: MessageDeliveryBroadcaster,
  topicId: string,
  messageId: string,
  status: 'pending' | 'needs_retry' | 'retrying' | 'done' | 'error',
  retryCount: number,
  maxRetries: number,
): void {
  broadcaster.broadcast('message.delivery', {
    topicId,
    messageId,
    status,
    retryCount,
    maxRetries,
  })
}
