export interface Env {
  DB: D1Database
  TOPIC_DO: DurableObjectNamespace
  AGENT_CHAT_TOKEN?: string
  PI_ADAPTER_URL?: string
  PI_ADAPTER_TOKEN?: string
  R2_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_BUCKET?: string
  R2_PUBLIC_URL?: string
  LOG_LEVEL?: string
}

export interface AppConfig {
  token: string
  piAdapterUrl: string
  piAdapterToken: string
  logLevel: string
  r2: {
    accountId: string
    accessKeyId: string
    secretAccessKey: string
    bucket: string
    publicUrl: string
  }
}

export function createConfig(env: Env): AppConfig {
  return {
    token: env.AGENT_CHAT_TOKEN || '',
    piAdapterUrl:
      env.PI_ADAPTER_URL ||
      'ws://127.0.0.1:7331/api/agent-chat/v1/socket',
    piAdapterToken: env.PI_ADAPTER_TOKEN || '1234',
    logLevel: env.LOG_LEVEL || 'info',
    r2: {
      accountId: env.R2_ACCOUNT_ID || '',
      accessKeyId: env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: env.R2_SECRET_ACCESS_KEY || '',
      bucket: env.R2_BUCKET || 'agent-chat-artifacts',
      publicUrl: env.R2_PUBLIC_URL || '',
    },
  }
}
