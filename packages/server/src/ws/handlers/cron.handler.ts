import type { WSFrame } from '@agent-chat/protocol'
import { cronPauseSchema, cronDeleteSchema, cronEditSchema } from '@agent-chat/protocol'
import type { WsHub } from '../hub'
import type { PiClient } from '../../pi/client'
import * as cronRepo from '../../db/repos/cron.repo'
import { logger } from '../../logger'

export function registerCronHandlers(hub: WsHub, pi: PiClient): void {
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
        data: {
          cronId: updated.id,
          originTopicId: updated.origin_topic_id,
          cronExpr: updated.cron_expr,
          prompt: updated.prompt,
          status: updated.status,
        },
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
      hub.broadcast({
        type: 'cron.upserted',
        data: {
          cronId: updated.id,
          originTopicId: updated.origin_topic_id,
          cronExpr: updated.cron_expr,
          prompt: updated.prompt,
          status: updated.status,
        },
      })
    }
  })
}
