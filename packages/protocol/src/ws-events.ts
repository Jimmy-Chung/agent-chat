import { z } from 'zod'
import { partDeltaSchema, todoItemSchema } from './pi-events'

// ─── Shared schemas ───────────────────────────────────────────────

const topicSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum([
    'normal',
    'system_cron_admin',
    'system_artifact_pool',
    'system_sop_library',
  ]),
  agent_type: z.enum(['programming', 'general']),
  pi_session_id: z.string().nullable(),
  current_model: z.string().nullable(),
  history_frozen_at: z.number().nullable(),
  plan_mode: z.boolean().optional().default(false),
  created_at: z.number(),
  updated_at: z.number(),
  archived: z.boolean(),
})

const artifactSchema = z.object({
  id: z.string(),
  topic_id: z.string().nullable(),
  origin_topic_id: z.string().nullable().optional(),
  name: z.string(),
  mime: z.string().nullable(),
  size_bytes: z.number().nullable(),
  r2_key: z.string().optional().default(''),
  download_url: z.string().optional(),
  preview_url: z.string().optional(),
  source: z.enum(['generated', 'uploaded']),
  upload_status: z.enum(['uploaded', 'upload_failed']).optional(),
  failure_code: z.string().nullable().optional(),
  failure_message: z.string().nullable().optional(),
  created_at: z.number(),
  metadata_json: z.string().nullable().optional(),
})

// ─── Server → Client events ───────────────────────────────────────

export const topicsListSchema = z.object({
  topics: z.array(topicSchema),
})

export const topicCreatedSchema = topicSchema

export const topicUpdatedSchema = topicSchema

export const topicDeletedSchema = z.object({
  id: z.string(),
})

export const messageStartSchema = z.object({
  topicId: z.string(),
  messageId: z.string(),
  role: z.enum(['user', 'assistant', 'system', 'cron']),
  status: z.enum(['aborted', 'error', 'streaming', 'done', 'pending', 'needs_retry', 'retrying']).optional(),
  clientMessageId: z.string().nullable().optional(),
  retryCount: z.number().optional(),
  maxRetries: z.number().optional(),
})

export const messageDeltaSchema = z.object({
  topicId: z.string(),
  messageId: z.string(),
  part: partDeltaSchema,
})

export const messageEndSchema = z.object({
  topicId: z.string(),
  messageId: z.string(),
  stopReason: z.enum([
    'end_turn',
    'max_tokens',
    'tool_use',
    'aborted',
    'error',
  ]),
})

export const messageDeliverySchema = z.object({
  topicId: z.string(),
  messageId: z.string(),
  status: z.enum(['pending', 'needs_retry', 'retrying', 'done', 'error']),
  retryCount: z.number(),
  maxRetries: z.number(),
})

export const toolCallSchema = z.object({
  topicId: z.string(),
  toolUseId: z.string(),
  messageId: z.string(),
  name: z.string(),
  input: z.unknown(),
})

export const toolResultSchema = z.object({
  topicId: z.string(),
  toolUseId: z.string(),
  messageId: z.string(),
  output: z.unknown(),
  isError: z.boolean(),
})

export const fileDiffSchema = z.object({
  topicId: z.string(),
  messageId: z.string(),
  path: z.string(),
  before: z.string(),
  after: z.string(),
})

export const todoUpdateSchema = z.object({
  topicId: z.string(),
  items: z.array(todoItemSchema),
})

export const planUpdateSchema = z.object({
  topicId: z.string(),
  plan: z.string(),
})

export const interactionRequestSchema = z.object({
  topicId: z.string(),
  interactionId: z.string(),
  messageId: z.string().optional(),
  interactionKind: z.enum(['approval', 'choice']),
  prompt: z.string(),
  options: z.array(z.string()).optional(),
  defaultTimeoutMs: z.number().optional(),
})

export const agentStatusSchema = z.object({
  topicId: z.string(),
  state: z.enum(['idle', 'processing', 'aborting']),
  phase: z.enum(['thinking', 'streaming', 'tool_use']).optional(),
})

export const agentProgressSchema = z.object({
  topicId: z.string(),
  phase: z.string(),
  message: z.string(),
  metadata: z.record(z.unknown()).optional(),
})

