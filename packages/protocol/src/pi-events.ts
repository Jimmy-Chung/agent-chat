import { z } from 'zod'

// ─── TodoItem schema ─────────────────────────────────────────────

export const todoItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed']),
  activeForm: z.string().optional(),
})

export type TodoItemZ = z.infer<typeof todoItemSchema>

// ─── PartDelta ────────────────────────────────────────────────────

export const textDeltaSchema = z.object({
  kind: z.literal('text'),
  content: z.string(),
})

export const thinkingDeltaSchema = z.object({
  kind: z.literal('thinking'),
  content: z.string(),
})

export const toolInputDeltaSchema = z.object({
  kind: z.literal('tool_input'),
  toolUseId: z.string(),
  partial: z.string(),
})

export const partDeltaSchema = z.discriminatedUnion('kind', [
  textDeltaSchema,
  thinkingDeltaSchema,
  toolInputDeltaSchema,
])

export type PartDelta = z.infer<typeof partDeltaSchema>

export type TextDelta = z.infer<typeof textDeltaSchema>
export type ThinkingDelta = z.infer<typeof thinkingDeltaSchema>
export type ToolInputDelta = z.infer<typeof toolInputDeltaSchema>

// ─── PI Event Payloads ────────────────────────────────────────────

export const messageStartPayloadSchema = z.object({
  kind: z.literal('message.start'),
  messageId: z.string(),
  role: z.literal('assistant'),
})

export const messageDeltaPayloadSchema = z.object({
  kind: z.literal('message.delta'),
  messageId: z.string(),
  part: partDeltaSchema,
})

export const messageEndPayloadSchema = z.object({
  kind: z.literal('message.end'),
  messageId: z.string(),
  stopReason: z.enum([
    'end_turn',
    'max_tokens',
    'tool_use',
    'aborted',
    'error',
  ]),
  errorMessage: z.string().optional(),
})

export const toolCallPayloadSchema = z.object({
  kind: z.literal('tool.call'),
  toolUseId: z.string(),
  messageId: z.string(),
  name: z.string(),
  input: z.unknown(),
})

export const toolResultPayloadSchema = z.object({
  kind: z.literal('tool.result'),
  toolUseId: z.string(),
  messageId: z.string(),
  output: z.unknown(),
  isError: z.boolean(),
})

export const fileDiffPayloadSchema = z.object({
  kind: z.literal('file.diff'),
  messageId: z.string(),
  path: z.string(),
  before: z.string(),
  after: z.string(),
})

export const todoUpdatePayloadSchema = z.object({
  kind: z.literal('todo.update'),
  items: z.array(todoItemSchema),
})

export const planUpdatePayloadSchema = z.object({
  kind: z.literal('plan.update'),
  plan: z.string(),
})

export const interactionRequestPayloadSchema = z.object({
  kind: z.literal('interaction.request'),
  interactionId: z.string(),
  messageId: z.string().optional(),
  interactionKind: z.enum(['approval', 'choice']),
  prompt: z.string(),
  options: z.array(z.string()).optional(),
  defaultTimeoutMs: z.number().optional(),
})

export const agentStatusPayloadSchema = z.object({
  kind: z.literal('agent.status'),
  // Accept adapter state values; server maps before broadcasting to WS
  state: z.enum(['idle', 'processing', 'aborting', 'thinking', 'streaming', 'tool', 'waiting_for_user']),
  phase: z.enum(['thinking', 'streaming', 'tool_use']).optional(),
})

export const agentProgressPayloadSchema = z.object({
  kind: z.literal('agent.progress'),
  phase: z.string(),
  message: z.string(),
  metadata: z.record(z.unknown()).optional(),
})

export const cronCreatedPayloadSchema = z.object({
  kind: z.literal('cron.created'),
  cronId: z.string(),
  originSessionId: z.string(),
  cronExpr: z.string(),
  prompt: z.string(),
  status: z.enum(['active', 'paused', 'error']),
  nextRunAt: z.number().optional(),
})

export const cronTriggeredPayloadSchema = z.object({
  kind: z.literal('cron.triggered'),
  cronId: z.string(),
  originSessionId: z.string(),
  runId: z.string(),
  firedAt: z.number(),
})

export const usageDeltaPayloadSchema = z.object({
  kind: z.literal('usage.delta'),
  messageId: z.string(),
  model: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number().optional(),
  cacheCreateTokens: z.number().optional(),
})

export const artifactCreatedPayloadSchema = z.object({
  kind: z.literal('artifact.created'),
  artifactId: z.string(),
  name: z.string(),
  mime: z.string().optional(),
  sizeBytes: z.number().optional(),
  r2Key: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
})

export const errorPayloadSchema = z.object({
  kind: z.literal('error'),
  code: z.string(),
  message: z.string(),
  recoverable: z.boolean(),
})

export const sessionHealthPayloadSchema = z.object({
  kind: z.literal('session.health'),
  state: z.enum(['connected', 'disconnected', 'reconnecting']),
  piSessionId: z.string(),
  lastError: z.string().optional(),
})

