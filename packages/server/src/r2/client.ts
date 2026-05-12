import type { AppConfig } from '../config'
import { logger } from '../logger'

export interface R2ClientResult {
  ok: boolean
  error?: string
}

let r2Available = false

export async function initR2(_config: AppConfig): Promise<R2ClientResult> {
  // R2 presigned URL via AWS SDK not supported in Workers runtime.
  // Use Cloudflare Workers native R2 binding (env.R2) when available.
  r2Available = false
  logger.info('R2 presigned URL disabled (requires native R2 binding)')
  return { ok: true }
}

export function getPublicUrl(key: string): string {
  return key
}

export function isR2Available(): boolean {
  return r2Available
}
