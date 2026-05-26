import * as messageRepo from '../db/repos/message.repo'
import { logger } from '../logger'

export interface AbortBroadcaster {
  broadcast(type: string, data: unknown): void
}

export async function abortSessionWithTimeout(
  rpc: () => Promise<unknown>,
  timeoutMs = 5000,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    await Promise.race([
      rpc(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('abortSession timeout')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function finalizeTopicAbort(
  topicId: string,
  broadcaster: AbortBroadcaster,
): Promise<void> {
  try {
    await messageRepo.flushParts()
  } catch (err) {
    logger.warn({ err, topicId }, 'Failed to flush pending parts before abort finalize')
  }

  const now = Date.now()
  const messages = await messageRepo.listMessagesByTopic(topicId)
  const streamingMessages = messages.filter((message) => message.status === 'streaming')

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