export const cronRunCompletedPayloadSchema = z.object({
  kind: z.literal('cron.run.completed'),
  cronId: z.string(),
  runId: z.string(),
  status: z.enum(['success', 'failed', 'timeout']),
  summary: z.string().nullable(),
  duration: z.number().nullable(),
  completedAt: z.number(),
})

export const cronUpdatedPayloadSchema = z.object({
  kind: z.literal('cron.updated'),
  cronId: z.string(),
  status: z.enum(['active', 'paused', 'error']),
  nextRunAt: z.number().optional(),
})

export const cronDeletedPayloadSchema = z.object({
  kind: z.literal('cron.deleted'),
  cronId: z.string(),
})

export const keepalivePayloadSchema = z.object({
  kind: z.literal('keepalive'),
})

export const adapterReadyPayloadSchema = z.object({
  kind: z.literal('adapter.ready'),
  adapterInstanceId: z.string(),
  startupTime: z.number(),
  version: z.string(),
})

// ─── Payload type exports ─────────────────────────────────────────

export type MessageStartPayload = z.infer<typeof messageStartPayloadSchema>
export type MessageDeltaPayload = z.infer<typeof messageDeltaPayloadSchema>
export type MessageEndPayload = z.infer<typeof messageEndPayloadSchema>
export type ToolCallPayload = z.infer<typeof toolCallPayloadSchema>
export type ToolResultPayload = z.infer<typeof toolResultPayloadSchema>
export type FileDiffPayload = z.infer<typeof fileDiffPayloadSchema>
export type TodoUpdatePayload = z.infer<typeof todoUpdatePayloadSchema>
export type PlanUpdatePayload = z.infer<typeof planUpdatePayloadSchema>
export type InteractionRequestPayload = z.infer<
  typeof interactionRequestPayloadSchema
>
export type AgentStatusPayload = z.infer<typeof agentStatusPayloadSchema>
export type AgentProgressPayload = z.infer<typeof agentProgressPayloadSchema>
export type CronCreatedPayload = z.infer<typeof cronCreatedPayloadSchema>
export type CronTriggeredPayload = z.infer<typeof cronTriggeredPayloadSchema>
export type UsageDeltaPayload = z.infer<typeof usageDeltaPayloadSchema>
export type ArtifactCreatedPayload = z.infer<typeof artifactCreatedPayloadSchema>
export type ErrorPayload = z.infer<typeof errorPayloadSchema>
export type SessionHealthPayload = z.infer<typeof sessionHealthPayloadSchema>
export type CronRunCompletedPayload = z.infer<typeof cronRunCompletedPayloadSchema>
export type CronUpdatedPayload = z.infer<typeof cronUpdatedPayloadSchema>
export type CronDeletedPayload = z.infer<typeof cronDeletedPayloadSchema>
export type KeepalivePayload = z.infer<typeof keepalivePayloadSchema>
export type AdapterReadyPayload = z.infer<typeof adapterReadyPayloadSchema>

// ─── PIEvent ──────────────────────────────────────────────────────

export type PIPayload =
  | KeepalivePayload
  | MessageStartPayload
  | MessageDeltaPayload
  | MessageEndPayload
  | ToolCallPayload
  | ToolResultPayload
  | FileDiffPayload
  | TodoUpdatePayload
  | PlanUpdatePayload
  | InteractionRequestPayload
  | AgentStatusPayload
  | AgentProgressPayload
  | CronCreatedPayload
  | CronTriggeredPayload
  | UsageDeltaPayload
  | ArtifactCreatedPayload
  | ErrorPayload
  | SessionHealthPayload
  | CronRunCompletedPayload
  | CronUpdatedPayload
  | CronDeletedPayload
  | AdapterReadyPayload

const payloadSchema = z.discriminatedUnion('kind', [
  keepalivePayloadSchema,
  messageStartPayloadSchema,
  messageDeltaPayloadSchema,
  messageEndPayloadSchema,
  toolCallPayloadSchema,
  toolResultPayloadSchema,
  fileDiffPayloadSchema,
  todoUpdatePayloadSchema,
  planUpdatePayloadSchema,
  interactionRequestPayloadSchema,
  agentStatusPayloadSchema,
  agentProgressPayloadSchema,
  cronCreatedPayloadSchema,
  cronTriggeredPayloadSchema,
  usageDeltaPayloadSchema,
  artifactCreatedPayloadSchema,
  errorPayloadSchema,
  sessionHealthPayloadSchema,
  cronRunCompletedPayloadSchema,
  cronUpdatedPayloadSchema,
  cronDeletedPayloadSchema,
  adapterReadyPayloadSchema,
])

export const piEventSchema = z.object({
  seq: z.number(),
  sessionId: z.string(),
  ts: z.number(),
  payload: payloadSchema,
})

export type PIEvent = {
  seq: number
  sessionId: string
  ts: number
  payload: PIPayload
}
