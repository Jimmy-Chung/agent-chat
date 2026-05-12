import { drizzle } from 'drizzle-orm/d1'
import type { D1Database } from '@cloudflare/workers-types'
import * as schema from './schema'
import { logger } from '../logger'

let _db: ReturnType<typeof drizzle> | null = null
let _d1: D1Database | null = null

export function getDb() {
  if (!_db) throw new Error('DB not initialized. Call initDb(d1) first.')
  return _db
}

export function getD1(): D1Database {
  if (!_d1) throw new Error('D1 not initialized. Call initDb(d1) first.')
  return _d1
}

export function initDb(d1: D1Database) {
  _d1 = d1
  _db = drizzle(d1, { schema })
  return _db
}

export function setDb(d1: D1Database) {
  _d1 = d1
  _db = drizzle(d1, { schema })
}

export function resetDb() {
  _d1 = null
  _db = null
}

const MIGRATION_TABLE = '__drizzle_migrations'

async function execEach(d1: D1Database, sql: string) {
  const stmts = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  for (const stmt of stmts) {
    await d1.prepare(stmt + ';').run()
  }
}

export async function runMigrations() {
  const d1 = getD1()

  // Ensure migration tracking table exists
  await d1
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (id INTEGER PRIMARY KEY, hash TEXT NOT NULL UNIQUE, created_at INTEGER)`
    )
    .run()

  // Run initial migration
  const applied = await d1
    .prepare(`SELECT hash FROM ${MIGRATION_TABLE} WHERE hash = ?`)
    .bind('0000_initial')
    .first()

  if (!applied) {
    await execEach(d1, `
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, display_name TEXT, default_model TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS topics (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, agent_type TEXT NOT NULL, pi_session_id TEXT, programming_spec_json TEXT, general_spec_json TEXT, sop_template_id TEXT, current_model TEXT, history_frozen_at INTEGER, plan_mode INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, stop_reason TEXT, cron_run_id TEXT, turn_id TEXT);
      CREATE INDEX IF NOT EXISTS idx_messages_topic ON messages(topic_id, started_at);
      CREATE TABLE IF NOT EXISTS message_parts (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, ordinal INTEGER NOT NULL, kind TEXT NOT NULL, content_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, topic_id TEXT, origin_topic_id TEXT, name TEXT NOT NULL, mime TEXT, size_bytes INTEGER, r2_key TEXT NOT NULL, source TEXT NOT NULL, created_at INTEGER NOT NULL, metadata_json TEXT);
      CREATE INDEX IF NOT EXISTS idx_artifacts_topic ON artifacts(topic_id);
      CREATE TABLE IF NOT EXISTS message_artifact_refs (message_id TEXT NOT NULL, artifact_id TEXT NOT NULL, PRIMARY KEY (message_id, artifact_id));
      CREATE TABLE IF NOT EXISTS cron_jobs (id TEXT PRIMARY KEY, origin_topic_id TEXT NOT NULL, pi_cron_id TEXT NOT NULL, cron_expr TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL, next_run_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS cron_runs (id TEXT PRIMARY KEY, cron_id TEXT NOT NULL, triggered_at INTEGER NOT NULL, finished_at INTEGER, status TEXT NOT NULL, result_message_id TEXT);
      CREATE TABLE IF NOT EXISTS interactions (id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, message_id TEXT, kind TEXT NOT NULL, prompt TEXT NOT NULL, options_json TEXT, status TEXT NOT NULL, response_json TEXT, created_at INTEGER NOT NULL, resolved_at INTEGER);
      CREATE TABLE IF NOT EXISTS usage_records (id INTEGER PRIMARY KEY, topic_id TEXT, message_id TEXT, model TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cost_micro_usd INTEGER, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_usage_topic_time ON usage_records(topic_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_usage_model_time ON usage_records(model, created_at);
      CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, kind TEXT NOT NULL, detail_json TEXT);
      CREATE TABLE IF NOT EXISTS sop_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, description TEXT, agent_type TEXT NOT NULL, system_prompt_addon TEXT, plan_template TEXT, todos_template_json TEXT, workflow_mode TEXT NOT NULL DEFAULT 'lazy', builtin INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_sop_templates_type ON sop_templates(agent_type);
    `)

    await d1
      .prepare(`INSERT OR IGNORE INTO ${MIGRATION_TABLE} (hash, created_at) VALUES (?, ?)`)
      .bind('0000_initial', Date.now())
      .run()
    logger.info('Applied migration: 0000_initial')
  }

  // Run 0001: add turn_id column
  {
    const hash = '0001_turn_id'
    const applied = await d1
      .prepare(`SELECT hash FROM ${MIGRATION_TABLE} WHERE hash = ?`)
      .bind(hash)
      .first()

    if (!applied) {
      try { await d1.prepare(`ALTER TABLE messages ADD COLUMN turn_id TEXT`).run() } catch { /* column may already exist */ }
      await d1
        .prepare(`INSERT OR IGNORE INTO ${MIGRATION_TABLE} (hash, created_at) VALUES (?, ?)`)
        .bind(hash, Date.now())
        .run()
      logger.info('Applied migration: 0001_turn_id')
    }
  }

  // Run 0002: add plan_mode column to topics
  {
    const hash = '0002_plan_mode'
    const applied = await d1
      .prepare(`SELECT hash FROM ${MIGRATION_TABLE} WHERE hash = ?`)
      .bind(hash)
      .first()

    if (!applied) {
      try { await d1.prepare(`ALTER TABLE topics ADD COLUMN plan_mode INTEGER NOT NULL DEFAULT 0`).run() } catch { /* column may already exist */ }
      await d1
        .prepare(`INSERT OR IGNORE INTO ${MIGRATION_TABLE} (hash, created_at) VALUES (?, ?)`)
        .bind(hash, Date.now())
        .run()
      logger.info('Applied migration: 0002_plan_mode')
    }
  }

  // Create FTS5 virtual table (porter tokenizer not available in D1, use unicode61)
  try {
    await d1
      .prepare(`CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(message_id UNINDEXED, topic_id UNINDEXED, content, tokenize = 'unicode61')`)
      .run()
  } catch (err) {
    logger.warn({ err }, 'FTS5 virtual table creation failed, full-text search unavailable')
  }

  logger.info('Database migrations complete')
}
