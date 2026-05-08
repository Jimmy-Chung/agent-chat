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
  current_model: string | null
  history_frozen_at: number | null
  created_at: number
  updated_at: number
  archived: boolean
}

export interface Message {
  id: string
  topic_id: string
  role: 'user' | 'assistant' | 'system' | 'cron'
  status: 'streaming' | 'done' | 'aborted' | 'error'
  started_at: number
  finished_at: number | null
  stop_reason: string | null
  cron_run_id: string | null
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
  source: 'generated' | 'uploaded'
  created_at: number
  metadata_json: string | null
}

export interface CronJob {
  id: string
  origin_topic_id: string
  pi_cron_id: string
  cron_expr: string
  prompt: string
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
  status: 'running' | 'success' | 'failed'
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
