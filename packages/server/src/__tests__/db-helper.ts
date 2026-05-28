import { env } from 'cloudflare:test'
import { initDb, runMigrations, resetDb } from '../db/migrate'
import { discardPendingPartFlushForTests } from '../db/repos/message.repo'

// Uses miniflare's D1 binding (same runtime as production Workers).
// Each test file gets a fresh D1 isolate; migrations run once per file.

export async function setupTestDb(): Promise<void> {
  initDb(env.DB)
  await runMigrations()
}

export function teardownTestDb(): void {
  discardPendingPartFlushForTests()
  resetDb()
}
