import type { WSFrame } from '@agent-chat/protocol'
import {
  cronDeleteSchema,
  cronEditSchema,
  cronPauseSchema,
  cronSyncSchema,
  topicSelectSchema,
} from '@agent-chat/protocol'
import * as cronRepo from '../../db/repos/cron.repo'
import * as topicRepo from '../../db/repos/topic.repo'
import { logger } from '../../logger'
import type { PiClient } from '../../pi/client'
import type { EventBroadcaster } from '../../pi/event-router'

async function findTopicByPiSessionId(
  sessionId: string,
): Promise<string | null> {
  const topics = await topicRepo.listTopics()
  const match = topics.find((t) => t.pi_session_id === sessionId)
  return match?.id ?? null
}

function cronJobToPayload(job: {
  id: string
  origin_topic_id: string | null
  pi_cron_id: string
  cron_expr: string
  prompt: string
  tags?: string[] | null
  status: string
  next_run_at: number | null
  created_at?: number
  updated_at?: number
}) {
  return {
    cronId: job.pi_cron_id,
    localCronId: job.id,
    originTopicId: job.origin_topic_id,
    cronExpr: job.cron_expr,
    prompt: job.prompt,
    tags: job.tags ?? undefined,
    status: job.status,
    lastRunAt: undefined as number | undefined,
    nextRunAt: job.next_run_at ?? undefined,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  }
}

async function cronRunsPayload() {
  const jobs = await cronRepo.listCronJobs()
  const runs = await Promise.all(jobs.map(async (job) => {
    const jobRuns = await cronRepo.listCronRuns(job.id)
    return jobRuns.map((run) => ({
      id: run.id,
      cronId: job.pi_cron_id,
      localCronId: job.id,
      triggeredAt: run.triggered_at,
      firedAt: run.triggered_at,
      status: run.status,
      summary: run.summary,
      duration: run.duration_ms,
      completedAt: run.finished_at ?? undefined,
    }))
  }))
  return runs.flat()
}

async function syncCronsFromPi(pi: PiClient): Promise<void> {
  const result = (await pi.rpcGlobal('listCrons', {})) as Array<{
    cronId: string
    originTopicId?: string
    originSessionId: string
    cronExpr: string
    prompt: string
    tags?: string[]
    status: string
    lastRunAt?: number
    nextRunAt?: number
  }>

  for (const c of result) {
    const originTopicId =
      c.originTopicId ?? (await findTopicByPiSessionId(c.originSessionId))
    const existing = await cronRepo.getCronJobByPiCronId(c.cronId)
    if (existing) {
      await cronRepo.updateCronJob(existing.id, {
        ...(originTopicId && existing.origin_topic_id !== originTopicId
          ? { origin_topic_id: originTopicId }
          : {}),
        status: c.status as 'active' | 'paused' | 'error',
        cron_expr: c.cronExpr,
        prompt: c.prompt,
        next_run_at: c.nextRunAt,
        tags: c.tags,
      })
    } else {
      await cronRepo.createCronJob({
        originTopicId,
        piCronId: c.cronId,
        cronExpr: c.cronExpr,
        prompt: c.prompt,
        tags: c.tags,
        status: c.status as 'active' | 'paused' | 'error',
        nextRunAt: c.nextRunAt,
      })
      if (!originTopicId) {
        logger.warn(
          { cronId: c.cronId, originSessionId: c.originSessionId },
          'Cron synced without origin topic',
        )
      }
    }
  }
}

export function registerCronHandlers(
  hub: {
    on: (event: string, handler: (...args: unknown[]) => void) => void
    sendToClient?: (ws: unknown, event: { type: string; data: unknown }) => void
  },
  pi: PiClient,
  broadcaster: EventBroadcaster,
): void {
  hub.on('client:topic.select', async (...args: unknown[]) => {
    const conn = args[0]
    const frame = args[1] as WSFrame
    const data = topicSelectSchema.parse(frame.d)
    if (data.topicId !== 'system_cron_admin') return

    try {
      await syncCronsFromPi(pi)
    } catch (err) {
      logger.warn({ err }, 'Failed to sync crons from PI')
    }

    const jobs = await cronRepo.listCronJobs()
    if (hub.sendToClient) {
      hub.sendToClient(conn, {
        type: 'cron.list',
        data: { crons: jobs.map((j) => cronJobToPayload(j)), runs: await cronRunsPayload() },
      })
    }
  })

  hub.on('client:cron.sync', async (...args: unknown[]) => {
    const conn = args[0]
    const frame = args[1] as WSFrame
    cronSyncSchema.parse(frame.d)

    try {
      await syncCronsFromPi(pi)
    } catch (err) {
      logger.warn({ err }, 'Failed to sync crons from PI')
    }

    const jobs = await cronRepo.listCronJobs()
    if (hub.sendToClient) {
      hub.sendToClient(conn, {
        type: 'cron.list',
        data: { crons: jobs.map((j) => cronJobToPayload(j)), runs: await cronRunsPayload() },
      })
    }
  })

  hub.on('client:cron.pause', async (...args: unknown[]) => {
    const frame = args[1] as WSFrame
    const data = cronPauseSchema.parse(frame.d)
    const job = await cronRepo.getCronJobByCronId(data.cronId)
    if (!job) return

    try {
      await pi.rpcGlobal('pauseCron', { cronId: data.cronId })
    } catch (err) {
      logger.warn({ err }, 'Failed to pause cron on PI')
    }

    const updated = await cronRepo.updateCronJob(job.id, { status: 'paused' })
    if (updated) {
      broadcaster.broadcast('cron.upserted', cronJobToPayload(updated))
    }
  })

  hub.on('client:cron.delete', async (...args: unknown[]) => {
    const frame = args[1] as WSFrame
    const data = cronDeleteSchema.parse(frame.d)
    const job = await cronRepo.getCronJobByCronId(data.cronId)
    if (!job) return

    try {
      await pi.rpcGlobal('deleteCron', { cronId: data.cronId })
    } catch (err) {
      logger.warn({ err }, 'Failed to delete cron on PI')
    }

    await cronRepo.deleteCronJob(job.id)
    const jobs = await cronRepo.listCronJobs()
    broadcaster.broadcast('cron.list', {
      crons: jobs.map((j) => cronJobToPayload(j)),
      runs: await cronRunsPayload(),
    })
  })

  hub.on('client:cron.edit', async (...args: unknown[]) => {
    const frame = args[1] as WSFrame
    const data = cronEditSchema.parse(frame.d)
    const job = await cronRepo.getCronJobByCronId(data.cronId)
    if (!job) return

    const updated = await cronRepo.updateCronJob(job.id, {
      ...(data.cronExpr ? { cron_expr: data.cronExpr } : {}),
      ...(data.prompt ? { prompt: data.prompt } : {}),
      ...(data.tags !== undefined ? { tags: data.tags } : {}),
    })

    if (updated) {
      try {
        await pi.rpcGlobal('updateCron', {
          cronId: data.cronId,
          ...(data.cronExpr ? { cronExpr: data.cronExpr } : {}),
          ...(data.prompt ? { prompt: data.prompt } : {}),
          ...(data.tags !== undefined ? { tags: data.tags } : {}),
        })
      } catch (err) {
        logger.warn({ err }, 'Failed to sync cron edit to PI')
      }

      broadcaster.broadcast('cron.upserted', cronJobToPayload(updated))
    }
  })
}
