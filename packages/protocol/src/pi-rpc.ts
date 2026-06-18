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
  initialPlan: z.string().optional(),
  initialTodos: z.array(todoItemSchema).optional(),
  allowedTools: z.array(z.string()).optional(),
})

export type ProgrammingSpecRpc = z.infer<typeof programmingSpecSchema>

export const generalSpecSchema = z.object({
  cwd: z.string().optional(),
  systemPrompt: z.string().optional(),
  initialPlan: z.string().optional(),
  initialTodos: z.array(todoItemSchema).optional(),
  allowedTools: z.array(z.string()).optional(),
})

export type GeneralSpecRpc = z.infer<typeof generalSpecSchema>

// createSession
export const createSessionParamsSchema = z.object({
  sessionId: z.string().optional(),
  kind: z.enum(['programming', 'general']),
  programming: programmingSpecSchema.optional(),
  general: generalSpecSchema.optional(),
  initialModel: z.string().optional(),
  workflowMode: z.enum(['lazy', 'eager', 'off']).optional(),
  providerId: z.string().optional(),
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

// recreateSession
export const recreateSessionParamsSchema = createSessionParamsSchema.extend({
  sessionId: z.string(),
})

export const recreateSessionResultSchema = createSessionResultSchema

export type RecreateSessionParams = z.infer<typeof recreateSessionParamsSchema>
export type RecreateSessionResult = z.infer<typeof recreateSessionResultSchema>

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
  clientMessageId: z.string().optional(),
  content: z.string(),
  mentionedArtifacts: z.array(artifactRefSchema).optional(),
  streamingBehavior: z.enum(['steer', 'followUp']).optional(),
})

export const sendUserMessageResultSchema = z.object({
  messageId: z.string(),
})

export type SendUserMessageParams = z.infer<typeof sendUserMessageParamsSchema>
export type SendUserMessageResult = z.infer<typeof sendUserMessageResultSchema>

// uploadGeneratedArtifact
export const uploadGeneratedArtifactParamsSchema = z.object({
  sessionId: z.string(),
  artifactId: z.string(),
  filePath: z.string(),
  topicId: z.string().optional(),
})

export const uploadGeneratedArtifactResultSchema = z.object({
  ok: z.literal(true),
  artifactId: z.string(),
  uploadStatus: z.enum(['uploaded', 'upload_failed']),
})

export type UploadGeneratedArtifactParams = z.infer<typeof uploadGeneratedArtifactParamsSchema>
export type UploadGeneratedArtifactResult = z.infer<typeof uploadGeneratedArtifactResultSchema>

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

const cronTagsSchema = z.array(z.string())

// createCron
export const createCronParamsSchema = z.object({
  originSessionId: z.string(),
  originTopicId: z.string().optional(),
  runtime: z.string().optional(),
  providerGroup: z.string().optional(),
  cronExpr: z.string(),
  prompt: z.string(),
  timezone: z.string().optional(),
  tags: cronTagsSchema.optional(),
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
  originTopicId: z.string().optional(),
  originSessionId: z.string(),
  runtime: z.string().optional(),
  providerGroup: z.string().optional(),
  cronExpr: z.string(),
  prompt: z.string(),
  timezone: z.string().optional(),
  tags: cronTagsSchema.optional(),
  status: z.enum(['active', 'paused', 'error']),
  lastRunAt: z.number().optional(),
  nextRunAt: z.number().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
})

export type CronInfo = z.infer<typeof cronInfoSchema>

export const listCronsResultSchema = z.array(cronInfoSchema)

export type ListCronsParams = z.infer<typeof listCronsParamsSchema>
export type ListCronsResult = z.infer<typeof listCronsResultSchema>

// listCronRuns
export const listCronRunsParamsSchema = z.object({
  cronId: z.string().optional(),
  originTopicId: z.string().optional(),
  originSessionId: z.string().optional(),
  limit: z.number().optional(),
  cursor: z.string().optional(),
})

const cronRunInfoSchema = z.object({
  runId: z.string(),
  cronId: z.string(),
  originTopicId: z.string().optional(),
  originSessionId: z.string().optional(),
  runtime: z.string().optional(),
  providerGroup: z.string().optional(),
  firedAt: z.number(),
  completedAt: z.number().optional(),
  // adapter run lifecycle status: running | completed | failed.
  // success/failure of a finished run is carried by `success`.
  status: z.enum(['running', 'completed', 'failed']).optional(),
  success: z.boolean().optional(),
  durationMs: z.number().optional(),
  error: z.string().optional(),
})

export type CronRunInfo = z.infer<typeof cronRunInfoSchema>

export const listCronRunsResultSchema = z.object({
  runs: z.array(cronRunInfoSchema),
  nextCursor: z.string().optional(),
})

export type ListCronRunsParams = z.infer<typeof listCronRunsParamsSchema>
export type ListCronRunsResult = z.infer<typeof listCronRunsResultSchema>

