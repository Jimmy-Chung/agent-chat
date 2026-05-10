import type { PIEvent } from '@agent-chat/protocol'
import type { PiClient } from './client'
import * as topicRepo from '../db/repos/topic.repo'
import * as messageRepo from '../db/repos/message.repo'
import * as interactionRepo from '../db/repos/interaction.repo'
import * as artifactRepo from '../db/repos/artifact.repo'
import * as usageRepo from '../db/repos/usage.repo'
import * as cronRepo from '../db/repos/cron.repo'
import type { WsHub } from '../ws/hub'
import { logger } from '../logger'

const lastSeqBySession = new Map<string, number>()

export function routePiEvents(pi: PiClient, hub: WsHub): void {
  pi.on('event', (event: PIEvent) => {
    const lastSeq = lastSeqBySession.get(event.sessionId) ?? 0
    if (event.seq <= lastSeq) return
    lastSeqBySession.set(event.sessionId, event.seq)

    logger.info({ kind: event.payload.kind, sessionId: event.sessionId, seq: event.seq }, 'PI event received')
    try {
      routeEvent(event, hub)
    } catch (err) {
      logger.error({ err, kind: event.payload.kind }, 'Error routing PI event')
    }
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
      // Idempotent: skip if message already exists (duplicate event from PI)
      let msg = messageRepo.getMessage(payload.messageId)
      if (!msg) {
        msg = messageRepo.createMessage({
          topicId,
          role: 'assistant',
          id: payload.messageId,
        })
      }
      hub.broadcast({
        type: 'message.start',
        data: {
          topicId,
          messageId: msg.id,
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
      // Only broadcast text deltas to clients; thinking is buffered server-side only
      if (kind === 'thinking') break
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
      if (!messageRepo.getMessage(payload.messageId)) break
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
      if (!messageRepo.getMessage(payload.messageId)) break
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

    case 'artifact.created': {
      if (artifactRepo.getArtifact(payload.artifactId)) break
      const artifact = artifactRepo.createArtifact({
        id: payload.artifactId,
        topicId,
        originTopicId: topicId,
        name: payload.name,
        mime: payload.mime,
        sizeBytes: payload.sizeBytes,
        r2Key: '',
        source: 'generated',
        metadataJson: payload.metadata
          ? JSON.stringify(payload.metadata)
          : undefined,
      })
      hub.broadcast({
        type: 'artifact.added',
        data: {
          id: artifact.id,
          topic_id: artifact.topic_id,
          name: artifact.name,
          mime: artifact.mime,
          size_bytes: artifact.size_bytes,
          source: artifact.source,
          created_at: artifact.created_at,
        },
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

    case 'session.health': {
      if (!topicId) return
      hub.broadcast({
        type: 'session.health',
        data: {
          topicId,
          state: payload.state,
          piSessionId: payload.piSessionId,
          lastError: payload.lastError,
        },
      })
      break
    }

    case 'cron.run.completed': {
      const job = cronRepo.getCronJob(payload.cronId)
      if (!job) {
        logger.warn({ cronId: payload.cronId }, 'cron.run.completed: cron job not found')
        return
      }
      // Update the latest running cron run for this job
      const runs = cronRepo.listCronRuns(payload.cronId)
      const runningRun = runs.find((r) => r.status === 'running')
      if (runningRun) {
        cronRepo.updateCronRun(runningRun.id, {
          status: payload.status,
          finished_at: payload.completedAt,
        })
      }
      hub.broadcast({
        type: 'cron.run.completed',
        data: {
          cronId: payload.cronId,
          runId: payload.runId,
          originTopicId: job.origin_topic_id,
          status: payload.status,
          summary: payload.summary,
          duration: payload.duration,
          completedAt: payload.completedAt,
        },
      })
      break
    }

    default: {
      logger.warn({ kind: (payload as Record<string, unknown>).kind }, 'Unknown PI event kind')
    }
  }
}
