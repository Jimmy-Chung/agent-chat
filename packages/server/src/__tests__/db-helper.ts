import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'

// We need to override the module-level _db and _sqlite in migrate.ts
// For tests, we use an in-memory database and set it up directly

let _testSqlite: Database.Database | null = null
let _testDb: ReturnType<typeof drizzle> | null = null

export function setupTestDb(): { db: ReturnType<typeof drizzle>; sqlite: Database.Database } {
  _testSqlite = new Database(':memory:')
  _testSqlite.pragma('journal_mode = WAL')
  _testSqlite.pragma('synchronous = NORMAL')

  // Create all tables
  _testSqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      display_name TEXT,
      default_model TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE topics (
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
      plan_mode INTEGER DEFAULT 0 NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived INTEGER DEFAULT 0 NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      stop_reason TEXT,
      cron_run_id TEXT,
      turn_id TEXT
    );
    CREATE INDEX idx_messages_topic ON messages(topic_id, started_at);
    CREATE TABLE message_parts (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      kind TEXT NOT NULL,
      content_json TEXT NOT NULL
    );
    CREATE TABLE artifacts (
      id TEXT PRIMARY KEY,
      topic_id TEXT,
      origin_topic_id TEXT,
      name TEXT NOT NULL,
      mime TEXT,
      size_bytes INTEGER,
      r2_key TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      metadata_json TEXT
    );
    CREATE INDEX idx_artifacts_topic ON artifacts(topic_id);
    CREATE TABLE message_artifact_refs (
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
      PRIMARY KEY (message_id, artifact_id)
    );
    CREATE TABLE cron_jobs (
      id TEXT PRIMARY KEY,
      origin_topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      pi_cron_id TEXT NOT NULL,
      cron_expr TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      next_run_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE cron_runs (
      id TEXT PRIMARY KEY,
      cron_id TEXT NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
      triggered_at INTEGER NOT NULL,
      finished_at INTEGER,
      status TEXT NOT NULL,
      result_message_id TEXT
    );
    CREATE TABLE interactions (
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
    CREATE TABLE usage_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
      message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cost_micro_usd INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_usage_topic_time ON usage_records(topic_id, created_at);
    CREATE INDEX idx_usage_model_time ON usage_records(model, created_at);
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      detail_json TEXT
    );
    CREATE TABLE sop_templates (
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
    CREATE INDEX idx_sop_templates_type ON sop_templates(agent_type);
    CREATE VIRTUAL TABLE messages_fts USING fts5(
      message_id UNINDEXED,
      topic_id UNINDEXED,
      content,
      tokenize = 'porter unicode61'
    );
  `)

  _testDb = drizzle(_testSqlite, { schema })
  return { db: _testDb, sqlite: _testSqlite! }
}

export function teardownTestDb() {
  if (_testSqlite) {
    _testSqlite.close()
    _testSqlite = null
    _testDb = null
  }
}

export function getTestDb() {
  return _testDb!
}

export function getTestSqlite(): Database.Database {
  return _testSqlite!
}
