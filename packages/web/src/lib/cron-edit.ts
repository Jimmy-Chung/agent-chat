// AIT-263 — build the `cron.edit` payload from the edit form, including only
// fields the user actually changed. Returns null when nothing changed (so the
// caller can skip the round-trip). Keeping this pure makes the "only changed
// fields are sent" behavior unit-testable.

export interface CronEditDraft {
  prompt: string
  cronExpr: string
  tagsText: string
}

export interface CronEditPayload {
  cronId: string
  prompt?: string
  cronExpr?: string
  tags?: string[]
}

export function buildCronEditPayload(
  cron: { cronId: string; prompt: string; cronExpr: string; tags?: string[] },
  draft: CronEditDraft,
): CronEditPayload | null {
  const trimmedPrompt = draft.prompt.trim()
  const trimmedExpr = draft.cronExpr.trim()
  const tags = draft.tagsText
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  const payload: CronEditPayload = { cronId: cron.cronId }
  if (trimmedPrompt && trimmedPrompt !== cron.prompt)
    payload.prompt = trimmedPrompt
  if (trimmedExpr && trimmedExpr !== cron.cronExpr)
    payload.cronExpr = trimmedExpr
  if (tags.join(',') !== (cron.tags ?? []).join(',')) payload.tags = tags

  if (
    payload.prompt === undefined &&
    payload.cronExpr === undefined &&
    payload.tags === undefined
  ) {
    return null
  }
  return payload
}
