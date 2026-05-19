import type { PIEvent } from '@agent-chat/protocol'
import type { PiClient } from './client'
import * as topicRepo from '../db/repos/topic.repo'
import * as messageRepo from '../db/repos/message.repo'
import * as interactionRepo from '../db/repos/interaction.repo'
import * as artifactRepo from '../db/repos/artifact.repo'
import { artifactToPayload } from '../ws/artifact-control'
import * as usageRepo from '../db/repos/usage.repo'
import * as cronRepo from '../db/repos/cron.repo'
import * as pushRepo from '../db/repos/push-subscription.repo'
import { buildVapidAuthHeader } from '../lib/vapid'
import { encryptPushPayload } from '../lib/web-push'
import type { AppConfig } from '../config'
import { logger } from '../logger'

export interface EventBroadcaster {
  broadcast(type: string, data: unknown): void
}

export interface PushPayload {
  title: string
  body: string
  tag?: string
  url?: string
}

async function sendPushToAll(payload: PushPayload, config: AppConfig): Promise<void> {
  if (!config.vapidPublicKey || !config.vapidPrivateKey) return
  const subs = await pushRepo.listSubscriptions()
  if (subs.length === 0) return

  await Promise.all(
    subs.map(async (sub) => {
      try {
        const { body, contentEncoding } = await encryptPushPayload(
          JSON.stringify(payload),
          sub,
        )
        const authHeader = await buildVapidAuthHeader(
          sub.endpoint,
          config.vapidPrivateKey,
          config.vapidPublicKey,
          config.vapidSubject,
        )
        const res = await fetch(sub.endpoint, {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/octet-stream',
            'Content-Encoding': contentEncoding,
            TTL: '86400',
          },
          body,
        })
        if (res.ok) {
          logger.info({ endpoint: sub.endpoint.slice(0, 60) }, 'Push sent OK')
        } else {
          const text = await res.text().catch(() => '')
          logger.warn({ status: res.status, body: text.slice(0, 200), endpoint: sub.endpoint.slice(0, 60) }, 'Push send failed (HTTP)')
          // 410 Gone or 404 → subscription expired, remove it
          if (res.status === 410 || res.status === 404) {
            await pushRepo.deleteSubscription(sub.endpoint).catch(() => {})
          }
        }
      } catch (err) {
        logger.warn({ err, endpoint: sub.endpoint.slice(0, 60) }, 'Push send failed (exception)')
      }
    }),
  )
}

const lastSeqBySession = new Map<string, number>()
// Track current assistant messageId per session so error events can inject error text
const currentAssistantBySession = new Map<string, string>()
// Serialize events per session to prevent out-of-order broadcasts
const sessionQueues = new Map<string, Promise<void>>()

export function routePiEvents(
  pi: PiClient,
  broadcaster: EventBroadcaster,
  config?: AppConfig,
): void {
  pi.on('session.recreated', ({ sessionId }: { sessionId: string }) => {
    lastSeqBySession.delete(sessionId)
  })

  pi.on('event', (event: PIEvent) => {
    const lastSeq = lastSeqBySession.get(event.sessionId) ?? 0
    if (event.seq <= lastSeq) return
    lastSeqBySession.set(event.sessionId, event.seq)

    logger.info({ kind: event.payload.kind, sessionId: event.sessionId, seq: event.seq }, 'PI event received')
    const prev = sessionQueues.get(event.sessionId) ?? Promise.resolve()
    sessionQueues.set(event.sessionId, prev.then(() => routeEvent(event, broadcaster, config)).catch((err) => {
      logger.error({ err, kind: event.payload.kind }, 'Error routing PI event')
    }))
  })
}

async function findTopicIdBySession(sessionId: string): Promise<string | null> {
  const topics = await topicRepo.listTopics()
  const match = topics.find((t) => t.pi_session_id === sessionId)
  return match?.id ?? null
}