// updateCron
export const updateCronParamsSchema = z.object({
  cronId: z.string(),
  cronExpr: z.string().optional(),
  prompt: z.string().optional(),
  timezone: z.string().optional(),
  tags: cronTagsSchema.optional(),
  status: z.enum(['active', 'paused', 'error']).optional(),
})

// adapter returns the full updated entry; we rely on the broadcast `cron.updated`
// event to refresh the UI, but type the result faithfully.
export const updateCronResultSchema = cronInfoSchema

export type UpdateCronParams = z.infer<typeof updateCronParamsSchema>
export type UpdateCronResult = z.infer<typeof updateCronResultSchema>

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

// ─── Provider management (AIT-152) ────────────────────────────────

export const providerConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  apiKey: z.string().optional(),
  models: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  group: z.string().optional(),
})

export type ProviderConfigRpc = z.infer<typeof providerConfigSchema>

// listProviderConfigs
export const listProviderConfigsParamsSchema = z.object({
  group: z.string().optional(),
})
export const listProviderConfigsResultSchema = z.object({
  configs: z.array(providerConfigSchema),
})
export type ListProviderConfigsParams = z.infer<typeof listProviderConfigsParamsSchema>
export type ListProviderConfigsResult = z.infer<typeof listProviderConfigsResultSchema>

// addProviderConfig
export const addProviderConfigParamsSchema = z.object({
  name: z.string(),
  provider: z.string(),
  apiKey: z.string(),
  models: z.array(z.string()).optional(),
  group: z.string().optional(),
})
export const addProviderConfigResultSchema = z.object({ id: z.string() })
export type AddProviderConfigParams = z.infer<typeof addProviderConfigParamsSchema>
export type AddProviderConfigResult = z.infer<typeof addProviderConfigResultSchema>

// updateProviderConfig
export const updateProviderConfigParamsSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  provider: z.string().optional(),
  apiKey: z.string().optional(),
  models: z.array(z.string()).optional(),
  group: z.string().optional(),
})
export const updateProviderConfigResultSchema = okResultSchema
export type UpdateProviderConfigParams = z.infer<typeof updateProviderConfigParamsSchema>
export type UpdateProviderConfigResult = z.infer<typeof updateProviderConfigResultSchema>

// removeProviderConfig
export const removeProviderConfigParamsSchema = z.object({
  id: z.string(),
})
export const removeProviderConfigResultSchema = okResultSchema
export type RemoveProviderConfigParams = z.infer<typeof removeProviderConfigParamsSchema>
export type RemoveProviderConfigResult = z.infer<typeof removeProviderConfigResultSchema>

// switchSessionProvider
export const switchSessionProviderParamsSchema = z.object({
  sessionId: z.string(),
  providerId: z.string(),
})
export const switchSessionProviderResultSchema = okResultSchema
export type SwitchSessionProviderParams = z.infer<typeof switchSessionProviderParamsSchema>
export type SwitchSessionProviderResult = z.infer<typeof switchSessionProviderResultSchema>

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

// ─── MCP management ───────────────────────────────────────────────

export const mcpServerSpecSchema = z.object({
  transport: z.enum(['stdio', 'http', 'sse']).optional(),
  // stdio fields
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  // http / sse fields
  url: z.string().optional(),
})

export type McpServerSpec = z.infer<typeof mcpServerSpecSchema>

export const runMcpCommandParamsSchema = z.object({
  action: z.enum(['add', 'remove', 'list', 'get']),
  name: z.string().optional(),
  spec: mcpServerSpecSchema.optional(),
})

export const runMcpCommandResultSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
})

export type RunMcpCommandParams = z.infer<typeof runMcpCommandParamsSchema>
export type RunMcpCommandResult = z.infer<typeof runMcpCommandResultSchema>

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
  recreateSession: {
    params: RecreateSessionParams
    result: RecreateSessionResult
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
  uploadGeneratedArtifact: {
    params: UploadGeneratedArtifactParams
    result: UploadGeneratedArtifactResult
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
  listCronRuns: {
    params: ListCronRunsParams
    result: ListCronRunsResult
  }
  updateCron: {
    params: UpdateCronParams
    result: UpdateCronResult
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
  runMcpCommand: {
    params: RunMcpCommandParams
    result: RunMcpCommandResult
  }
  listProviderConfigs: {
    params: ListProviderConfigsParams
    result: ListProviderConfigsResult
  }
  addProviderConfig: {
    params: AddProviderConfigParams
    result: AddProviderConfigResult
  }
  updateProviderConfig: {
    params: UpdateProviderConfigParams
    result: UpdateProviderConfigResult
  }
  removeProviderConfig: {
    params: RemoveProviderConfigParams
    result: RemoveProviderConfigResult
  }
  switchSessionProvider: {
    params: SwitchSessionProviderParams
    result: SwitchSessionProviderResult
  }
}
