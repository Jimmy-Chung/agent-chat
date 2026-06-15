import { eq } from 'drizzle-orm'
import type { CronJob, CronRun } from '@agent-chat/protocol'
import { cronJobs, cronRuns } from '../schema'
import { getDb } from '../migrate'
import { ulid } from '../../lib/ulid'

// ─── CronJob CRUD ──────────────────────────────────────────────────

export async function createCronJob(input: {
  originTopicId: string | null
  piCronId: string
  cronExpr: string
  prompt: string
  tags?: string[]
  status?: CronJob['status']
  nextRunAt?: number | null
}): Promise<CronJob> {
  const now = Date.now()
  const row = {
    id: ulid(),
    originTopicId: input.originTopicId,
    piCronId: input.piCronId,
    cronExpr: input.cronExpr,
    prompt: input.prompt,
    tagsJson: input.tags ? JSON.stringify(input.tags) : null,
    status: input.status ?? 'active',
    nextRunAt: input.nextRunAt ?? null,
    createdAt: now,
    updatedAt: now,
  }
  await getDb().insert(cronJobs).values(row).run()
  return toJobDomain(row)
}

export async function getCronJob(id: string): Promise<CronJob | undefined> {
  const rows = await getDb()
    .select()
    .from(cronJobs)
    .where(eq(cronJobs.id, id))
    .all()
  return rows[0] ? toJobDomain(rows[0]) : undefined
}

export async function getCronJobByCronId(cronId: string): Promise<CronJob | undefined> {
  return (await getCronJobByPiCronId(cronId)) ?? (await getCronJob(cronId))
}

export async function listCronJobs(): Promise<CronJob[]> {
  const rows = await getDb().select().from(cronJobs).all()
  return rows.map(toJobDomain)
}

export async function updateCronJob(
  id: string,
  data: Partial<
    Pick<CronJob, 'status' | 'next_run_at' | 'cron_expr' | 'prompt' | 'pi_cron_id' | 'tags'>
  >,
): Promise<CronJob | undefined> {
  const updates: Record<string, unknown> = { updatedAt: Date.now() }
  if (data.status !== undefined) updates.status = data.status
  if (data.next_run_at !== undefined) updates.nextRunAt = data.next_run_at
  if (data.cron_expr !== undefined) updates.cronExpr = data.cron_expr
  if (data.prompt !== undefined) updates.prompt = data.prompt
  if (data.pi_cron_id !== undefined) updates.piCronId = data.pi_cron_id
  if (data.tags !== undefined) updates.tagsJson = JSON.stringify(data.tags)

  await getDb()
    .update(cronJobs)
    .set(updates)
    .where(eq(cronJobs.id, id))
    .run()
  return getCronJob(id)
}

export async function deleteCronJob(id: string): Promise<boolean> {
  const result = await getDb()
    .delete(cronJobs)
    .where(eq(cronJobs.id, id))
    .run()
  const meta = result.meta as { rows_written?: number } | undefined
  return (meta?.rows_written ?? 0) > 0
}

export async function deleteCronJobByCronId(cronId: string): Promise<boolean> {
  const job = await getCronJobByCronId(cronId)
  if (!job) return false
  return deleteCronJob(job.id)
}

export async function getCronJobByPiCronId(piCronId: string): Promise<CronJob | undefined> {
  const rows = await getDb()
    .select()
    .from(cronJobs)
    .where(eq(cronJobs.piCronId, piCronId))
    .all()
  return rows[0] ? toJobDomain(rows[0]) : undefined
}

export async function createCronRunByCronId(input: {
  cronId: string
  runId?: string
  triggeredAt?: number
}): Promise<CronRun | undefined> {
  const job = await getCronJobByCronId(input.cronId)
  if (!job) return undefined
  return createCronRun({
    cronId: job.id,
    runId: input.runId,
    triggeredAt: input.triggeredAt,
  })
}

// ─── CronRun CRUD ──────────────────────────────────────────────────

export async function createCronRun(input: {
  cronId: string
  runId?: string
  triggeredAt?: number
}): Promise<CronRun> {
  const row = {
    id: input.runId ?? ulid(),
    cronId: input.cronId,
    triggeredAt: input.triggeredAt ?? Date.now(),
    finishedAt: null,
    status: 'running' as const,
    resultMessageId: null,
  }
  await getDb().insert(cronRuns).values(row).run()
  return toRunDomain(row)
}

export async function updateCronRun(
  id: string,
  data: Partial<
    Pick<CronRun, 'status' | 'finished_at' | 'result_message_id' | 'summary' | 'duration_ms'>
  >,
): Promise<void> {
  const updates: Record<string, unknown> = {}
  if (data.status !== undefined) updates.status = data.status
  if (data.finished_at !== undefined) updates.finishedAt = data.finished_at
  if (data.result_message_id !== undefined)
    updates.resultMessageId = data.result_message_id
  if (data.summary !== undefined) updates.summary = data.summary
  if (data.duration_ms !== undefined) updates.durationMs = data.duration_ms

  if (Object.keys(updates).length > 0) {
    await getDb()
      .update(cronRuns)
      .set(updates)
      .where(eq(cronRuns.id, id))
      .run()
  }
}

export async function getCronRun(id: string): Promise<CronRun | undefined> {
  const rows = await getDb()
    .select()
    .from(cronRuns)
    .where(eq(cronRuns.id, id))
    .all()
  return rows[0] ? toRunDomain(rows[0]) : undefined
}

export async function listCronRuns(cronId: string): Promise<CronRun[]> {
  const rows = await getDb()
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
    origin_topic_id: (row.originTopicId as string) || null,
    pi_cron_id: row.piCronId as string,
    cron_expr: row.cronExpr as string,
    prompt: row.prompt as string,
    tags: parseTags(row.tagsJson),
    status: row.status as CronJob['status'],
    next_run_at: (row.nextRunAt as number) || null,
    created_at: row.createdAt as number,
    updated_at: row.updatedAt as number,
  }
}

function parseTags(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : undefined
  } catch {
    return undefined
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
    summary: (row.summary as string) || null,
    duration_ms: (row.durationMs as number) || null,
  }
}
