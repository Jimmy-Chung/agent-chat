import type { WSFrame } from '@agent-chat/protocol'
import { cronPauseSchema, cronDeleteSchema, cronEditSchema, topicSelectSchema } from '@agent-chat/protocol'
import type { WsHub } from '../hub'
import type { PiClient } from '../../pi/client'
import * as cronRepo from '../../db/repos/cron.repo'
import * as topicRepo from '../../db/repos/topic.repo'
import { logger } from '../../logger'

function findTopicByPiSessionId(sessionId: string): string | null {
  const topics = topicRepo.listTopics()
  const match = topics.find((t) => t.pi_session_id === sessionId)
  return match?.id ?? null
}

function cronJobToPayload(job: ReturnType<typeof cronRepo.getCronJob>) {
  const runs = cronRepo.listCronRuns(job!.id)
  const lastRun = runs.length > 0 ? runs[runs.length - 1] : null
  return {
    cronId: job!.id,
    originTopicId: job!.origin_topic_id,
    cronExpr: job!.cron_expr,
    prompt: job!.prompt,
    status: job!.status,
    lastRunAt: lastRun?.triggered_at ?? undefined,
    nextRunAt: job!.next_run_at ?? undefined,
  }
}

export function registerCronHandlers(hub: WsHub, pi: PiClient): void {
  // Send cron list when client opens cron admin topic
  hub.on('client:topic.select', async (conn, frame: WSFrame) => {
    const data = topicSelectSchema.parse(frame.d)
    if (data.topicId !== 'system_cron_admin') return

    // Sync crons from PI
    try {
      const result = await pi.rpc('listCrons', {}) as Array<{
        cronId: string
        originSessionId: string
        cronExpr: string
        prompt: string
        status: string
        lastRunAt?: number
        nextRunAt?: number
      }>

      for (const c of result) {
        const originTopicId = findTopicByPiSessionId(c.originSessionId)
        const existing = cronRepo.getCronJobByPiCronId(c.cronId)
        if (existing) {
          cronRepo.updateCronJob(existing.id, {
            status: c.status as 'active' | 'paused' | 'error',
            cron_expr: c.cronExpr,
            prompt: c.prompt,
            next_run_at: c.nextRunAt,
          })
        } else if (originTopicId) {
          cronRepo.createCronJob({
            originTopicId,
            piCronId: c.cronId,
            cronExpr: c.cronExpr,
            prompt: c.prompt,
            status: c.status as 'active' | 'paused' | 'error',
            nextRunAt: c.nextRunAt,
          })
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to sync crons from PI')
    }

    const jobs = cronRepo.listCronJobs()
    hub.sendToClient(conn.ws, {
      type: 'cron.list',
      data: {
        crons: jobs.map((j) => cronJobToPayload(j)),
      },
    })
  })

  hub.on('client:cron.pause', async (_conn, frame: WSFrame) => {
    const data = cronPauseSchema.parse(frame.d)
    const job = cronRepo.getCronJob(data.cronId)
    if (!job) return

    try {
      await pi.rpc('pauseCron', { cronId: job.pi_cron_id })
    } catch (err) {
      logger.warn({ err }, 'Failed to pause cron on PI')
    }

    const updated = cronRepo.updateCronJob(data.cronId, { status: 'paused' })
    if (updated) {
      hub.broadcast({
        type: 'cron.upserted',
        data: cronJobToPayload(updated),
      })
    }
  })

  hub.on('client:cron.delete', async (_conn, frame: WSFrame) => {
    const data = cronDeleteSchema.parse(frame.d)
    const job = cronRepo.getCronJob(data.cronId)
    if (!job) return

    try {
      await pi.rpc('deleteCron', { cronId: job.pi_cron_id })
    } catch (err) {
      logger.warn({ err }, 'Failed to delete cron on PI')
    }

    cronRepo.deleteCronJob(data.cronId)
    // Broadcast updated list after deletion
    const jobs = cronRepo.listCronJobs()
    hub.broadcast({
      type: 'cron.list',
      data: {
        crons: jobs.map((j) => cronJobToPayload(j)),
      },
    })
  })

  hub.on('client:cron.edit', async (_conn, frame: WSFrame) => {
    const data = cronEditSchema.parse(frame.d)
    const job = cronRepo.getCronJob(data.cronId)
    if (!job) return

    const updated = cronRepo.updateCronJob(data.cronId, {
      ...(data.cronExpr ? { cron_expr: data.cronExpr } : {}),
      ...(data.prompt ? { prompt: data.prompt } : {}),
    })

    if (updated) {
      // Sync to PI via delete + recreate
      try {
        const topic = topicRepo.getTopic(job.origin_topic_id)
        if (topic?.pi_session_id) {
          await pi.rpc('deleteCron', { cronId: job.pi_cron_id })
          const result = await pi.rpc('createCron', {
            originSessionId: topic.pi_session_id,
            cronExpr: updated.cron_expr,
            prompt: updated.prompt,
          }) as { cronId: string }
          if (result.cronId && result.cronId !== job.pi_cron_id) {
            cronRepo.updateCronJob(updated.id, { pi_cron_id: result.cronId })
          }
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to sync cron edit to PI')
      }

      hub.broadcast({
        type: 'cron.upserted',
        data: cronJobToPayload(updated),
      })
    }
  })
}
