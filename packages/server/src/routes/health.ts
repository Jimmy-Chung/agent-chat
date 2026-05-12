import type { Context, Env as HonoEnv } from 'hono'
import type { D1Database } from '@cloudflare/workers-types'
import { getD1 } from '../db/migrate'

interface HealthEnv extends HonoEnv {
  Bindings: {
    DB: D1Database
  }
}

export async function healthHandler(c: Context<HealthEnv>): Promise<Response> {
  try {
    const d1 = getD1()
    // Verify D1 connectivity with a simple query
    await d1.prepare('SELECT 1').first()
    return c.json({
      status: 'ok',
      db: 'connected',
      timestamp: Date.now(),
    })
  } catch {
    return c.json({
      status: 'degraded',
      db: 'disconnected',
      timestamp: Date.now(),
    }, 503)
  }
}
