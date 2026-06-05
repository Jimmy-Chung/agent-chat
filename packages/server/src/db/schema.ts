import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
} from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'

// ─── users ──────────────────────────────────────────────────────────

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  displayName: text('display_name'),
  defaultModel: text('default_model'),
  createdAt: integer('created_at').notNull(),
})

// ─── topics ─────────────────────────────────────────────────────────

export const topics = sqliteTable('topics', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind', {
    enum: [
      'normal',
      'system_cron_admin',
      'system_artifact_pool',
      'system_sop_library',
    ],
  }).notNull(),
  agentType: text('agent_type', {
    enum: ['programming', 'general'],
  }).notNull(),
  piSessionId: text('pi_session_id'),
  programmingSpecJson: text('programming_spec_json'),
  generalSpecJson: text('general_spec_json'),
  sopTemplateId: text('sop_template_id'),
  currentModel: text('current_model'),
  currentProviderId: text('current_provider_id'),
  historyFrozenAt: integer('history_frozen_at'),
  planMode: integer('plan_mode', { mode: 'boolean' }).default(false).notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  archived: integer('archived', { mode: 'boolean' }).default(false).notNull(),
})

// ─── messages ───────────────────────────────────────────────────────

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    role: text('role', {
      enum: ['user', 'assistant', 'system', 'cron'],
    }).notNull(),
    status: text('status', {
      enum: ['streaming', 'done', 'aborted', 'error', 'pending', 'needs_retry', 'retrying'],
    }).notNull(),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
    stopReason: text('stop_reason'),
    cronRunId: text('cron_run_id'),
    turnId: text('turn_id'),
    clientMessageId: text('client_message_id'),
    retryCount: integer('retry_count').default(0).notNull(),
    maxRetries: integer('max_retries').default(2).notNull(),
  },
  (table) => [index('idx_messages_topic').on(table.topicId, table.startedAt)],
)

// ─── message_parts ──────────────────────────────────────────────────

export const messageParts = sqliteTable('message_parts', {
  id: text('id').primaryKey(),
  messageId: text('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  ordinal: integer('ordinal').notNull(),
  kind: text('kind', {
    enum: ['text', 'thinking', 'tool_use', 'tool_result', 'file_diff'],
  }).notNull(),
  contentJson: text('content_json').notNull(),
})

// ─── FTS5 virtual table — created via raw SQL migration ─────────────
// messages_fts is not a drizzle table; see migration SQL for CREATE VIRTUAL TABLE

// ─── artifacts ──────────────────────────────────────────────────────

export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    topicId: text('topic_id'),
    originTopicId: text('origin_topic_id'),
    name: text('name').notNull(),
    mime: text('mime'),
    sizeBytes: integer('size_bytes'),
    r2Key: text('r2_key').notNull(),
    source: text('source', {
      enum: ['generated', 'uploaded'],
    }).notNull(),
    uploadStatus: text('upload_status', {
      enum: ['uploaded', 'upload_failed'],
    }).default('uploaded').notNull(),
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    createdAt: integer('created_at').notNull(),
    metadataJson: text('metadata_json'),
  },
  (table) => [index('idx_artifacts_topic').on(table.topicId)],
)

// ─── message_artifact_refs ──────────────────────────────────────────

export const messageArtifactRefs = sqliteTable(
  'message_artifact_refs',
  {
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.messageId, table.artifactId] })],
)

// ─── cron_jobs ──────────────────────────────────────────────────────