export const cronListSchema = z.object({
  crons: z.array(
    z.object({
      cronId: z.string(),
      localCronId: z.string().optional(),
      originTopicId: z.string(),
      originSessionId: z.string().optional(),
      runtime: z.string().optional(),
      providerGroup: z.string().optional(),
      cronExpr: z.string(),
      prompt: z.string(),
      timezone: z.string().optional(),
      status: z.enum(['active', 'paused', 'error']),
      lastRunAt: z.number().optional(),
      nextRunAt: z.number().optional(),
      createdAt: z.number().optional(),
      updatedAt: z.number().optional(),
    }),
  ),
})

export const cronUpsertedSchema = z.object({
  cronId: z.string(),
  localCronId: z.string().optional(),
  originTopicId: z.string(),
  originSessionId: z.string().optional(),
  runtime: z.string().optional(),
  providerGroup: z.string().optional(),
  cronExpr: z.string(),
  prompt: z.string(),
  timezone: z.string().optional(),
  status: z.enum(['active', 'paused', 'error']),
  lastRunAt: z.number().optional(),
  nextRunAt: z.number().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
})

export const cronTriggeredSchema = z.object({
  cronId: z.string(),
  localCronId: z.string().optional(),
  originTopicId: z.string(),
  originSessionId: z.string().optional(),
  runId: z.string(),
  firedAt: z.number(),
})

export const artifactAddedSchema = artifactSchema

export const artifactDeletedSchema = z.object({
  id: z.string(),
})

export const artifactMovedSchema = z.object({
  id: z.string(),
  fromTopicId: z.string().nullable(),
  toTopicId: z.string().nullable(),
})

export const artifactListSchema = z.object({
  artifacts: z.array(artifactSchema),
})

export const artifactUploadReadySchema = z.object({
  uploadId: z.string(),
  uploadUrl: z.string(),
  method: z.literal('PUT'),
  expiresAt: z.number(),
  maxBytes: z.number(),
})

export const artifactDownloadReadySchema = z.object({
  artifactId: z.string(),
  downloadUrl: z.string(),
  previewUrl: z.string().optional(),
  expiresAt: z.number(),
})

const sopTemplateSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  description: z.string().nullable(),
  agent_type: z.enum(['programming', 'general', 'any']),
  workflow_mode: z.enum(['lazy', 'eager', 'off']),
  builtin: z.boolean(),
  created_at: z.number(),
  updated_at: z.number(),
})

export const sopTemplateListSchema = z.object({
  templates: z.array(sopTemplateSummarySchema),
})

export const usageSnapshotSchema = z.object({
  topicId: z.string().optional(),
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
})

export const sessionHealthSchema = z.object({
  topicId: z.string(),
  state: z.enum(['connected', 'disconnected', 'reconnecting']),
  piSessionId: z.string().nullable(),
  lastError: z.string().optional(),
})

export const sessionStatusSchema = z.object({
  topicId: z.string(),
  ready: z.boolean(),
})

export const cronRunCompletedSchema = z.object({
  cronId: z.string(),
  localCronId: z.string().optional(),
  runId: z.string(),
  originTopicId: z.string(),
  originSessionId: z.string().optional(),
  status: z.enum(['success', 'failed', 'timeout']),
  summary: z.string().nullable(),
  duration: z.number().nullable().optional(),
  durationMs: z.number().nullable().optional(),
  completedAt: z.number(),
})

export const messagesHistorySchema = z.object({
  topicId: z.string(),
  messages: z.array(
    z.object({
      id: z.string(),
      topic_id: z.string(),
      role: z.enum(['user', 'assistant', 'system', 'cron']),
      status: z.enum(['aborted', 'error', 'streaming', 'done', 'pending', 'needs_retry', 'retrying']),
      started_at: z.number(),
      finished_at: z.number().nullable(),
      stop_reason: z.string().nullable(),
      cron_run_id: z.string().nullable(),
      turn_id: z.string().nullable(),
      client_message_id: z.string().nullable().optional(),
      retry_count: z.number().optional(),
      max_retries: z.number().optional(),
    }),
  ),
  partsByMessage: z.record(
    z.string(),
    z.array(
      z.object({
        id: z.string(),
        message_id: z.string(),
        ordinal: z.number(),
        kind: z.string(),
        content_json: z.string(),
      }),
    ),
  ),
  pendingInteractions: z.array(
    z.object({
      topicId: z.string(),
      interactionId: z.string(),
      messageId: z.string().optional(),
      interactionKind: z.enum(['approval', 'choice']),
      prompt: z.string(),
      options: z.array(z.string()).optional(),
      status: z.enum(['pending', 'resolved', 'timeout']).optional(),
      response: z.string().optional(),
      defaultTimeoutMs: z.number().optional(),
    }),
  ).optional(),
})

