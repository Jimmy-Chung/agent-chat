export interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

export interface ProgrammingSpec {
  extension: 'claude-code' | 'codex'
  yolo: boolean
  cwd: string
  permissionMode: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
  systemPrompt?: string
  allowedTools?: string[]
}

export interface GeneralSpec {
  cwd?: string
  systemPrompt?: string
  initialPlan?: string
  initialTodos?: TodoItem[]
  allowedTools?: string[]
}

export interface ArtifactRef {
  id: string
  name: string
  downloadUrl?: string
}

export interface Topic {
  id: string
  name: string
  kind:
    | 'normal'
    | 'system_cron_admin'
    | 'system_artifact_pool'
    | 'system_sop_library'
  agent_type: 'programming' | 'general'
  pi_session_id: string | null
  programming_spec_json: string | null
  general_spec_json: string | null
  sop_template_id: string | null
  attention_target?: string | null
  current_model: string | null
  /** Provider this topic is bound to at creation time. Immutable per topic. */
  current_provider_id: string | null
  history_frozen_at: number | null
  plan_mode: boolean
  created_at: number
  updated_at: number
  archived: boolean
}

export interface Message {
  id: string
  topic_id: string
  role: 'user' | 'assistant' | 'system' | 'cron'
  status:
    | 'streaming'
    | 'done'
    | 'aborted'
    | 'error'
    | 'pending'
    | 'needs_retry'
    | 'retrying'
  started_at: number
  finished_at: number | null
  stop_reason: string | null
  cron_run_id: string | null
  turn_id: string | null
  client_message_id: string | null
  retry_count: number
  max_retries: number
}

export interface MessagePart {
  id: string
  message_id: string
  ordinal: number
  kind: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'file_diff'
  content_json: string
}

export interface Artifact {
  id: string
  topic_id: string | null
  origin_topic_id: string | null
  name: string
  mime: string | null
  size_bytes: number | null
  r2_key: string
  download_url?: string
  preview_url?: string
  source: 'generated' | 'uploaded'
  upload_status?: 'uploaded' | 'upload_failed'
  failure_code?: string | null
  failure_message?: string | null
  created_at: number
  metadata_json: string | null
}

export interface CronJob {
  id: string
  origin_topic_id: string | null
  pi_cron_id: string
  cron_expr: string
  prompt: string
  tags?: string[]
  status: 'active' | 'paused' | 'error'
  next_run_at: number | null
  created_at: number
  updated_at: number
}

export interface CronRun {
  id: string
  cron_id: string
  triggered_at: number
  finished_at: number | null
  status: 'running' | 'success' | 'failed' | 'timeout'
  result_message_id: string | null
}

export interface Interaction {
  id: string
  topic_id: string
  message_id: string | null
  kind: 'approval' | 'choice'
  prompt: string
  options_json: string | null
  status: 'pending' | 'resolved' | 'timeout'
  response_json: string | null
  created_at: number
  resolved_at: number | null
}

export interface UsageRecord {
  id: number
  topic_id: string | null
  message_id: string | null
  model: string
  input_tokens: number
  output_tokens: number
  cost_micro_usd: number | null
  created_at: number
}
