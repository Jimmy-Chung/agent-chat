-- Migration: 0000_initial
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  default_model TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  pi_session_id TEXT,
  programming_spec_json TEXT,
  general_spec_json TEXT,
  sop_template_id TEXT,
  current_model TEXT,
  history_frozen_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived INTEGER DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  stop_reason TEXT,
  cron_run_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_topic ON messages(topic_id, started_at);

CREATE TABLE IF NOT EXISTS message_parts (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  kind TEXT NOT NULL,
  content_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  topic_id TEXT,
  origin_topic_id TEXT,
  name TEXT NOT NULL,
  mime TEXT,
  size_bytes INTEGER,
  r2_key TEXT NOT NULL,
  source TEXT NOT NULL,
  upload_status TEXT NOT NULL DEFAULT 'uploaded',
  failure_code TEXT,
  failure_message TEXT,
  created_at INTEGER NOT NULL,
  metadata_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_artifacts_topic ON artifacts(topic_id);

CREATE TABLE IF NOT EXISTS message_artifact_refs (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, artifact_id)
);

CREATE TABLE IF NOT EXISTS cron_jobs (
  id TEXT PRIMARY KEY,
  origin_topic_id TEXT,
  pi_cron_id TEXT NOT NULL,
  cron_expr TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  next_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cron_runs (
  id TEXT PRIMARY KEY,
  cron_id TEXT NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
  triggered_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,
  result_message_id TEXT,
  summary TEXT,
  duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS interactions (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL,
  message_id TEXT,
  kind TEXT NOT NULL,
  prompt TEXT NOT NULL,
  options_json TEXT,
  status TEXT NOT NULL,
  response_json TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS usage_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_micro_usd INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_topic_time ON usage_records(topic_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_model_time ON usage_records(model, created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  detail_json TEXT
);

CREATE TABLE IF NOT EXISTS sop_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  description TEXT,
  agent_type TEXT NOT NULL,
  system_prompt_addon TEXT,
  plan_template TEXT,
  todos_template_json TEXT,
  workflow_mode TEXT NOT NULL DEFAULT 'lazy',
  builtin INTEGER DEFAULT 0 NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sop_templates_type ON sop_templates(agent_type);