export const errorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
})

export const mcpCommandResultSchema = z.object({
  requestId: z.string(),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
  servers: z.array(z.object({ name: z.string(), scope: z.string() })).optional(),
})

export const mcpCommandErrorSchema = z.object({
  requestId: z.string(),
  code: z.string(),
  message: z.string(),
})

// Provider RPC relay (AIT-152) — server→client response
export const providerRpcResultSchema = z.object({
  requestId: z.string(),
  result: z.unknown(),
})

export const providerRpcErrorSchema = z.object({
  requestId: z.string(),
  code: z.string(),
  message: z.string(),
})

// ─── Server event type + schema ───────────────────────────────────

export type ServerEvent =
  | { type: 'topics.list'; data: z.infer<typeof topicsListSchema> }
  | { type: 'topic.created'; data: z.infer<typeof topicCreatedSchema> }
  | { type: 'topic.updated'; data: z.infer<typeof topicUpdatedSchema> }
  | { type: 'topic.deleted'; data: z.infer<typeof topicDeletedSchema> }
  | { type: 'message.start'; data: z.infer<typeof messageStartSchema> }
  | { type: 'message.delta'; data: z.infer<typeof messageDeltaSchema> }
  | { type: 'message.end'; data: z.infer<typeof messageEndSchema> }
  | { type: 'message.delivery'; data: z.infer<typeof messageDeliverySchema> }
  | { type: 'tool.call'; data: z.infer<typeof toolCallSchema> }
  | { type: 'tool.result'; data: z.infer<typeof toolResultSchema> }
  | { type: 'file.diff'; data: z.infer<typeof fileDiffSchema> }
  | { type: 'todo.update'; data: z.infer<typeof todoUpdateSchema> }
  | { type: 'plan.update'; data: z.infer<typeof planUpdateSchema> }
  | {
      type: 'interaction.request'
      data: z.infer<typeof interactionRequestSchema>
    }
  | { type: 'agent.status'; data: z.infer<typeof agentStatusSchema> }
  | { type: 'agent.progress'; data: z.infer<typeof agentProgressSchema> }
  | { type: 'cron.list'; data: z.infer<typeof cronListSchema> }
  | { type: 'cron.upserted'; data: z.infer<typeof cronUpsertedSchema> }
  | { type: 'cron.triggered'; data: z.infer<typeof cronTriggeredSchema> }
  | { type: 'artifact.added'; data: z.infer<typeof artifactAddedSchema> }
  | { type: 'artifact.deleted'; data: z.infer<typeof artifactDeletedSchema> }
  | { type: 'artifact.moved'; data: z.infer<typeof artifactMovedSchema> }
  | { type: 'artifact.list'; data: z.infer<typeof artifactListSchema> }
  | { type: 'artifact.upload.ready'; data: z.infer<typeof artifactUploadReadySchema> }
  | { type: 'artifact.download.ready'; data: z.infer<typeof artifactDownloadReadySchema> }
  | { type: 'sop_template.list'; data: z.infer<typeof sopTemplateListSchema> }
  | { type: 'usage.snapshot'; data: z.infer<typeof usageSnapshotSchema> }
  | { type: 'session.health'; data: z.infer<typeof sessionHealthSchema> }
  | { type: 'session.status'; data: z.infer<typeof sessionStatusSchema> }
  | { type: 'cron.run.completed'; data: z.infer<typeof cronRunCompletedSchema> }
  | { type: 'error'; data: z.infer<typeof errorSchema> }
  | { type: 'mcp.command.result'; data: z.infer<typeof mcpCommandResultSchema> }
  | { type: 'mcp.command.error'; data: z.infer<typeof mcpCommandErrorSchema> }
  | { type: 'provider.rpc.result'; data: z.infer<typeof providerRpcResultSchema> }
  | { type: 'provider.rpc.error'; data: z.infer<typeof providerRpcErrorSchema> }
  | {
      type: 'messages.history'
      data: z.infer<typeof messagesHistorySchema>
    }

