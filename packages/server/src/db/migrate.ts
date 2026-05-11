import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import { config } from '../config'
import { logger } from '../logger'
import fs from 'node:fs'
import path from 'node:path'

let _db: ReturnType<typeof drizzle> | null = null
let _sqlite: Database.Database | null = null

export function getDb() {
  if (_db) return _db

  const dir = path.dirname(config.dbPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  _sqlite = new Database(config.dbPath)
  _sqlite.pragma('journal_mode = WAL')
  _sqlite.pragma('synchronous = NORMAL')

  _db = drizzle(_sqlite, { schema })

  return _db
}

export function getSqlite(): Database.Database {
  if (!_sqlite) getDb()
  return _sqlite!
}

const MIGRATION_TABLE = '__drizzle_migrations'

export function runMigrations() {
  const sqlite = getSqlite()

  // Ensure migration tracking table exists
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL UNIQUE,
      created_at INTEGER
    );
  `)

  // Run migration SQL files from the drizzle folder
  const migrationsDir = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../../drizzle',
  )

  // Read and execute the initial migration
  const sqlFile = path.join(migrationsDir, '0000_initial.sql')
  if (fs.existsSync(sqlFile)) {
    const applied = sqlite
      .prepare(
        `SELECT hash FROM ${MIGRATION_TABLE} WHERE hash = ?`,
      )
      .get('0000_initial')

    if (!applied) {
      const sql = fs.readFileSync(sqlFile, 'utf-8')
      // Remove the __drizzle_migrations table creation from SQL since we already did it
      const filtered = sql
        .split('\n')
        .filter(
          (line) =>
            !line.includes('CREATE TABLE IF NOT EXISTS __drizzle_migrations'),
        )
        .join('\n')
      sqlite.exec(filtered)
      sqlite
        .prepare(
          `INSERT INTO ${MIGRATION_TABLE} (hash, created_at) VALUES (?, ?)`,
        )
        .run('0000_initial', Date.now())
      logger.info('Applied migration: 0000_initial')
    }
  }

  // Run 0001: add turn_id column
  {
    const hash = '0001_turn_id'
    const applied = sqlite
      .prepare(`SELECT hash FROM ${MIGRATION_TABLE} WHERE hash = ?`)
      .get(hash)

    if (!applied) {
      const sqlFile = path.join(migrationsDir, '0001_turn_id.sql')
      if (fs.existsSync(sqlFile)) {
        const sql = fs.readFileSync(sqlFile, 'utf-8')
        sqlite.exec(sql)
        sqlite
          .prepare(`INSERT INTO ${MIGRATION_TABLE} (hash, created_at) VALUES (?, ?)`)
          .run(hash, Date.now())
        logger.info('Applied migration: 0001_turn_id')
      }
    }
  }

  // Run 0002: add plan_mode column to topics
  {
    const hash = '0002_plan_mode'
    const applied = sqlite
      .prepare(`SELECT hash FROM ${MIGRATION_TABLE} WHERE hash = ?`)
      .get(hash)

    if (!applied) {
      const sqlFile = path.join(migrationsDir, '0002_plan_mode.sql')
      if (fs.existsSync(sqlFile)) {
        const sql = fs.readFileSync(sqlFile, 'utf-8')
        sqlite.exec(sql)
        sqlite
          .prepare(`INSERT INTO ${MIGRATION_TABLE} (hash, created_at) VALUES (?, ?)`)
          .run(hash, Date.now())
        logger.info('Applied migration: 0002_plan_mode')
      }
    }
  }

  // Create FTS5 virtual table
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      message_id UNINDEXED,
      topic_id UNINDEXED,
      content,
      tokenize = 'porter unicode61'
    );
  `)

  logger.info('Database migrations complete')
}

export function setDb(
  db: ReturnType<typeof drizzle>,
  sqlite: Database.Database,
) {
  _db = db
  _sqlite = sqlite
}

export function resetDb() {
  if (_sqlite) {
    _sqlite.close()
  }
  _sqlite = null
  _db = null
}

export function closeDb() {
  if (_sqlite) {
    _sqlite.close()
    _sqlite = null
    _db = null
  }
}
