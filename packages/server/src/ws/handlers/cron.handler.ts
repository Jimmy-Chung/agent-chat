import type { WSFrame } from '@agent-chat/protocol'
import { cronPauseSchema, cronDeleteSchema, cronEditSchema, cronSyncSchema, topicSelectSchema } from '@agent-chat/protocol'
import type { PiClient } from '../../pi/client'
import * as cronRepo from '../../db/repos/cron.repo'
import * as topicRepo from '../../db/repos/topic.repo'
import { logger } from '../../logger'
import type { EventBroadcaster } from '../../pi/event-router'

async function findTopicByPiSessionId(sessionId: string): Promise<string | null> {
  const topics = await topicRepo.listTopics()
  const match = topics.find((t) => t.pi_session_id === sessionId)
  return match?.id ?? null
}

function cronJobToPayload(job: {
  id: string
  origin_topic_id: string
  pi_cron_id: string
  cron_expr: string
  prompt: string
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
    status: job.status,
    lastRunAt: undefined as number | undefined,
    nextRunAt: job.next_run_at ?? undefined,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  }
}

async function syncCronsFromPi(pi: PiClient): Promise<void> {
  const result = await pi.rpcGlobal('listCrons', {}) as Array<{
    cronId: string
    originSessionId: string
    cronExpr: string
    prompt: string
    status: string
    lastRunAt?: number
    nextRunAt?: number
  }>

  for (const c of result) {
    const originTopicId = await findTopicByPiSessionId(c.originSessionId)
    const existing = await cronRepo.getCronJobByPiCronId(c.cronId)
    if (existing) {
      await cronRepo.updateCronJob(existing.id, {
        status: c.status as 'active' | 'paused' | 'error',
        cron_expr: c.cronExpr,
        prompt: c.prompt,
        next_run_at: c.nextRunAt,
      })
    } else if (originTopicId) {
      await cronRepo.createCronJob({
        originTopicId,
        piCronId: c.cronId,
        cronExpr: c.cronExpr,
        prompt: c.prompt,
        status: c.status as 'active' | 'paused' | 'error',
        nextRunAt: c.nextRunAt,
      })
    } else {
      logger.warn({ cronId: c.cronId, originSessionId: c.originSessionId }, 'Cron missing origin topic during sync')
    }
  }
}

export function registerCronHandlers(
  hub: { on: (event: string, handler: (...args: unknown[]) => void) => void; sendToClient?: (ws: unknown, event: { type: string; data: unknown }) => void },
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
        data: { crons: jobs.map((j) => cronJobToPayload(j)) },
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
        data: { crons: jobs.map((j) => cronJobToPayload(j)) },
      })
    }
  })

  hub.on('client:cron.pause', async (...args: unknown[]) => {
    const frame = args[1] as WSFrame
    const data = cronPauseSchema.parse(frame.d)
    const job = await cronRepo.getCronJobByCronId(data.cronId)
    if (!job) return

    try {
      await pi.rpc('pauseCron', { cronId: data.cronId })
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
      await pi.rpc('deleteCron', { cronId: data.cronId })
    } catch (err) {
      logger.warn({ err }, 'Failed to delete cron on PI')
    }

    await cronRepo.deleteCronJob(job.id)
    const jobs = await cronRepo.listCronJobs()
    broadcaster.broadcast('cron.list', { crons: jobs.map((j) => cronJobToPayload(j)) })
  })

  hub.on('client:cron.edit', async (...args: unknown[]) => {
    const frame = args[1] as WSFrame
    const data = cronEditSchema.parse(frame.d)
    const job = await cronRepo.getCronJobByCronId(data.cronId)
    if (!job) return

    const updated = await cronRepo.updateCronJob(job.id, {
      ...(data.cronExpr ? { cron_expr: data.cronExpr } : {}),
      ...(data.prompt ? { prompt: data.prompt } : {}),
    })

    if (updated) {
      try {
        await pi.rpc('updateCron', {
          cronId: data.cronId,
          ...(data.cronExpr ? { cronExpr: data.cronExpr } : {}),
          ...(data.prompt ? { prompt: data.prompt } : {}),
        })
      } catch (err) {
        logger.warn({ err }, 'Failed to sync cron edit to PI')
      }

      broadcaster.broadcast('cron.upserted', cronJobToPayload(updated))
    }
  })
}