export const serverEventDataSchemas: Record<string, z.ZodTypeAny> = {
  'topics.list': topicsListSchema,
  'topic.created': topicCreatedSchema,
  'topic.updated': topicUpdatedSchema,
  'topic.deleted': topicDeletedSchema,
  'message.start': messageStartSchema,
  'message.delta': messageDeltaSchema,
  'message.end': messageEndSchema,
  'message.delivery': messageDeliverySchema,
  'tool.call': toolCallSchema,
  'tool.result': toolResultSchema,
  'file.diff': fileDiffSchema,
  'todo.update': todoUpdateSchema,
  'plan.update': planUpdateSchema,
  'interaction.request': interactionRequestSchema,
  'agent.status': agentStatusSchema,
  'agent.progress': agentProgressSchema,
  'cron.list': cronListSchema,
  'cron.upserted': cronUpsertedSchema,
  'cron.triggered': cronTriggeredSchema,
  'artifact.added': artifactAddedSchema,
  'artifact.deleted': artifactDeletedSchema,
  'artifact.moved': artifactMovedSchema,
  'artifact.list': artifactListSchema,
  'artifact.upload.ready': artifactUploadReadySchema,
  'artifact.download.ready': artifactDownloadReadySchema,
  'sop_template.list': sopTemplateListSchema,
  'usage.snapshot': usageSnapshotSchema,
  'session.health': sessionHealthSchema,
  'session.status': sessionStatusSchema,
  'cron.run.completed': cronRunCompletedSchema,
  error: errorSchema,
  'mcp.command.result': mcpCommandResultSchema,
  'mcp.command.error': mcpCommandErrorSchema,
  'provider.rpc.result': providerRpcResultSchema,
  'provider.rpc.error': providerRpcErrorSchema,
  'messages.history': messagesHistorySchema,
}

// ─── Client → Server events ───────────────────────────────────────

export const topicCreateSchema = z.object({
  name: z.string(),
  agentType: z.enum(['programming', 'general']),
  programming: z
    .object({
      extension: z.enum(['claude-code', 'codex']),
      yolo: z.boolean(),
      cwd: z.string().optional(),
      permissionMode: z.enum([
        'default',
        'acceptEdits',
        'plan',
        'bypassPermissions',
      ]),
    })
    .optional(),
  sopTemplateId: z.string().optional(),
  providerId: z.string().optional(),
})

export const topicDeleteSchema = z.object({
  id: z.string(),
  artifactStrategy: z.enum(['pool', 'delete']),
})

export const topicRenameSchema = z.object({
  id: z.string(),
  name: z.string(),
})

export const topicDetachExtensionSchema = z.object({
  id: z.string(),
})

export const topicSetModelSchema = z.object({
  id: z.string(),
  model: z.string(),
})

export const userMessageSchema = z.object({
  topicId: z.string(),
  content: z.string(),
  clientMessageId: z.string().optional(),
  mentions: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      downloadUrl: z.string().optional(),
    }),
  ).optional().default([]),
})

export const userMessageRetrySchema = z.object({
  topicId: z.string(),
  messageId: z.string(),
})

export const userActionSchema = z.object({
  topicId: z.string(),
  action: z.enum(['approve', 'reject', 'abort', 'choose']),
  interactionId: z.string().optional(),
  choice: z.string().optional(),
})

export const cronPauseSchema = z.object({
  cronId: z.string(),
})

export const cronDeleteSchema = z.object({
  cronId: z.string(),
})

export const cronEditSchema = z.object({
  cronId: z.string(),
  cronExpr: z.string().optional(),
  prompt: z.string().optional(),
})

export const cronSyncSchema = z.object({})

export const artifactUploadInitSchema = z.object({
  name: z.string(),
  mime: z.string().optional().default('application/octet-stream'),
  sizeBytes: z.number(),
  topicId: z.string().optional(),
})

export const artifactUploadCompleteSchema = z.object({
  uploadId: z.string(),
  topicId: z.string().optional(),
})

export const artifactDownloadInitSchema = z.object({
  artifactId: z.string(),
})

export const searchQuerySchema = z.object({
  q: z.string(),
  topicId: z.string().optional(),
})

export const topicResumeSchema = z.object({
  topicId: z.string(),
})

export const messagesLoadSchema = z.object({
  topicId: z.string(),
})

export const topicSelectSchema = z.object({
  topicId: z.string(),
})

