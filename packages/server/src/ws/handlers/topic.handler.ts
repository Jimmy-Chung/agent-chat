import type { WSFrame } from '@agent-chat/protocol'
import { topicCreateSchema, topicDeleteSchema, topicRenameSchema, topicDetachExtensionSchema, topicSetModelSchema, topicResumeSchema } from '@agent-chat/protocol'
import type { WsHub } from '../hub'
import type { PiClient } from '../../pi/client'
import * as topicRepo from '../../db/repos/topic.repo'
import * as artifactRepo from '../../db/repos/artifact.repo'
import * as sopRepo from '../../db/repos/sop_template.repo'
import { logger } from '../../logger'

export function registerTopicHandlers(hub: WsHub, pi: PiClient): void {
  hub.on('client:topic.create', async (_conn, frame: WSFrame) => {
    const data = topicCreateSchema.parse(frame.d)

    // Check for duplicate name
    if (topicRepo.getTopicByName(data.name)) {
      hub.broadcast({
        type: 'error',
        data: { code: 'DUPLICATE_NAME', message: '同名话题已存在' },
      })
      return
    }

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

    // Create PI session (opens its own WS connection for events)
    try {
      // Build session params with optional SOP template
      const sopTemplate = data.sopTemplateId
        ? sopRepo.getTemplate(data.sopTemplateId)
        : undefined

      const sessionParams: Record<string, unknown> = {
        kind: data.agentType,
        topicId: topic.id,
        programming: data.agentType === 'programming' ? data.programming : undefined,
      }

      if (sopTemplate) {
        sessionParams.general = {
          systemPrompt: sopTemplate.system_prompt_addon ?? undefined,
          initialPlan: sopTemplate.plan_template ?? undefined,
          initialTodos: sopTemplate.todos_template_json
            ? JSON.parse(sopTemplate.todos_template_json)
            : undefined,
        }
        sessionParams.workflowMode = sopTemplate.workflow_mode
      }

      const result = await pi.createSession(sessionParams as Parameters<typeof pi.createSession>[0])
      const updated = topicRepo.updateTopic(topic.id, {
        pi_session_id: result.sessionId,
      })
      if (updated) {
        hub.broadcast({ type: 'topic.updated', data: updated })
      }
      logger.info({ topicId: topic.id, sessionId: result.sessionId }, 'PI session created')
    } catch (err) {
      logger.error({ err, topicId: topic.id }, 'Failed to create PI session')
      hub.broadcast({
        type: 'error',
        data: { code: 'PI_SESSION_FAILED', message: 'Failed to create agent session' },
      })
    }
  })

  hub.on('client:topic.delete', (_conn, frame: WSFrame) => {
    const data = topicDeleteSchema.parse(frame.d)
    const topic = topicRepo.getTopic(data.id)
    if (!topic) return

    if (topic.kind !== 'normal') {
      hub.broadcast({
        type: 'error',
        data: { code: 'LOCKED', message: 'System topics cannot be deleted' },
      })
      return
    }

    // Handle artifacts before deleting topic
    const artifacts = artifactRepo.listArtifactsByTopic(data.id)
    if (artifacts.length > 0) {
      if (data.artifactStrategy === 'pool') {
        for (const a of artifacts) {
          artifactRepo.updateArtifactTopic(a.id, null)
          hub.broadcast({ type: 'artifact.moved', data: { id: a.id, fromTopicId: data.id, toTopicId: null } })
        }
      } else {
        for (const a of artifacts) {
          artifactRepo.deleteArtifact(a.id)
          hub.broadcast({ type: 'artifact.deleted', data: { id: a.id } })
        }
      }
    }

    topicRepo.deleteTopic(data.id)
    hub.broadcast({ type: 'topic.deleted', data: { id: data.id } })

    // Disconnect PI session
    if (topic.pi_session_id) {
      pi.disconnectSession(topic.pi_session_id)
    }
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

  hub.on('client:topic.resume', async (_conn, frame: WSFrame) => {
    const data = topicResumeSchema.parse(frame.d)
    const topic = topicRepo.getTopic(data.topicId)
    if (!topic || !topic.pi_session_id) return

    // Already connected — no-op
    if (pi.hasSession(topic.pi_session_id)) return

    try {
      await pi.reconnectSession(topic.pi_session_id)
      logger.info({ topicId: topic.id, sessionId: topic.pi_session_id }, 'PI session resumed')
    } catch (err) {
      logger.error({ err, topicId: topic.id }, 'Failed to resume PI session')
      hub.broadcast({
        type: 'error',
        data: { code: 'PI_RESUME_FAILED', message: 'Failed to resume agent session' },
      })
    }
  })
}
