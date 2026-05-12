import type { WSFrame } from '@agent-chat/protocol'
import { topicCreateSchema, topicDeleteSchema, topicRenameSchema, topicDetachExtensionSchema, topicSetModelSchema, topicSetPlanModeSchema, topicResumeSchema } from '@agent-chat/protocol'
import type { PiClient } from '../../pi/client'
import * as topicRepo from '../../db/repos/topic.repo'
import * as artifactRepo from '../../db/repos/artifact.repo'
import * as sopRepo from '../../db/repos/sop_template.repo'
import { logger } from '../../logger'
import type { EventBroadcaster } from '../../pi/event-router'

export function registerTopicHandlers(
  hub: { on: (event: string, handler: (...args: unknown[]) => void) => void },
  pi: PiClient,
  broadcaster: EventBroadcaster,
): void {
  hub.on('client:topic.create', async (...args: unknown[]) => {
    const frame = args[1] as WSFrame
    const data = topicCreateSchema.parse(frame.d)

    if (await topicRepo.getTopicByName(data.name)) {
      broadcaster.broadcast('error', { code: 'DUPLICATE_NAME', message: '同名话题已存在' })
      return
    }

    const topic = await topicRepo.createTopic({
      name: data.name,
      kind: 'normal',
      agentType: data.agentType,
      programmingSpecJson: data.programming
        ? JSON.stringify(data.programming)
        : null,
      sopTemplateId: data.sopTemplateId,
    })
    broadcaster.broadcast('topic.created', topic)

    try {
      const sopTemplate = data.sopTemplateId
        ? await sopRepo.getTemplate(data.sopTemplateId)
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
      const updated = await topicRepo.updateTopic(topic.id, {
        pi_session_id: result.sessionId,
      })
      if (updated) {
        broadcaster.broadcast('topic.updated', updated)
      }
      logger.info({ topicId: topic.id, sessionId: result.sessionId }, 'PI session created')
    } catch (err) {
      logger.error({ err, topicId: topic.id }, 'Failed to create PI session')
      broadcaster.broadcast('error', { code: 'PI_SESSION_FAILED', message: 'Failed to create agent session' })
    }
  })

  hub.on('client:topic.delete', async (...args: unknown[]) => {
    const frame = args[1] as WSFrame
    const data = topicDeleteSchema.parse(frame.d)
    const topic = await topicRepo.getTopic(data.id)
    if (!topic) return

    if (topic.kind !== 'normal') {
      broadcaster.broadcast('error', { code: 'LOCKED', message: 'System topics cannot be deleted' })
      return
    }

    const artifacts = await artifactRepo.listArtifactsByTopic(data.id)
    if (artifacts.length > 0) {
      if (data.artifactStrategy === 'pool') {
        for (const a of artifacts) {
          await artifactRepo.updateArtifactTopic(a.id, null)
          broadcaster.broadcast('artifact.moved', { id: a.id, fromTopicId: data.id, toTopicId: null })
        }
      } else {
        for (const a of artifacts) {
          await artifactRepo.deleteArtifact(a.id)
          broadcaster.broadcast('artifact.deleted', { id: a.id })
        }
      }
    }

    await topicRepo.deleteTopic(data.id)
    broadcaster.broadcast('topic.deleted', { id: data.id })

    if (topic.pi_session_id) {
      pi.disconnectSession(topic.pi_session_id)
    }
  })

  hub.on('client:topic.rename', async (...args: unknown[]) => {
    const frame = args[1] as WSFrame
    const data = topicRenameSchema.parse(frame.d)
    const topic = await topicRepo.updateTopic(data.id, { name: data.name })
    if (topic) {
      broadcaster.broadcast('topic.updated', topic)
    }
  })

  hub.on('client:topic.detachExtension', async (...args: unknown[]) => {
    const frame = args[1] as WSFrame
    const data = topicDetachExtensionSchema.parse(frame.d)
    const topic = await topicRepo.getTopic(data.id)
    if (!topic || !topic.pi_session_id) return

    try {
      await pi.rpc('detachExtension', { sessionId: topic.pi_session_id })
    } catch (err) {
      logger.warn({ err }, 'Failed to detach extension from PI')
    }

    const updated = await topicRepo.updateTopic(data.id, {
      agent_type: 'general',
      history_frozen_at: Date.now(),
    })
    if (updated) {
      broadcaster.broadcast('topic.updated', updated)
    }
  })

  hub.on('client:topic.setModel', async (...args: unknown[]) => {
    const frame = args[1] as WSFrame
    const data = topicSetModelSchema.parse(frame.d)
    const topic = await topicRepo.getTopic(data.id)
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

    const updated = await topicRepo.updateTopic(data.id, {
      current_model: data.model,
    })
    if (updated) {
      broadcaster.broadcast('topic.updated', updated)
    }
  })

  hub.on('client:topic.setPlanMode', async (...args: unknown[]) => {
    const frame = args[1] as WSFrame
    const data = topicSetPlanModeSchema.parse(frame.d)
    const topic = await topicRepo.getTopic(data.id)
    if (!topic) return

    if (topic.agent_type !== 'programming') {
      broadcaster.broadcast('error', { code: 'INVALID_TOPIC', message: 'Plan mode only applies to programming topics' })
      return
    }

    if (topic.pi_session_id) {
      try {
        await pi.rpc('setPlanMode', {
          sessionId: topic.pi_session_id,
          planMode: data.planMode,
        })
      } catch (err) {
        logger.error({ err, topicId: data.id }, 'Failed to set plan mode on PI')
        broadcaster.broadcast('error', { code: 'PI_PLAN_MODE_FAILED', message: 'Failed to set plan mode' })
        return
      }
    }

    const updated = await topicRepo.updateTopic(data.id, { plan_mode: data.planMode })
    if (updated) {
      broadcaster.broadcast('topic.updated', updated)
    }
  })

  hub.on('client:topic.resume', async (...args: unknown[]) => {
    const frame = args[1] as WSFrame
    const data = topicResumeSchema.parse(frame.d)
    const topic = await topicRepo.getTopic(data.topicId)
    if (!topic || !topic.pi_session_id) return

    if (pi.hasSession(topic.pi_session_id)) return

    try {
      await pi.reconnectSession(topic.pi_session_id)
      logger.info({ topicId: topic.id, sessionId: topic.pi_session_id }, 'PI session resumed')
    } catch (err) {
      logger.error({ err, topicId: topic.id }, 'Failed to resume PI session')
      broadcaster.broadcast('error', { code: 'PI_RESUME_FAILED', message: 'Failed to resume agent session' })
    }
  })
}