export const cronJobs = sqliteTable('cron_jobs', {
  id: text('id').primaryKey(),
  originTopicId: text('origin_topic_id'),
  piCronId: text('pi_cron_id').notNull(),
  cronExpr: text('cron_expr').notNull(),
  prompt: text('prompt').notNull(),
  tagsJson: text('tags_json'),
  status: text('status', {
    enum: ['active', 'paused', 'error'],
  }).notNull(),
  nextRunAt: integer('next_run_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

// ─── cron_runs ──────────────────────────────────────────────────────

export const cronRuns = sqliteTable('cron_runs', {
  id: text('id').primaryKey(),
  cronId: text('cron_id')
    .notNull()
    .references(() => cronJobs.id, { onDelete: 'cascade' }),
  triggeredAt: integer('triggered_at').notNull(),
  finishedAt: integer('finished_at'),
  status: text('status', {
    enum: ['running', 'success', 'failed', 'timeout'],
  }).notNull(),
  resultMessageId: text('result_message_id'),
})

// ─── interactions ───────────────────────────────────────────────────

export const interactions = sqliteTable('interactions', {
  id: text('id').primaryKey(),
  topicId: text('topic_id')
    .notNull()
    .references(() => topics.id, { onDelete: 'cascade' }),
  messageId: text('message_id'),
  kind: text('kind', {
    enum: ['approval', 'choice'],
  }).notNull(),
  prompt: text('prompt').notNull(),
  optionsJson: text('options_json'),
  status: text('status', {
    enum: ['pending', 'resolved', 'timeout'],
  }).notNull(),
  responseJson: text('response_json'),
  createdAt: integer('created_at').notNull(),
  resolvedAt: integer('resolved_at'),
})

// ─── usage_records ──────────────────────────────────────────────────

export const usageRecords = sqliteTable(
  'usage_records',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    topicId: text('topic_id').references(() => topics.id, {
      onDelete: 'set null',
    }),
    messageId: text('message_id').references(() => messages.id, {
      onDelete: 'set null',
    }),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    costMicroUsd: integer('cost_micro_usd'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_usage_topic_time').on(table.topicId, table.createdAt),
    index('idx_usage_model_time').on(table.model, table.createdAt),
  ],
)

// ─── audit_log ──────────────────────────────────────────────────────

export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ts: integer('ts').notNull(),
  kind: text('kind').notNull(),
  detailJson: text('detail_json'),
})

// ─── sop_templates ──────────────────────────────────────────────────

export const sopTemplates = sqliteTable(
  'sop_templates',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    icon: text('icon'),
    description: text('description'),
    agentType: text('agent_type').notNull(),
    instruction: text('instruction'),
    inputContract: text('input_contract'),
    outputContract: text('output_contract'),
    systemPromptAddon: text('system_prompt_addon'),
    planTemplate: text('plan_template'),
    todosTemplateJson: text('todos_template_json'),
    todoItemsJson: text('todo_items_json'),
    workflowMode: text('workflow_mode').notNull().default('lazy'),
    builtin: integer('builtin', { mode: 'boolean' })
      .default(false)
      .notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('idx_sop_templates_type').on(table.agentType)],
)

// ─── push_subscriptions ─────────────────────────────────────────────────────

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: text('id').primaryKey(),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: integer('created_at').notNull(),
})

// ─── Relations ──────────────────────────────────────────────────────

export const topicsRelations = relations(topics, ({ many }) => ({
  messages: many(messages),
  artifacts: many(artifacts),
  cronJobs: many(cronJobs),
  interactions: many(interactions),
}))

export const messagesRelations = relations(messages, ({ one, many }) => ({
  topic: one(topics, {
    fields: [messages.topicId],
    references: [topics.id],
  }),
  parts: many(messageParts),
  artifactRefs: many(messageArtifactRefs),
}))

export const messagePartsRelations = relations(messageParts, ({ one }) => ({
  message: one(messages, {
    fields: [messageParts.messageId],
    references: [messages.id],
  }),
}))

export const artifactsRelations = relations(artifacts, ({ one }) => ({
  topic: one(topics, {
    fields: [artifacts.topicId],
    references: [topics.id],
  }),
}))

export const cronJobsRelations = relations(cronJobs, ({ one, many }) => ({
  topic: one(topics, {
    fields: [cronJobs.originTopicId],
    references: [topics.id],
  }),
  runs: many(cronRuns),
}))

export const cronRunsRelations = relations(cronRuns, ({ one }) => ({
  cron: one(cronJobs, {
    fields: [cronRuns.cronId],
    references: [cronJobs.id],
  }),
}))

export const interactionsRelations = relations(interactions, ({ one }) => ({
  topic: one(topics, {
    fields: [interactions.topicId],
    references: [topics.id],
  }),
}))

export const usageRecordsRelations = relations(usageRecords, ({ one }) => ({
  topic: one(topics, {
    fields: [usageRecords.topicId],
    references: [topics.id],
  }),
  message: one(messages, {
    fields: [usageRecords.messageId],
    references: [messages.id],
  }),
}))

export const messageArtifactRefsRelations = relations(
  messageArtifactRefs,
  ({ one }) => ({
    message: one(messages, {
      fields: [messageArtifactRefs.messageId],
      references: [messages.id],
    }),
    artifact: one(artifacts, {
      fields: [messageArtifactRefs.artifactId],
      references: [artifacts.id],
    }),
  }),
)
