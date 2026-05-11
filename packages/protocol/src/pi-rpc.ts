import { z } from 'zod'
import { todoItemSchema } from './pi-events'

// ─── Shared schemas ───────────────────────────────────────────────

const artifactRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  downloadUrl: z.string(),
})

export type ArtifactRefRpc = z.infer<typeof artifactRefSchema>

const okResultSchema = z.object({ ok: z.literal(true) })

// ─── Session lifecycle ────────────────────────────────────────────

export const programmingSpecSchema = z.object({
  extension: z.enum(['claude-code', 'codex']),
  yolo: z.boolean(),
  cwd: z.string(),
  permissionMode: z.enum([
    'default',
    'acceptEdits',
    'plan',
    'bypassPermissions',
  ]),
  systemPrompt: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
})

export type ProgrammingSpecRpc = z.infer<typeof programmingSpecSchema>

export const generalSpecSchema = z.object({
  systemPrompt: z.string().optional(),
  initialPlan: z.string().optional(),
  initialTodos: z.array(todoItemSchema).optional(),
  allowedTools: z.array(z.string()).optional(),
})

export type GeneralSpecRpc = z.infer<typeof generalSpecSchema>

// createSession
export const createSessionParamsSchema = z.object({
  kind: z.enum(['programming', 'general']),
  programming: programmingSpecSchema.optional(),
  general: generalSpecSchema.optional(),
  initialModel: z.string().optional(),
  workflowMode: z.enum(['lazy', 'eager', 'off']).optional(),
})

export const createSessionResultSchema = z.object({
  sessionId: z.string(),
})

export type CreateSessionParams = z.infer<typeof createSessionParamsSchema>
export type CreateSessionResult = z.infer<typeof createSessionResultSchema>

// attachSession
export const attachSessionParamsSchema = z.object({
  sessionId: z.string(),
  lastSeq: z.number().optional(),
})

export const attachSessionResultSchema = okResultSchema

export type AttachSessionParams = z.infer<typeof attachSessionParamsSchema>
export type AttachSessionResult = z.infer<typeof attachSessionResultSchema>

// detachExtension
export const detachExtensionParamsSchema = z.object({
  sessionId: z.string(),
})

export const detachExtensionResultSchema = okResultSchema

export type DetachExtensionParams = z.infer<typeof detachExtensionParamsSchema>
export type DetachExtensionResult = z.infer<typeof detachExtensionResultSchema>

// destroySession
export const destroySessionParamsSchema = z.object({
  sessionId: z.string(),
})

export const destroySessionResultSchema = okResultSchema

export type DestroySessionParams = z.infer<typeof destroySessionParamsSchema>
export type DestroySessionResult = z.infer<typeof destroySessionResultSchema>

// abortSession
export const abortSessionParamsSchema = z.object({
  sessionId: z.string(),
})

export const abortSessionResultSchema = okResultSchema

export type AbortSessionParams = z.infer<typeof abortSessionParamsSchema>
export type AbortSessionResult = z.infer<typeof abortSessionResultSchema>

// ─── User input ───────────────────────────────────────────────────

// sendUserMessage
export const sendUserMessageParamsSchema = z.object({
  sessionId: z.string(),
  content: z.string(),
  mentionedArtifacts: z.array(artifactRefSchema).optional(),
})

export const sendUserMessageResultSchema = z.object({
  messageId: z.string(),
})

export type SendUserMessageParams = z.infer<typeof sendUserMessageParamsSchema>
export type SendUserMessageResult = z.infer<typeof sendUserMessageResultSchema>

// resolveInteraction
export const resolveInteractionParamsSchema = z.object({
  sessionId: z.string(),
  interactionId: z.string(),
  decision: z.enum(['approve', 'reject', 'choose']),
  choice: z.string().optional(),
  reason: z.string().optional(),
})

export const resolveInteractionResultSchema = okResultSchema

export type ResolveInteractionParams = z.infer<
  typeof resolveInteractionParamsSchema
>
export type ResolveInteractionResult = z.infer<
  typeof resolveInteractionResultSchema
>

// ─── Cron ─────────────────────────────────────────────────────────

// createCron
export const createCronParamsSchema = z.object({
  originSessionId: z.string(),
  cronExpr: z.string(),
  prompt: z.string(),
  timezone: z.string().optional(),
})

export const createCronResultSchema = z.object({
  cronId: z.string(),
  nextRunAt: z.number(),
})

export type CreateCronParams = z.infer<typeof createCronParamsSchema>
export type CreateCronResult = z.infer<typeof createCronResultSchema>

// listCrons
export const listCronsParamsSchema = z.object({})

const cronInfoSchema = z.object({
  cronId: z.string(),
  originSessionId: z.string(),
  cronExpr: z.string(),
  prompt: z.string(),
  status: z.enum(['active', 'paused', 'error']),
  lastRunAt: z.number().optional(),
  nextRunAt: z.number().optional(),
})

