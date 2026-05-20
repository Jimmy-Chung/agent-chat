import type { WSFrame } from '@agent-chat/protocol'
import { messagesLoadSchema, userMessageRetrySchema, userMessageSchema } from '@agent-chat/protocol'
import type { PiClient } from '../../pi/client'
import * as topicRepo from '../../db/repos/topic.repo'
import * as messageRepo from '../../db/repos/message.repo'
import type { EventBroadcaster } from '../../pi/event-router'
import { logger } from '../../logger'
import { createPendingUserMessage, deliverUserMessage, startAutoDelivery } from '../message-delivery'

async function loadMessageHistory(topicId: string) {
  const msgs = await messageRepo.listMessagesByTopic(topicId)
  const partsByMessage: Record<string, { id: string; message_id: string; ordinal: number; kind: string; content_json: string }[]> = {}

  for (const msg of msgs) {
    const parts = await messageRepo.getMessageParts(msg.id)
    if (parts.length > 0) {
      partsByMessage[msg.id] = parts.map((p) => ({
        id: p.id,
        message_id: p.message_id,
        ordinal: p.ordinal,
        kind: p.kind,
        content_json: p.content_json,
      }))
    }
  }

  return {
    topicId,
    messages: msgs.map((m) => ({
      id: m.id,
      topic_id: m.topic_id,
      role: m.role,
      status: m.status,
      started_at: m.started_at,
      finished_at: m.finished_at,
      stop_reason: m.stop_reason,
      cron_run_id: m.cron_run_id,
      turn_id: m.turn_id,
    })),
    partsByMessage,
  }
}

export function registerMessageHandlers(
  hub: { on: (event: string, handler: (...args: unknown[]) => void) => void; sendToClient?: (ws: unknown, event: { type: string; data: unknown }) => void },
  pi: PiClient,
  broadcaster: EventBroadcaster,
): void {
  hub.on('client:messages.load', async (...args: unknown[]) => {
    const conn = args[0]
    const frame = args[1] as WSFrame
    const data = messagesLoadSchema.parse(frame.d)

    try {
      await messageRepo.flushParts()
    } catch (err) {
      logger.warn({ err, topicId: data.topicId }, 'Failed to flush pending parts before history load')
    }

    if (hub.sendToClient) {
      hub.sendToClient(conn, {
        type: 'messages.history',
        data: await loadMessageHistory(data.topicId),
      })
    }
  })

  hub.on('client:user.message.retry', async (...args: unknown[]) => {
    const frame = args[1] as WSFrame
    const data = userMessageRetrySchema.parse(frame.d)
    const parts = await messageRepo.getMessageParts(data.messageId)
    const textPart = parts.find((part) => part.kind === 'text')
    const content = textPart ? parseTextContent(textPart.content_json) : ''

    if (!content) return

    await deliverUserMessage({
      topicId: data.topicId,
      messageId: data.messageId,
      content,
      pi,
      broadcaster,
      manual: true,
    })
  })

  hub.on('client:user.message', async (...args: unknown[]) => {
    const frame = args[1] as WSFrame
    const data = userMessageSchema.parse(frame.d)
    const topic = await topicRepo.getTopic(data.topicId)
    if (!topic) return

    const msg = await createPendingUserMessage({
      topicId: data.topicId,
      content: data.content,
      mentions: data.mentions,
      clientMessageId: data.clientMessageId,
      broadcaster,
    })

    await startAutoDelivery({
      topicId: data.topicId,
      messageId: msg.id,
      content: data.content,
      mentions: data.mentions,
      pi,
      broadcaster,
      manual: false,
    })
  })
}

function parseTextContent(contentJson: string): string {
  try {
    const parsed = JSON.parse(contentJson) as { content?: string } | string
    return typeof parsed === 'string' ? parsed : parsed.content ?? ''
  } catch {
    return ''
  }
}
