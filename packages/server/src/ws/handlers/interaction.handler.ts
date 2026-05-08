import type { WSFrame } from '@agent-chat/protocol'
import { userActionSchema } from '@agent-chat/protocol'
import type { WsHub } from '../hub'
import type { PiClient } from '../../pi/client'
import * as topicRepo from '../../db/repos/topic.repo'
import * as interactionRepo from '../../db/repos/interaction.repo'
import { logger } from '../../logger'

export function registerInteractionHandlers(hub: WsHub, pi: PiClient): void {
  hub.on('client:user.action', async (_conn, frame: WSFrame) => {
    const data = userActionSchema.parse(frame.d)

    if (data.action === 'abort') {
      // Abort current session
      const topic = topicRepo.getTopic(data.topicId)
      if (topic?.pi_session_id) {
        try {
          await pi.rpc('abortSession', { sessionId: topic.pi_session_id })
        } catch (err) {
          logger.warn({ err }, 'Failed to abort session on PI')
        }
      }
      return
    }

    // Resolve interaction (approve/reject)
    if (data.interactionId) {
      const interaction = interactionRepo.getInteraction(data.interactionId)
      if (!interaction || interaction.status !== 'pending') return

      const decision =
        data.action === 'approve'
          ? 'approve'
          : data.action === 'reject'
            ? 'reject'
            : 'reject'

      // Update in DB
      interactionRepo.updateInteraction(data.interactionId, {
        status: 'resolved',
        response_json: JSON.stringify({ decision }),
        resolved_at: Date.now(),
      })

      // Forward to PI
      const topic = topicRepo.getTopic(data.topicId)
      if (topic?.pi_session_id) {
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
  })
}
