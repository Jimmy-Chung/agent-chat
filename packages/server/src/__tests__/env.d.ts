import type { Env } from '../config'

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    // AGENT_CHAT_TOKEN is set via vitest.config.ts miniflare.bindings
    AGENT_CHAT_TOKEN?: string
  }
}