async function routeEvent(event: PIEvent, hub: EventBroadcaster, config?: AppConfig): Promise<void> {
  const payload = event.payload
  const sessionId = event.sessionId
  const topicId = await findTopicIdBySession(sessionId)

  switch (payload.kind) {
    case 'message.start': {
      if (!topicId) return
      let msg = await messageRepo.getMessage(payload.messageId)
      if (!msg) {
        msg = await messageRepo.createMessage({
          topicId,
          role: 'assistant',
          id: payload.messageId,
        })
      }
      currentAssistantBySession.set(sessionId, msg.id)
      hub.broadcast('message.start', {
        topicId,
        messageId: msg.id,
        role: 'assistant',
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
      hub.broadcast('message.delta', {
        topicId,
        messageId: payload.messageId,
        part: payload.part,
      })
      break
    }

    case 'message.end': {
      if (!topicId) return
      await messageRepo.flushParts()

      // If the SDK returned an error, inject the error text as a text part before finalizing
      if (payload.stopReason === 'error' && payload.errorMessage) {
        const errorText = payload.errorMessage
        await messageRepo.createMessagePart({
          messageId: payload.messageId,
          kind: 'text',
          contentJson: JSON.stringify({ content: errorText }),
        })
        hub.broadcast('message.delta', {
          topicId,
          messageId: payload.messageId,
          part: { kind: 'text', content: errorText },
        })
      }

      await messageRepo.updateMessage(payload.messageId, {
        status: 'done',
        finished_at: Date.now(),
        stop_reason: payload.stopReason,
      })
      hub.broadcast('message.end', {
        topicId,
        messageId: payload.messageId,
        stopReason: payload.stopReason,
      })
      // Derive agent.status idle as a defensive fallback when adapter forgets to push it
      // (e.g. CLI crash / forceEnd / keepalive timeout paths — see AIT-137).
      // Skip 'tool_use' because the agent is still working: a tool.result will follow.
      if (payload.stopReason !== 'tool_use') {
        hub.broadcast('agent.status', { topicId, state: 'idle' })
      }
      if (config) {
        const topic = await topicRepo.getTopic(topicId)
        sendPushToAll(
          { title: 'agent-chat', body: `${topic?.name ?? '话题'} 有新回复`, tag: `msg-${topicId}`, url: `/?topic=${topicId}` },
          config,
        ).catch(() => {})
      }
      break
    }

    case 'tool.call': {
      if (!topicId) return
      if (!(await messageRepo.getMessage(payload.messageId))) break
      await messageRepo.createMessagePart({
        messageId: payload.messageId,
        kind: 'tool_use',
        contentJson: JSON.stringify({
          toolUseId: payload.toolUseId,
          name: payload.name,
          input: payload.input,
        }),
      })
      hub.broadcast('tool.call', {
        topicId,
        toolUseId: payload.toolUseId,
        messageId: payload.messageId,
        name: payload.name,
        input: payload.input,
      })
      break
    }

    case 'tool.result': {
      if (!topicId) return
      if (!(await messageRepo.getMessage(payload.messageId))) break
      await messageRepo.createMessagePart({
        messageId: payload.messageId,
        kind: 'tool_result',
        contentJson: JSON.stringify({
          toolUseId: payload.toolUseId,
          output: payload.output,
          isError: payload.isError,
        }),
      })
      hub.broadcast('tool.result', {
        topicId,
        toolUseId: payload.toolUseId,
        messageId: payload.messageId,
        output: payload.output,
        isError: payload.isError,
      })
      break
    }

    case 'file.diff': {
      if (!topicId) return
      await messageRepo.createMessagePart({
        messageId: payload.messageId,
        kind: 'file_diff',
        contentJson: JSON.stringify({
          path: payload.path,
          before: payload.before,
          after: payload.after,
        }),
      })
      hub.broadcast('file.diff', {
        topicId,
        messageId: payload.messageId,
        path: payload.path,
        before: payload.before,
        after: payload.after,
      })
      break
    }

    case 'todo.update': {
      if (!topicId) return
      hub.broadcast('todo.update', { topicId, items: payload.items })
      break
    }

    case 'plan.update': {
      if (!topicId) return
      hub.broadcast('plan.update', { topicId, plan: payload.plan })
      break
    }

    case 'interaction.request': {
      if (!topicId) return
      const interaction = await interactionRepo.createInteraction({
        topicId,
        messageId: payload.messageId,
        kind: payload.interactionKind,
        prompt: payload.prompt,
        optionsJson: payload.options
          ? JSON.stringify(payload.options)
          : null,
      })
      hub.broadcast('interaction.request', {
        topicId,
        interactionId: interaction.id,
        messageId: payload.messageId,
        interactionKind: payload.interactionKind,
        prompt: payload.prompt,
        options: payload.options,
        defaultTimeoutMs: payload.defaultTimeoutMs,
      })
      if (config) {
        sendPushToAll(
          { title: 'agent-chat · 需要审批', body: payload.prompt.slice(0, 120), tag: `approval-${interaction.id}`, url: `/?topic=${topicId}` },
          config,
        ).catch(() => {})
      }
      break
    }

    case 'agent.status': {
      if (!topicId) return
      hub.broadcast('agent.status', { topicId, state: payload.state })
      break
    }

    case 'agent.progress': {
      if (!topicId) return
      hub.broadcast('agent.progress', {
        topicId,
        phase: payload.phase,
        message: payload.message,
        metadata: payload.metadata,
      })
      break
    }

    case 'cron.created': {
      const originTopicId = await findTopicIdBySession(payload.originSessionId)
      if (!originTopicId) {
        logger.warn(
          { originSessionId: payload.originSessionId },
          'Cron created but origin session not found',
        )
        return
      }
      const existing = await cronRepo.getCronJobByPiCronId(payload.cronId)
      if (existing) {
        await cronRepo.updateCronJob(existing.id, {
          status: payload.status,
          cron_expr: payload.cronExpr,
          prompt: payload.prompt,
          next_run_at: payload.nextRunAt,
        })
      } else {
        await cronRepo.createCronJob({
          originTopicId,
          piCronId: payload.cronId,
          cronExpr: payload.cronExpr,
          prompt: payload.prompt,
          status: payload.status,
          nextRunAt: payload.nextRunAt,
        })
      }
      const job = await cronRepo.getCronJobByPiCronId(payload.cronId)
      if (job) {
        hub.broadcast('cron.upserted', {
          cronId: job.id,
          originTopicId: job.origin_topic_id,
          cronExpr: job.cron_expr,
          prompt: job.prompt,
          status: job.status,
          lastRunAt: undefined,
          nextRunAt: job.next_run_at ?? undefined,
        })
      }
      break
    }

    case 'cron.triggered': {
      const originTopicId = await findTopicIdBySession(payload.originSessionId)
      if (!originTopicId) {
        logger.warn(
          { originSessionId: payload.originSessionId },
          'Cron triggered but origin session not found',
        )
        return
      }
      const cronRun = await cronRepo.createCronRun({
        cronId: payload.cronId,
        triggeredAt: payload.firedAt,
      })
      hub.broadcast('cron.triggered', {
        cronId: payload.cronId,
        originTopicId,
        runId: payload.runId || cronRun.id,
        firedAt: payload.firedAt,
      })
      break
    }

    case 'usage.delta': {
      await usageRepo.createUsageRecord({
        topicId,
        messageId: payload.messageId,
        model: payload.model,
        inputTokens: payload.inputTokens,
        outputTokens: payload.outputTokens,
      })
      break
    }

    case 'artifact.created': {
      logger.info(
        {
          artifactId: payload.artifactId,
          name: payload.name,
          metadata: payload.metadata,
          sessionId,
          topicId,
        },
        'PI artifact.created payload received',
      )
      if (await artifactRepo.getArtifact(payload.artifactId)) break
      const artifact = await artifactRepo.createArtifact({
        id: payload.artifactId,
        topicId,
        originTopicId: topicId,
        name: payload.name,
        mime: payload.mime,
        sizeBytes: payload.sizeBytes,
        r2Key: payload.r2Key ?? '',
        source: 'generated',
        metadataJson: payload.metadata
          ? JSON.stringify(payload.metadata)
          : undefined,
      })
      hub.broadcast('artifact.added', artifactToPayload(artifact))
      break
    }

    case 'error': {
      if (!topicId) {
        hub.broadcast('error', { code: payload.code, message: payload.message })
        break
      }
      const errorText = `[${payload.code}] ${payload.message}`
      const errMsg = await messageRepo.createMessage({ topicId, role: 'system' })
      await messageRepo.createMessagePart({
        messageId: errMsg.id,
        kind: 'text',
        contentJson: JSON.stringify({ content: errorText }),
      })
      await messageRepo.updateMessage(errMsg.id, {
        status: 'done',
        finished_at: Date.now(),
        stop_reason: 'error',
      })
      hub.broadcast('message.start', { topicId, messageId: errMsg.id, role: 'system' })
      hub.broadcast('message.delta', { topicId, messageId: errMsg.id, part: { kind: 'text', content: errorText } })
      hub.broadcast('message.end', { topicId, messageId: errMsg.id, stopReason: 'error' })
      break
    }

    case 'session.health': {
      if (!topicId) return
      hub.broadcast('session.health', {
        topicId,
        state: payload.state,
        piSessionId: payload.piSessionId,
        lastError: payload.lastError,
      })
      if (payload.state === 'disconnected') {
        const finalized = await messageRepo.finalizeStaleMessagesByTopic(topicId)
        for (const messageId of finalized) {
          await messageRepo.flushParts()
          hub.broadcast('message.end', { topicId, messageId, stopReason: 'error' })
        }
      }
      break
    }

    case 'cron.run.completed': {
      const job = await cronRepo.getCronJob(payload.cronId)
      if (!job) {
        logger.warn({ cronId: payload.cronId }, 'cron.run.completed: cron job not found')
        return
      }
      const runs = await cronRepo.listCronRuns(payload.cronId)
      const runningRun = runs.find((r) => r.status === 'running')
      if (runningRun) {
        await cronRepo.updateCronRun(runningRun.id, {
          status: payload.status,
          finished_at: payload.completedAt,
        })
      }
      hub.broadcast('cron.run.completed', {
        cronId: payload.cronId,
        runId: payload.runId,
        originTopicId: job.origin_topic_id,
        status: payload.status,
        summary: payload.summary,
        duration: payload.duration,
        completedAt: payload.completedAt,
      })
      if (config) {
        const statusLabel = payload.status === 'success' ? '完成' : '失败'
        sendPushToAll(
          { title: `定时任务${statusLabel}`, body: payload.summary?.slice(0, 120) ?? job.prompt.slice(0, 120), tag: `cron-${payload.cronId}`, url: `/?topic=${job.origin_topic_id}` },
          config,
        ).catch(() => {})
      }
      break
    }

    default: {
      logger.warn({ kind: (payload as Record<string, unknown>).kind }, 'Unknown PI event kind')
    }
  }
}
