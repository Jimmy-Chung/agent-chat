import type { WSFrame } from '@agent-chat/protocol'
import { userMessageSchema } from '@agent-chat/protocol'
import type { WsHub } from '../hub'
import type { PiClient } from '../../pi/client'
import * as topicRepo from '../../db/repos/topic.repo'
import * as messageRepo from '../../db/repos/message.repo'
import { logger } from '../../logger'

export function registerMessageHandlers(hub: WsHub, pi: PiClient): void {
  hub.on('client:user.message', async (_conn, frame: WSFrame) => {
    const data = userMessageSchema.parse(frame.d)
    const topic = topicRepo.getTopic(data.topicId)
    if (!topic) {
      logger.warn({ topicId: data.topicId }, 'Topic not found for user message')
      return
    }

    // Create user message in DB
    const msg = messageRepo.createMessage({
      topicId: data.topicId,
      role: 'user',
      status: 'done',
    })

    // Create text part with content
    messageRepo.createMessagePart({
      messageId: msg.id,
      kind: 'text',
      contentJson: JSON.stringify({ content: data.content }),
    })

    // Index for FTS5
    messageRepo.indexMessageForSearch(msg.id, data.topicId, data.content)

    // Notify clients
    hub.broadcast({
      type: 'message.start',
      data: {
        topicId: data.topicId,
        messageId: msg.id,
        role: 'user',
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

    // Forward to PI
    if (topic.pi_session_id) {
      try {
        await pi.rpc('sendUserMessage', {
          sessionId: topic.pi_session_id,
          content: data.content,
          mentionedArtifacts: data.mentions?.map((m) => ({
            id: m.id,
            name: m.name,
            downloadUrl: m.downloadUrl ?? '',
          })),
        })
      } catch (err) {
        logger.error({ err }, 'Failed to send user message to PI')
      }
    }
  })
}
