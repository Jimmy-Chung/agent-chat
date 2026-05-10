import { eq } from 'drizzle-orm'
import type { CronJob, CronRun } from '@agent-chat/protocol'
import { cronJobs, cronRuns } from '../schema'
import { getDb } from '../migrate'
import { ulid } from 'ulid'

// ─── CronJob CRUD ──────────────────────────────────────────────────

export function createCronJob(input: {
  originTopicId: string
  piCronId: string
  cronExpr: string
  prompt: string
  status?: CronJob['status']
  nextRunAt?: number | null
}): CronJob {
  const now = Date.now()
  const row = {
    id: ulid(),
    originTopicId: input.originTopicId,
    piCronId: input.piCronId,
    cronExpr: input.cronExpr,
    prompt: input.prompt,
    status: input.status ?? 'active',
    nextRunAt: input.nextRunAt ?? null,
    createdAt: now,
    updatedAt: now,
  }
  getDb().insert(cronJobs).values(row).run()
  return toJobDomain(row)
}

export function getCronJob(id: string): CronJob | undefined {
  const rows = getDb()
    .select()
    .from(cronJobs)
    .where(eq(cronJobs.id, id))
    .all()
  return rows[0] ? toJobDomain(rows[0]) : undefined
}

export function listCronJobs(): CronJob[] {
  const rows = getDb().select().from(cronJobs).all()
  return rows.map(toJobDomain)
}

export function updateCronJob(
  id: string,
  data: Partial<
    Pick<CronJob, 'status' | 'next_run_at' | 'cron_expr' | 'prompt' | 'pi_cron_id'>
  >,
): CronJob | undefined {
  const updates: Record<string, unknown> = { updatedAt: Date.now() }
  if (data.status !== undefined) updates.status = data.status
  if (data.next_run_at !== undefined) updates.nextRunAt = data.next_run_at
  if (data.cron_expr !== undefined) updates.cronExpr = data.cron_expr
  if (data.prompt !== undefined) updates.prompt = data.prompt
  if (data.pi_cron_id !== undefined) updates.piCronId = data.pi_cron_id

  getDb()
    .update(cronJobs)
    .set(updates)
    .where(eq(cronJobs.id, id))
    .run()
  return getCronJob(id)
}

export function deleteCronJob(id: string): boolean {
  const result = getDb()
    .delete(cronJobs)
    .where(eq(cronJobs.id, id))
    .run()
  return result.changes > 0
}

export function getCronJobByPiCronId(piCronId: string): CronJob | undefined {
  const rows = getDb()
    .select()
    .from(cronJobs)
    .where(eq(cronJobs.piCronId, piCronId))
    .all()
  return rows[0] ? toJobDomain(rows[0]) : undefined
}

// ─── CronRun CRUD ──────────────────────────────────────────────────

export function createCronRun(input: {
  cronId: string
  triggeredAt?: number
}): CronRun {
  const row = {
    id: ulid(),
    cronId: input.cronId,
    triggeredAt: input.triggeredAt ?? Date.now(),
    finishedAt: null,
    status: 'running' as const,
    resultMessageId: null,
  }
  getDb().insert(cronRuns).values(row).run()
  return toRunDomain(row)
}

export function updateCronRun(
  id: string,
  data: Partial<
    Pick<CronRun, 'status' | 'finished_at' | 'result_message_id'>
  >,
): void {
  const updates: Record<string, unknown> = {}
  if (data.status !== undefined) updates.status = data.status
  if (data.finished_at !== undefined) updates.finishedAt = data.finished_at
  if (data.result_message_id !== undefined)
    updates.resultMessageId = data.result_message_id

  if (Object.keys(updates).length > 0) {
    getDb()
      .update(cronRuns)
      .set(updates)
      .where(eq(cronRuns.id, id))
      .run()
  }
}

export function listCronRuns(cronId: string): CronRun[] {
  const rows = getDb()
    .select()
    .from(cronRuns)
    .where(eq(cronRuns.cronId, cronId))
    .all()
  return rows.map(toRunDomain)
}

// ─── Helpers ───────────────────────────────────────────────────────

function toJobDomain(row: Record<string, unknown>): CronJob {
  return {
    id: row.id as string,
    origin_topic_id: row.originTopicId as string,
    pi_cron_id: row.piCronId as string,
    cron_expr: row.cronExpr as string,
    prompt: row.prompt as string,
    status: row.status as CronJob['status'],
    next_run_at: (row.nextRunAt as number) || null,
    created_at: row.createdAt as number,
    updated_at: row.updatedAt as number,
  }
}

function toRunDomain(row: Record<string, unknown>): CronRun {
  return {
    id: row.id as string,
    cron_id: row.cronId as string,
    triggered_at: row.triggeredAt as number,
    finished_at: (row.finishedAt as number) || null,
    status: row.status as CronRun['status'],
    result_message_id: (row.resultMessageId as string) || null,
  }
}