export type CronInfo = z.infer<typeof cronInfoSchema>

export const listCronsResultSchema = z.array(cronInfoSchema)

export type ListCronsParams = z.infer<typeof listCronsParamsSchema>
export type ListCronsResult = z.infer<typeof listCronsResultSchema>

// pauseCron
export const pauseCronParamsSchema = z.object({
  cronId: z.string(),
})

export const pauseCronResultSchema = okResultSchema

export type PauseCronParams = z.infer<typeof pauseCronParamsSchema>
export type PauseCronResult = z.infer<typeof pauseCronResultSchema>

// resumeCron
export const resumeCronParamsSchema = z.object({
  cronId: z.string(),
})

export const resumeCronResultSchema = okResultSchema

export type ResumeCronParams = z.infer<typeof resumeCronParamsSchema>
export type ResumeCronResult = z.infer<typeof resumeCronResultSchema>

// deleteCron
export const deleteCronParamsSchema = z.object({
  cronId: z.string(),
})

export const deleteCronResultSchema = okResultSchema

export type DeleteCronParams = z.infer<typeof deleteCronParamsSchema>
export type DeleteCronResult = z.infer<typeof deleteCronResultSchema>

// ─── Model / Usage ────────────────────────────────────────────────

// setSessionModel
export const setSessionModelParamsSchema = z.object({
  sessionId: z.string(),
  model: z.string(),
})

export const setSessionModelResultSchema = okResultSchema

export type SetSessionModelParams = z.infer<typeof setSessionModelParamsSchema>
export type SetSessionModelResult = z.infer<typeof setSessionModelResultSchema>

// setPlanMode — toggle session into read-only (Plan) mode
export const setPlanModeParamsSchema = z.object({
  sessionId: z.string(),
  planMode: z.boolean(),
})

export const setPlanModeResultSchema = okResultSchema

export type SetPlanModeParams = z.infer<typeof setPlanModeParamsSchema>
export type SetPlanModeResult = z.infer<typeof setPlanModeResultSchema>

// getUsage
export const getUsageParamsSchema = z.object({
  sessionId: z.string().optional(),
  from: z.number().optional(),
  to: z.number().optional(),
})

export const getUsageResultSchema = z.object({
  totalInputTokens: z.number(),
  totalOutputTokens: z.number(),
  byModel: z.record(
    z.string(),
    z.object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      costMicroUsd: z.number().optional(),
    }),
  ),
  bySession: z
    .record(
      z.string(),
      z.object({
        inputTokens: z.number(),
        outputTokens: z.number(),
      }),
    )
    .optional(),
})

export type GetUsageParams = z.infer<typeof getUsageParamsSchema>
export type GetUsageResult = z.infer<typeof getUsageResultSchema>

// ─── RPC envelope ─────────────────────────────────────────────────

export const rpcRequestSchema = z.object({
  method: z.string(),
  params: z.unknown(),
})

export type RpcRequest = z.infer<typeof rpcRequestSchema>

export const rpcResultSchema = z.object({
  result: z.unknown(),
})

export type RpcResult = z.infer<typeof rpcResultSchema>

export const rpcErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
})

export type RpcError = z.infer<typeof rpcErrorSchema>

// ─── Method name mapping ──────────────────────────────────────────

export type PiRpcMethod = {
  createSession: {
    params: CreateSessionParams
    result: CreateSessionResult
  }
  attachSession: {
    params: AttachSessionParams
    result: AttachSessionResult
  }
  detachExtension: {
    params: DetachExtensionParams
    result: DetachExtensionResult
  }
  destroySession: {
    params: DestroySessionParams
    result: DestroySessionResult
  }
  abortSession: {
    params: AbortSessionParams
    result: AbortSessionResult
  }
  sendUserMessage: {
    params: SendUserMessageParams
    result: SendUserMessageResult
  }
  resolveInteraction: {
    params: ResolveInteractionParams
    result: ResolveInteractionResult
  }
  createCron: {
    params: CreateCronParams
    result: CreateCronResult
  }
  listCrons: {
    params: ListCronsParams
    result: ListCronsResult
  }
  pauseCron: {
    params: PauseCronParams
    result: PauseCronResult
  }
  resumeCron: {
    params: ResumeCronParams
    result: ResumeCronResult
  }
  deleteCron: {
    params: DeleteCronParams
    result: DeleteCronResult
  }
  setSessionModel: {
    params: SetSessionModelParams
    result: SetSessionModelResult
  }
  setPlanMode: {
    params: SetPlanModeParams
    result: SetPlanModeResult
  }
  getUsage: {
    params: GetUsageParams
    result: GetUsageResult
  }
}
