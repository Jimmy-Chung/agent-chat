import type { WSFrame } from '@agent-chat/protocol'
import { messagesLoadSchema, userMessageSchema } from '@agent-chat/protocol'
import type { WsHub } from '../hub'
import type { PiClient } from '../../pi/client'
import * as topicRepo from '../../db/repos/topic.repo'
import * as messageRepo from '../../db/repos/message.repo'
import { logger } from '../../logger'

async function waitForPiSession(topicId: string, pi: PiClient, timeoutMs = 5000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const topic = topicRepo.getTopic(topicId)
    const sessionId = topic?.pi_session_id ?? null
    if (sessionId && pi.hasSession(sessionId)) {
      return sessionId
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  const topic = topicRepo.getTopic(topicId)
  const sessionId = topic?.pi_session_id ?? null
  return sessionId && pi.hasSession(sessionId) ? sessionId : null
}

function loadMessageHistory(topicId: string) {
  const msgs = messageRepo.listMessagesByTopic(topicId)
  const partsByMessage: Record<string, { id: string; message_id: string; ordinal: number; kind: string; content_json: string }[]> = {}

  for (const msg of msgs) {
    const parts = messageRepo.getMessageParts(msg.id)
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

export function registerMessageHandlers(hub: WsHub, pi: PiClient): void {
  hub.on('client:messages.load', (conn, frame: WSFrame) => {
    const data = messagesLoadSchema.parse(frame.d)

    hub.sendToClient(conn.ws, {
      type: 'messages.history',
      data: loadMessageHistory(data.topicId),
    })
  })

  hub.on('client:user.message', async (_conn, frame: WSFrame) => {
    const data = userMessageSchema.parse(frame.d)
    const topic = topicRepo.getTopic(data.topicId)
    if (!topic) {
      logger.warn({ topicId: data.topicId }, 'Topic not found for user message')
      return
    }

    const msg = messageRepo.createMessage({
      topicId: data.topicId,
      role: 'user',
      status: 'done',
    })

    messageRepo.createMessagePart({
      messageId: msg.id,
      kind: 'text',
      contentJson: JSON.stringify({ content: data.content }),
    })

    messageRepo.indexMessageForSearch(msg.id, data.topicId, data.content)

    hub.broadcast({
      type: 'message.start',
      data: {
        topicId: data.topicId,
        messageId: msg.id,
        role: 'user',
      },
    })
    hub.broadcast({
      type: 'message.delta',
      data: {
        topicId: data.topicId,
        messageId: msg.id,
        part: { kind: 'text', content: data.content },
      },
    })
    hub.broadcast({
      type: 'message.end',
      data: {
        topicId: data.topicId,
        messageId: msg.id,
        stopReason: 'end_turn',
      },
    })

    let sessionId = topic.pi_session_id
    if (!sessionId) {
      logger.info({ topicId: data.topicId }, 'Waiting for PI session before forwarding first message')
      sessionId = await waitForPiSession(data.topicId, pi)
    } else if (!pi.hasSession(sessionId)) {
      logger.info({ topicId: data.topicId, sessionId }, 'Stored PI session missing from pool, attempting reconnect before forwarding message')
      try {
        await pi.reconnectSession(sessionId)
      } catch (err) {
        logger.error({ err, topicId: data.topicId, sessionId }, 'Failed to reconnect stored PI session before forwarding message')
        hub.broadcast({
          type: 'error',
          data: {
            code: 'PI_RESUME_FAILED',
            message: 'Failed to resume agent session. Please create a new topic.',
          },
        })
        return
      }
    }

    if (sessionId) {
      const rpcParams = {
        sessionId,
        content: data.content,
        mentionedArtifacts: data.mentions?.map((m) => ({
          id: m.id,
          name: m.name,
          downloadUrl: m.downloadUrl ?? '',
        })),
      }
      logger.info({ rpcParams }, 'Sending sendUserMessage RPC to PI')
      void pi.rpc('sendUserMessage', rpcParams)
        .then((rpcResult) => {
          logger.info({ rpcResult }, 'sendUserMessage RPC result received')
        })
        .catch((err) => {
          logger.error({ err }, 'Failed to send user message to PI')
          const message = err instanceof Error ? err.message : String(err)
          if (message.includes('RPC timeout: sendUserMessage')) {
            logger.warn({ topicId: data.topicId, sessionId }, 'sendUserMessage RPC timed out after event stream started or while PI may still be working')
            return
          }
          hub.broadcast({
            type: 'error',
            data: {
              code: 'PI_UNAVAILABLE',
              message: 'Agent session is not available. Please create a new topic.',
            },
          })
        })
      return
    }

    logger.warn({ topicId: data.topicId }, 'Topic has no PI session after waiting, skipping sendUserMessage')
    hub.broadcast({
      type: 'error',
      data: {
        code: 'NO_PI_SESSION',
        message: 'This topic has no agent session. Please create a new topic.',
      },
    })
  })
}
