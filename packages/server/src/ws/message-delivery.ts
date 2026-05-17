import type { ArtifactRef, Message, Topic } from '@agent-chat/protocol'
import type { PiClient } from '../pi/client'
import { PiRpcError } from '../pi/client'
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

// How long to wait for the sendUserMessage RPC to be acknowledged by the adapter.
// This is purely network + adapter scheduling latency, not LLM processing time.
export const RPC_TIMEOUT_MS = 8000

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

// Fire-and-forget wrapper used by the WebSocket handler.
export function startAutoDelivery(input: DeliverUserMessageInput): Promise<'delivered' | 'retryable' | 'reverted'> {
  return deliverUserMessage({ ...input, manual: false })
}

// ─── Core delivery ────────────────────────────────────────────────────────────
//
// Mental model:
//   Session is guaranteed by the gateway (topic.create / topic.select).
//   Delivery only needs to handle: send RPC → reconnect on failure → retry once.
//   All fail → needs_retry button shown to user.

export async function deliverUserMessage(
  input: DeliverUserMessageInput,
): Promise<'delivered' | 'retryable' | 'reverted'> {
  const msg = await messageRepo.getMessage(input.messageId)
  if (!msg) {
    broadcastDelivery(input.broadcaster, input.topicId, input.messageId, 'error', 0, 0)
    return 'reverted'
  }
  if (msg.status === 'done') return 'delivered'

  const retryCount = input.manual ? msg.retry_count + 1 : msg.retry_count

  if (input.manual) {
    await messageRepo.updateMessage(msg.id, { status: 'retrying', retry_count: retryCount })
    broadcastDelivery(input.broadcaster, input.topicId, msg.id, 'retrying', retryCount, msg.max_retries)
  }

  // First attempt with existing session
  if (await attemptDelivery(input, msg, { retryCount })) return 'delivered'

  // Reconnect session (re-sends attachSession to PI) and try once more.
  const freshTopic = await topicRepo.getTopic(input.topicId)
  if (freshTopic?.pi_session_id) {
    try {
      await input.pi.reconnectSession(freshTopic.pi_session_id)
    } catch { /* reconnect failed — proceed to retry attempt */ }
    if (await attemptDelivery(input, msg, { retryCount })) return 'delivered'
  }

  return handleRetryFailure(input, msg, retryCount)
}

// ─── Session restoration helpers (used by topic.resume) ───────────────────────

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
  try {
    await pi.reconnectSession(topic.pi_session_id)
    return true
  } catch (err) {
    logger.warn({ err, topicId: topic.id, sessionId: topic.pi_session_id }, 'reconnect failed in enterTopicSession')
  }
  try {
    await pi.recreateSession({ ...buildSessionParams(topic), sessionId: topic.pi_session_id })
    return true
  } catch (err) {
    // session_exists means the session was actually created by the failed reconnect attempt
    const code = (err as { code?: string })?.code
    if (code === 'session_exists') {
      logger.info({ topicId: topic.id, sessionId: topic.pi_session_id }, 'session_exists, retrying reconnect')
      try {
        await pi.reconnectSession(topic.pi_session_id)
        return true
      } catch (retryErr) {
        logger.warn({ err: retryErr, topicId: topic.id }, 'reconnect after session_exists also failed')
        return false
      }
    }
    logger.warn({ err, topicId: topic.id, sessionId: topic.pi_session_id }, 'recreate failed in enterTopicSession')
    return false
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function attemptDelivery(
  input: DeliverUserMessageInput,
  msg: Message,
  options: { retryCount: number },
): Promise<boolean> {
  const topic = await topicRepo.getTopic(input.topicId)
  const sessionId = await ensureDeliverableSession(topic, input.pi)
  if (!topic || !sessionId) {
    logger.warn({ topicId: input.topicId }, 'no deliverable session')
    return false
  }

  try {
    const mentionedArtifacts = await buildMentionedArtifactRefs(input)

    // session_busy: exponential backoff retry (1s → 2s → 4s, max 3 attempts)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const abortController = new AbortController()
        await withTimeout(
          input.pi.rpc('sendUserMessage', {
            sessionId,
            clientMessageId: msg.client_message_id ?? msg.id,
            content: input.content,
            mentionedArtifacts,
            streamingBehavior: 'followUp',
          }, { signal: abortController.signal }),
          RPC_TIMEOUT_MS,
          'sendUserMessage RPC timeout',
          () => abortController.abort(),
        )
        // RPC acknowledged by adapter — delivery confirmed.
        await messageRepo.updateMessage(msg.id, {
          status: 'done',
          finished_at: Date.now(),
          stop_reason: 'end_turn',
          retry_count: options.retryCount,
        })
        broadcastDelivery(input.broadcaster, input.topicId, msg.id, 'done', options.retryCount, msg.max_retries)
        return true
      } catch (rpcErr) {
        if (rpcErr instanceof PiRpcError && rpcErr.code === 'session_busy' && attempt < 2) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 4000)
          logger.info({ topicId: input.topicId, attempt, delay }, 'session_busy, retrying with backoff')
          await new Promise((r) => setTimeout(r, delay))
          continue
        }
        throw rpcErr
      }
    }
    return false
  } catch (err) {
    logger.warn(
      { err, topicId: input.topicId, messageId: msg.id, manual: input.manual, retryCount: options.retryCount },
      'sendUserMessage RPC failed',
    )
    return false
  }
}