export const topicSetPlanModeSchema = z.object({
  id: z.string(),
  planMode: z.boolean(),
})

export const cronResumeSchema = z.object({
  cronId: z.string(),
})

export const mcpCommandSchema = z.object({
  requestId: z.string(),
  action: z.enum(['add', 'remove', 'list', 'get']),
  name: z.string().optional(),
  command: z.string().optional(),
  scope: z.enum(['user', 'project', 'local']).optional(),
  projectDir: z.string().optional(),
})

// Provider RPC relay (AIT-152) — client→server request
export const providerRpcSchema = z.object({
  requestId: z.string(),
  method: z.enum([
    'listProviderConfigs',
    'addProviderConfig',
    'updateProviderConfig',
    'removeProviderConfig',
    'switchSessionProvider',
    'getUsage',
  ]),
  params: z.record(z.unknown()),
})

// ─── Client event type + schema ───────────────────────────────────

export type ClientEvent =
  | { type: 'topic.create'; data: z.infer<typeof topicCreateSchema> }
  | { type: 'topic.delete'; data: z.infer<typeof topicDeleteSchema> }
  | { type: 'topic.rename'; data: z.infer<typeof topicRenameSchema> }
  | {
      type: 'topic.detachExtension'
      data: z.infer<typeof topicDetachExtensionSchema>
    }
  | { type: 'topic.setModel'; data: z.infer<typeof topicSetModelSchema> }
  | { type: 'user.message'; data: z.infer<typeof userMessageSchema> }
  | { type: 'user.message.retry'; data: z.infer<typeof userMessageRetrySchema> }
  | { type: 'user.action'; data: z.infer<typeof userActionSchema> }
  | { type: 'cron.pause'; data: z.infer<typeof cronPauseSchema> }
  | { type: 'cron.delete'; data: z.infer<typeof cronDeleteSchema> }
  | { type: 'cron.edit'; data: z.infer<typeof cronEditSchema> }
  | { type: 'cron.sync'; data: z.infer<typeof cronSyncSchema> }
  | {
      type: 'artifact.upload.init'
      data: z.infer<typeof artifactUploadInitSchema>
    }
  | {
      type: 'artifact.upload.complete'
      data: z.infer<typeof artifactUploadCompleteSchema>
    }
  | {
      type: 'artifact.download.init'
      data: z.infer<typeof artifactDownloadInitSchema>
    }
  | { type: 'search.query'; data: z.infer<typeof searchQuerySchema> }
  | { type: 'topic.resume'; data: z.infer<typeof topicResumeSchema> }
  | { type: 'messages.load'; data: z.infer<typeof messagesLoadSchema> }
  | {
      type: 'topic.setPlanMode'
      data: z.infer<typeof topicSetPlanModeSchema>
    }
  | { type: 'topic.select'; data: z.infer<typeof topicSelectSchema> }
  | { type: 'cron.resume'; data: z.infer<typeof cronResumeSchema> }
  | { type: 'mcp.command'; data: z.infer<typeof mcpCommandSchema> }
  | { type: 'provider.rpc'; data: z.infer<typeof providerRpcSchema> }

export const clientEventDataSchemas: Record<string, z.ZodTypeAny> = {
  'topic.create': topicCreateSchema,
  'topic.delete': topicDeleteSchema,
  'topic.rename': topicRenameSchema,
  'topic.detachExtension': topicDetachExtensionSchema,
  'topic.setModel': topicSetModelSchema,
  'user.message': userMessageSchema,
  'user.message.retry': userMessageRetrySchema,
  'user.action': userActionSchema,
  'cron.pause': cronPauseSchema,
  'cron.delete': cronDeleteSchema,
  'cron.edit': cronEditSchema,
  'cron.sync': cronSyncSchema,
  'artifact.upload.init': artifactUploadInitSchema,
  'artifact.upload.complete': artifactUploadCompleteSchema,
  'artifact.download.init': artifactDownloadInitSchema,
  'search.query': searchQuerySchema,
  'topic.resume': topicResumeSchema,
  'messages.load': messagesLoadSchema,
  'topic.setPlanMode': topicSetPlanModeSchema,
  'topic.select': topicSelectSchema,
  'cron.resume': cronResumeSchema,
  'mcp.command': mcpCommandSchema,
  'provider.rpc': providerRpcSchema,
}
