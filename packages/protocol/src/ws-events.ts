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
  created_at: z.number(),
  updated_at: z.number(),
  archived: z.boolean(),
})

const artifactSchema = z.object({
  id: z.string(),
  topic_id: z.string().nullable(),
  name: z.string(),
  mime: z.string().nullable(),
  size_bytes: z.number().nullable(),
  source: z.enum(['generated', 'uploaded']),
  created_at: z.number(),
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
  state: z.enum(['idle', 'thinking', 'tool', 'streaming', 'aborting']),
})

export const cronListSchema = z.object({
  crons: z.array(
    z.object({
      cronId: z.string(),
      originTopicId: z.string(),
      cronExpr: z.string(),
      prompt: z.string(),
      status: z.enum(['active', 'paused', 'error']),
      lastRunAt: z.number().optional(),
      nextRunAt: z.number().optional(),
    }),
  ),
})

export const cronUpsertedSchema = z.object({
  cronId: z.string(),
  originTopicId: z.string(),
  cronExpr: z.string(),
  prompt: z.string(),
  status: z.enum(['active', 'paused', 'error']),
  lastRunAt: z.number().optional(),
  nextRunAt: z.number().optional(),
})

export const cronTriggeredSchema = z.object({
  cronId: z.string(),
  originTopicId: z.string(),
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

export const cronRunCompletedSchema = z.object({
  cronId: z.string(),
  runId: z.string(),
  originTopicId: z.string(),
  status: z.enum(['success', 'failed', 'timeout']),
  summary: z.string().nullable(),
  duration: z.number().nullable(),
  completedAt: z.number(),
})

export const errorSchema = z.object({
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
  | { type: 'cron.list'; data: z.infer<typeof cronListSchema> }
  | { type: 'cron.upserted'; data: z.infer<typeof cronUpsertedSchema> }
  | { type: 'cron.triggered'; data: z.infer<typeof cronTriggeredSchema> }
  | { type: 'artifact.added'; data: z.infer<typeof artifactAddedSchema> }
  | { type: 'artifact.deleted'; data: z.infer<typeof artifactDeletedSchema> }
  | { type: 'artifact.moved'; data: z.infer<typeof artifactMovedSchema> }
  | { type: 'artifact.list'; data: z.infer<typeof artifactListSchema> }
  | { type: 'sop_template.list'; data: z.infer<typeof sopTemplateListSchema> }
  | { type: 'usage.snapshot'; data: z.infer<typeof usageSnapshotSchema> }
  | { type: 'session.health'; data: z.infer<typeof sessionHealthSchema> }
  | { type: 'cron.run.completed'; data: z.infer<typeof cronRunCompletedSchema> }
  | { type: 'error'; data: z.infer<typeof errorSchema> }

export const serverEventDataSchemas: Record<string, z.ZodTypeAny> = {
  'topics.list': topicsListSchema,
  'topic.created': topicCreatedSchema,
  'topic.updated': topicUpdatedSchema,
  'topic.deleted': topicDeletedSchema,
  'message.start': messageStartSchema,
  'message.delta': messageDeltaSchema,
  'message.end': messageEndSchema,
  'tool.call': toolCallSchema,
  'tool.result': toolResultSchema,
  'file.diff': fileDiffSchema,
  'todo.update': todoUpdateSchema,
  'plan.update': planUpdateSchema,
  'interaction.request': interactionRequestSchema,
  'agent.status': agentStatusSchema,
  'cron.list': cronListSchema,
  'cron.upserted': cronUpsertedSchema,
  'cron.triggered': cronTriggeredSchema,
  'artifact.added': artifactAddedSchema,
  'artifact.deleted': artifactDeletedSchema,
  'artifact.moved': artifactMovedSchema,
  'artifact.list': artifactListSchema,
  'sop_template.list': sopTemplateListSchema,
  'usage.snapshot': usageSnapshotSchema,
  'session.health': sessionHealthSchema,
  'cron.run.completed': cronRunCompletedSchema,
  error: errorSchema,
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
  mentions: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      downloadUrl: z.string().optional(),
    }),
  ).optional().default([]),
})

export const userActionSchema = z.object({
  topicId: z.string(),
  action: z.enum(['approve', 'reject', 'abort']),
  interactionId: z.string().optional(),
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

export const artifactUploadInitSchema = z.object({
  name: z.string(),
  mime: z.string(),
  sizeBytes: z.number(),
  topicId: z.string().optional(),
})

export const artifactUploadCompleteSchema = z.object({
  uploadId: z.string(),
  topicId: z.string().optional(),
})

export const searchQuerySchema = z.object({
  q: z.string(),
  topicId: z.string().optional(),
})

export const topicResumeSchema = z.object({
  topicId: z.string(),
})

export const topicSelectSchema = z.object({
  topicId: z.string(),
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
  | { type: 'user.action'; data: z.infer<typeof userActionSchema> }
  | { type: 'cron.pause'; data: z.infer<typeof cronPauseSchema> }
  | { type: 'cron.delete'; data: z.infer<typeof cronDeleteSchema> }
  | { type: 'cron.edit'; data: z.infer<typeof cronEditSchema> }
  | {
      type: 'artifact.upload.init'
      data: z.infer<typeof artifactUploadInitSchema>
    }
  | {
      type: 'artifact.upload.complete'
      data: z.infer<typeof artifactUploadCompleteSchema>
    }
  | { type: 'search.query'; data: z.infer<typeof searchQuerySchema> }
  | { type: 'topic.resume'; data: z.infer<typeof topicResumeSchema> }
  | { type: 'topic.select'; data: z.infer<typeof topicSelectSchema> }

export const clientEventDataSchemas: Record<string, z.ZodTypeAny> = {
  'topic.create': topicCreateSchema,
  'topic.delete': topicDeleteSchema,
  'topic.rename': topicRenameSchema,
  'topic.detachExtension': topicDetachExtensionSchema,
  'topic.setModel': topicSetModelSchema,
  'user.message': userMessageSchema,
  'user.action': userActionSchema,
  'cron.pause': cronPauseSchema,
  'cron.delete': cronDeleteSchema,
  'cron.edit': cronEditSchema,
  'artifact.upload.init': artifactUploadInitSchema,
  'artifact.upload.complete': artifactUploadCompleteSchema,
  'search.query': searchQuerySchema,
  'topic.resume': topicResumeSchema,
  'topic.select': topicSelectSchema,
}
