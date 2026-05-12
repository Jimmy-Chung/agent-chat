import type { WSFrame } from '@agent-chat/protocol'
import { userActionSchema } from '@agent-chat/protocol'
import type { PiClient } from '../../pi/client'
import * as topicRepo from '../../db/repos/topic.repo'
import * as interactionRepo from '../../db/repos/interaction.repo'
import { logger } from '../../logger'
import type { EventBroadcaster } from '../../pi/event-router'

export function registerInteractionHandlers(
  hub: { on: (event: string, handler: (...args: unknown[]) => void) => void },
  pi: PiClient,
  broadcaster: EventBroadcaster,
): void {
  hub.on('client:user.action', async (...args: unknown[]) => {
    const frame = args[1] as WSFrame
    const data = userActionSchema.parse(frame.d)

    if (data.action === 'abort') {
      const topic = await topicRepo.getTopic(data.topicId)
      if (topic?.pi_session_id) {
        try {
          await pi.rpc('abortSession', { sessionId: topic.pi_session_id })
        } catch (err) {
          logger.warn({ err }, 'Failed to abort session on PI')
        }
      }
      broadcaster.broadcast('agent.status', { topicId: data.topicId, state: 'idle' })
      return
    }

    if (data.interactionId) {
      const interaction = await interactionRepo.getInteraction(data.interactionId)
      if (!interaction || interaction.status !== 'pending') return

      const decision =
        data.action === 'approve'
          ? 'approve'
          : data.action === 'reject'
            ? 'reject'
            : 'reject'

      await interactionRepo.updateInteraction(data.interactionId, {
        status: 'resolved',
        response_json: JSON.stringify({ decision }),
        resolved_at: Date.now(),
      })

      const topic = await topicRepo.getTopic(data.topicId)
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
