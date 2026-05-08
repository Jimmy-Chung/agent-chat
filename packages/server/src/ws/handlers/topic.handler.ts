import type { WSFrame } from '@agent-chat/protocol'
import { topicCreateSchema, topicDeleteSchema, topicRenameSchema, topicDetachExtensionSchema, topicSetModelSchema } from '@agent-chat/protocol'
import type { WsHub } from '../hub'
import type { PiClient } from '../../pi/client'
import * as topicRepo from '../../db/repos/topic.repo'
import { logger } from '../../logger'

export function registerTopicHandlers(hub: WsHub, pi: PiClient): void {
  hub.on('client:topic.create', (_conn, frame: WSFrame) => {
    const data = topicCreateSchema.parse(frame.d)
    const topic = topicRepo.createTopic({
      name: data.name,
      kind: 'normal',
      agentType: data.agentType,
      programmingSpecJson: data.programming
        ? JSON.stringify(data.programming)
        : null,
      sopTemplateId: data.sopTemplateId,
    })
    hub.broadcast({ type: 'topic.created', data: topic })
  })

  hub.on('client:topic.delete', (_conn, frame: WSFrame) => {
    const data = topicDeleteSchema.parse(frame.d)
    const topic = topicRepo.getTopic(data.id)
    if (!topic) return

    if (topic.kind !== 'normal') {
      // System topics cannot be deleted — send error
      hub.broadcast({
        type: 'error',
        data: { code: 'LOCKED', message: 'System topics cannot be deleted' },
      })
      return
    }

    topicRepo.deleteTopic(data.id)
    hub.broadcast({ type: 'topic.deleted', data: { id: data.id } })
  })

  hub.on('client:topic.rename', (_conn, frame: WSFrame) => {
    const data = topicRenameSchema.parse(frame.d)
    const topic = topicRepo.updateTopic(data.id, { name: data.name })
    if (topic) {
      hub.broadcast({ type: 'topic.updated', data: topic })
    }
  })

  hub.on('client:topic.detachExtension', async (_conn, frame: WSFrame) => {
    const data = topicDetachExtensionSchema.parse(frame.d)
    const topic = topicRepo.getTopic(data.id)
    if (!topic || !topic.pi_session_id) return

    try {
      await pi.rpc('detachExtension', { sessionId: topic.pi_session_id })
    } catch (err) {
      logger.warn({ err }, 'Failed to detach extension from PI')
    }

    const updated = topicRepo.updateTopic(data.id, {
      agent_type: 'general',
      history_frozen_at: Date.now(),
    })
    if (updated) {
      hub.broadcast({ type: 'topic.updated', data: updated })
    }
  })

  hub.on('client:topic.setModel', async (_conn, frame: WSFrame) => {
    const data = topicSetModelSchema.parse(frame.d)
    const topic = topicRepo.getTopic(data.id)
    if (!topic) return

    if (topic.pi_session_id) {
      try {
        await pi.rpc('setSessionModel', {
          sessionId: topic.pi_session_id,
          model: data.model,
        })
      } catch (err) {
        logger.warn({ err }, 'Failed to set model on PI')
      }
    }

    const updated = topicRepo.updateTopic(data.id, {
      current_model: data.model,
    })
    if (updated) {
      hub.broadcast({ type: 'topic.updated', data: updated })
    }
  })
}
