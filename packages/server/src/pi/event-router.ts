import type { PIEvent } from '@agent-chat/protocol'
import type { PiClient } from './client'
import * as topicRepo from '../db/repos/topic.repo'
import * as messageRepo from '../db/repos/message.repo'
import * as interactionRepo from '../db/repos/interaction.repo'
import * as usageRepo from '../db/repos/usage.repo'
import * as cronRepo from '../db/repos/cron.repo'
import type { WsHub } from '../ws/hub'
import { logger } from '../logger'

export function routePiEvents(pi: PiClient, hub: WsHub): void {
  pi.on('event', (event: PIEvent) => {
    routeEvent(event, hub)
  })
}

function findTopicIdBySession(sessionId: string): string | null {
  const topics = topicRepo.listTopics()
  const match = topics.find((t) => t.pi_session_id === sessionId)
  return match?.id ?? null
}

function routeEvent(event: PIEvent, hub: WsHub): void {
  const payload = event.payload
  const sessionId = event.sessionId
  const topicId = findTopicIdBySession(sessionId)

  switch (payload.kind) {
    case 'message.start': {
      if (!topicId) return
      const msg = messageRepo.createMessage({
        topicId,
        role: 'assistant',
      })
      hub.broadcast({
        type: 'message.start',
        data: {
          topicId,
          messageId: payload.messageId || msg.id,
          role: 'assistant',
        },
      })
      break
    }

    case 'message.delta': {
      if (!topicId) return
      const kind = payload.part.kind
      messageRepo.bufferPartDelta(
        payload.messageId,
        kind === 'text'
          ? 'text'
          : kind === 'thinking'
            ? 'thinking'
            : 'tool_use',
        JSON.stringify(payload.part),
      )
      hub.broadcast({
        type: 'message.delta',
        data: {
          topicId,
          messageId: payload.messageId,
          part: payload.part,
        },
      })
      break
    }

    case 'message.end': {
      if (!topicId) return
      messageRepo.flushParts()
      messageRepo.updateMessage(payload.messageId, {
        status: 'done',
        finished_at: Date.now(),
        stop_reason: payload.stopReason,
      })
      hub.broadcast({
        type: 'message.end',
        data: {
          topicId,
          messageId: payload.messageId,
          stopReason: payload.stopReason,
        },
      })
      break
    }

    case 'tool.call': {
      if (!topicId) return
      messageRepo.createMessagePart({
        messageId: payload.messageId,
        kind: 'tool_use',
        contentJson: JSON.stringify({
          toolUseId: payload.toolUseId,
          name: payload.name,
          input: payload.input,
        }),
      })
      hub.broadcast({
        type: 'tool.call',
        data: {
          topicId,
          toolUseId: payload.toolUseId,
          messageId: payload.messageId,
          name: payload.name,
          input: payload.input,
        },
      })
      break
    }

    case 'tool.result': {
      if (!topicId) return
      messageRepo.createMessagePart({
        messageId: payload.messageId,
        kind: 'tool_result',
        contentJson: JSON.stringify({
          toolUseId: payload.toolUseId,
          output: payload.output,
          isError: payload.isError,
        }),
      })
      hub.broadcast({
        type: 'tool.result',
        data: {
          topicId,
          toolUseId: payload.toolUseId,
          messageId: payload.messageId,
          output: payload.output,
          isError: payload.isError,
        },
      })
      break
    }

    case 'file.diff': {
      if (!topicId) return
      messageRepo.createMessagePart({
        messageId: payload.messageId,
        kind: 'file_diff',
        contentJson: JSON.stringify({
          path: payload.path,
          before: payload.before,
          after: payload.after,
        }),
      })
      hub.broadcast({
        type: 'file.diff',
        data: {
          topicId,
          messageId: payload.messageId,
          path: payload.path,
          before: payload.before,
          after: payload.after,
        },
      })
      break
    }

    case 'todo.update': {
      if (!topicId) return
      hub.broadcast({
        type: 'todo.update',
        data: {
          topicId,
          items: payload.items,
        },
      })
      break
    }

    case 'plan.update': {
      if (!topicId) return
      hub.broadcast({
        type: 'plan.update',
        data: {
          topicId,
          plan: payload.plan,
        },
      })
      break
    }

    case 'interaction.request': {
      if (!topicId) return
      const interaction = interactionRepo.createInteraction({
        topicId,
        messageId: payload.messageId,
        kind: payload.interactionKind,
        prompt: payload.prompt,
        optionsJson: payload.options
          ? JSON.stringify(payload.options)
          : null,
      })
      hub.broadcast({
        type: 'interaction.request',
        data: {
          topicId,
          interactionId: interaction.id,
          messageId: payload.messageId,
          interactionKind: payload.interactionKind,
          prompt: payload.prompt,
          options: payload.options,
          defaultTimeoutMs: payload.defaultTimeoutMs,
        },
      })
      break
    }

    case 'agent.status': {
      if (!topicId) return
      hub.broadcast({
        type: 'agent.status',
        data: {
          topicId,
          state: payload.state,
        },
      })
      break
    }

    case 'cron.triggered': {
      // Find the topic by the cron's origin session
      const originTopicId = findTopicIdBySession(payload.originSessionId)
      if (!originTopicId) {
        logger.warn(
          { originSessionId: payload.originSessionId },
          'Cron triggered but origin session not found',
        )
        return
      }
      const cronRun = cronRepo.createCronRun({
        cronId: payload.cronId,
        triggeredAt: payload.firedAt,
      })
      hub.broadcast({
        type: 'cron.triggered',
        data: {
          cronId: payload.cronId,
          originTopicId,
          runId: payload.runId || cronRun.id,
          firedAt: payload.firedAt,
        },
      })
      break
    }

    case 'usage.delta': {
      usageRepo.createUsageRecord({
        topicId,
        messageId: payload.messageId,
        model: payload.model,
        inputTokens: payload.inputTokens,
        outputTokens: payload.outputTokens,
      })
      break
    }

    case 'error': {
      hub.broadcast({
        type: 'error',
        data: {
          code: payload.code,
          message: payload.message,
        },
      })
      break
    }

    default: {
      logger.warn({ kind: (payload as Record<string, unknown>).kind }, 'Unknown PI event kind')
    }
  }
}
