import type { WSFrame } from '@agent-chat/protocol'
import type { TodoItem } from '@agent-chat/protocol'
import { topicCreateSchema, topicDeleteSchema, topicRenameSchema, topicDetachExtensionSchema, topicSetAttentionTargetSchema, topicSetModelSchema, topicSetPlanModeSchema, topicResumeSchema } from '@agent-chat/protocol'
import type { PiClient } from '../../pi/client'
import * as topicRepo from '../../db/repos/topic.repo'
import * as artifactRepo from '../../db/repos/artifact.repo'
import * as sopRepo from '../../db/repos/sop_template.repo'
import { logger } from '../../logger'
import type { EventBroadcaster } from '../../pi/event-router'
import { restoreExistingTopicSessionDetailed } from '../message-delivery'
import { composeSopWorkflow, type SopNode } from '../../sop/workflow'

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

    const requestedCwd = data.agentType === 'programming'
      ? data.programming?.cwd?.trim()
      : data.general?.cwd?.trim()
    if (requestedCwd) {
      const occupiedTopic = await topicRepo.getTopicByCwd(requestedCwd)
      if (occupiedTopic) {
        broadcaster.broadcast('error', {
          code: 'DUPLICATE_CWD',
          message: '已有同目录话题',
          details: {
            topicId: occupiedTopic.id,
            topicName: occupiedTopic.name,
            cwd: requestedCwd,
          },
        })
        return
      }
    }

    const selectedSopIds = data.sopIds?.length
      ? data.sopIds
      : data.sopTemplateId
        ? [data.sopTemplateId]
        : []
    const selectedSops = []
    for (const sopId of selectedSopIds) {
      const template = await sopRepo.getTemplate(sopId)
      if (!template) {
        broadcaster.broadcast('error', { code: 'SOP_NOT_FOUND', message: 'SOP 不存在' })
        return
      }
      selectedSops.push(template)
    }
    const sopWorkflow = composeSopWorkflow(selectedSops.map(sopTemplateToNode))
    const generalSpec = data.agentType === 'general'
      ? {
          ...data.general,
          ...(sopWorkflow
            ? {
                systemPrompt: sopWorkflow.composedInstruction,
                initialPlan: sopWorkflow.composedPlan,
                initialTodos: sopWorkflow.composedTodos,
                sopWorkflow,
              }
            : {}),
        }
      : undefined
    const generalSpecJson = generalSpec && Object.values(generalSpec).some((value) => value !== undefined)
      ? JSON.stringify(generalSpec)
      : null

    const programmingSpec = data.agentType === 'programming'
      ? {
          ...(data.programming ?? {}),
          ...(sopWorkflow
            ? {
                systemPrompt: sopWorkflow.composedInstruction,
                sopWorkflow,
              }
            : {}),
        }
      : undefined

    const topic = await topicRepo.createTopic({
      name: data.name,
      kind: 'normal',
      agentType: data.agentType,
      programmingSpecJson: programmingSpec && Object.values(programmingSpec).some((value) => value !== undefined)
        ? JSON.stringify(programmingSpec)
        : null,
      generalSpecJson,
      sopTemplateId: selectedSopIds[0] ?? null,
      currentProviderId: data.providerId ?? null,
      currentModel: data.model ?? null,
    })
    broadcaster.broadcast('topic.created', topic)

    try {
      const sessionParams: Record<string, unknown> = {
        kind: data.agentType,
        topicId: topic.id,
        programming: data.agentType === 'programming' ? programmingSpec : undefined,
        general: data.agentType === 'general' ? generalSpec : undefined,
      }
      if (data.providerId) sessionParams.providerId = data.providerId
      if (data.model) sessionParams.initialModel = data.model

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
          const externalRefs = await artifactRepo.countActiveMessageRefs(a.id, { excludeTopicId: data.id })
          if (externalRefs > 0) {
            await artifactRepo.updateArtifactTopic(a.id, null)
            broadcaster.broadcast('artifact.moved', { id: a.id, fromTopicId: data.id, toTopicId: null })
            continue
          }
          await artifactRepo.deleteArtifact(a.id)
          broadcaster.broadcast('artifact.deleted', { id: a.id })
        }
      }
    }

    await topicRepo.deleteTopic(data.id)
    broadcaster.broadcast('topic.deleted', { id: data.id })

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

    const updated = await topicRepo.updateTopic(data.id, {
      current_model: data.model,
    })
    if (updated) {
      broadcaster.broadcast('topic.updated', updated)
    }

    if (topic.pi_session_id) {
      try {
        const result = await pi.rpc('setSessionModel', {
          sessionId: topic.pi_session_id,
          model: data.model,
        })
        if (!result?.ok) {
          broadcaster.broadcast('error', {
            code: 'MODEL_SWITCH_FAILED',
            message: '模型已保存，但当前会话切换失败；重新进入话题后会使用新模型',
            details: {
              topicId: data.id,
              model: data.model,
            },
          })
          return
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to set model on PI')
        broadcaster.broadcast('error', {
          code: 'MODEL_SWITCH_FAILED',
          message: '模型已保存，但当前会话切换失败；重新进入话题后会使用新模型',
          details: {
            topicId: data.id,
            model: data.model,
            error: err instanceof Error ? err.message : String(err),
          },
        })
      }
    }
  })

  hub.on('client:topic.setAttentionTarget', async (...args: unknown[]) => {
    const frame = args[1] as WSFrame
    const data = topicSetAttentionTargetSchema.parse(frame.d)
    const updated = await topicRepo.updateTopic(data.id, { attention_target: data.target?.trim() || null })
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
    const result = await restoreExistingTopicSessionDetailed(data.topicId, pi)
    if (result.restored && result.sessionId) {
      const topic = await topicRepo.getTopic(data.topicId)
      if (topic?.pi_session_id && topic.pi_session_id !== result.sessionId) {
        const updated = await topicRepo.updateTopic(topic.id, { pi_session_id: result.sessionId })
        if (updated) broadcaster.broadcast('topic.updated', updated)
      }
      return
    }
    if (!result.restored) {
      const topic = await topicRepo.getTopic(data.topicId)
      if (topic?.pi_session_id) {
        logger.error({ topicId: topic.id, sessionId: topic.pi_session_id }, 'Failed to restore PI session')
        broadcaster.broadcast('error', { code: 'PI_RESUME_FAILED', message: 'Failed to resume agent session' })
      }
    }
  })
}

function parseTodoItems(value: string | null): TodoItem[] | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as TodoItem[]
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function sopTemplateToNode(template: sopRepo.SopTemplate): SopNode {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    agent_type: template.agent_type,
    instruction: template.instruction,
    input_contract: template.input_contract,
    output_contract: template.output_contract,
    plan_template: template.plan_template,
    todo_items: parseTodoItems(template.todo_items_json),
    created_at: template.created_at,
    updated_at: template.updated_at,
  }
}