// Ensures a usable PI session exists. Session is expected to be established
// by the gateway (topic.create / topic.select); this just handles reconnection
// if the in-memory session was lost (e.g. after DO hibernation).
async function ensureDeliverableSession(
  topic: Topic | undefined,
  pi: PiClient,
): Promise<string | null> {
  if (!topic?.pi_session_id) return null

  const sessionId = topic.pi_session_id
  if (pi.hasSession(sessionId)) return sessionId

  try {
    await pi.reconnectSession(sessionId)
    logger.info({ topicId: topic.id, sessionId }, 'PI session reconnected for delivery')
    return sessionId
  } catch (err) {
    if (err instanceof PiRpcError && err.code === 'session_not_found') {
      logger.info({ topicId: topic.id, sessionId }, 'session not found, attempting recreate')
      try {
        const result = await pi.recreateSession({ ...buildSessionParams(topic), sessionId })
        return (result as { sessionId: string }).sessionId
      } catch (recreateErr) {
        logger.warn({ err: recreateErr, topicId: topic.id, sessionId }, 'recreateSession failed in ensureDeliverableSession')
        return null
      }
    }
    logger.warn({ err, topicId: topic.id, sessionId }, 'reconnectSession failed in ensureDeliverableSession')
    return null
  }
}

async function handleRetryFailure(
  input: DeliverUserMessageInput,
  msg: Message,
  retryCount: number,
): Promise<'retryable' | 'reverted'> {
  // After exhausting manual retries, delete the message (revert).
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

  await messageRepo.updateMessage(msg.id, { status: 'needs_retry', retry_count: retryCount })
  broadcastDelivery(input.broadcaster, input.topicId, msg.id, 'needs_retry', retryCount, msg.max_retries)
  return 'retryable'
}

async function buildMentionedArtifactRefs(
  input: DeliverUserMessageInput,
): Promise<Array<{ id: string; name: string; downloadUrl: string }> | undefined> {
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
      downloadUrl: buildArtifactAccessUrl(
        input.artifactAccess.baseUrl,
        'download',
        artifact.r2_key,
        token,
        artifact.name,
      ),
    })
  }
  return refs
}

export function buildSessionParams(topic: Topic): Parameters<PiClient['createSession']>[0] {
  return {
    kind: topic.agent_type,
    topicId: topic.id,
    programming: topic.programming_spec_json ? JSON.parse(topic.programming_spec_json) : undefined,
    general: topic.general_spec_json ? JSON.parse(topic.general_spec_json) : undefined,
    initialModel: topic.current_model ?? undefined,
  } as Parameters<PiClient['createSession']>[0]
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  promise.catch(() => undefined)
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout?.()
          reject(new Error(message))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function broadcastDelivery(
  broadcaster: MessageDeliveryBroadcaster,
  topicId: string,
  messageId: string,
  status: 'pending' | 'needs_retry' | 'retrying' | 'done' | 'error',
  retryCount: number,
  maxRetries: number,
): void {
  broadcaster.broadcast('message.delivery', { topicId, messageId, status, retryCount, maxRetries })
}

// Exported for tests only
export let _minRetryWaitMs = 0
export function _setMinRetryWaitForTest(_ms: number): void { _minRetryWaitMs = _ms }
