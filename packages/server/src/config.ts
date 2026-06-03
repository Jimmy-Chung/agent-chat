import { DEFAULT_PI_ADAPTER_URL } from '@agent-chat/protocol'

export interface Env {
  DB: D1Database
  TOPIC_DO: DurableObjectNamespace
  R2?: R2Bucket
  AGENT_CHAT_TOKEN?: string
  R2_ACCOUNT_ID?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_BUCKET?: string
  R2_PUBLIC_URL?: string
  LOG_LEVEL?: string
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
  /** Public base URL of the agent-chat web app (for pairing `/pair` links). */
  AGENT_CHAT_WEB_URL?: string
  /** Attention 面板分析用 LLM（agent-chat 自配，不复用 adapter 的 provider）。 */
  ATTENTION_LLM_API_KEY?: string
  ATTENTION_LLM_BASE_URL?: string
  ATTENTION_LLM_MODEL?: string
}

export interface AppConfig {
  token: string
  piAdapterUrl: string
  originalPiAdapterUrl: string
  piAdapterToken: string
  artifactTokenSecret: string
  logLevel: string
  r2: {
    accountId: string
    accessKeyId: string
    secretAccessKey: string
    bucket: string
    publicUrl: string
  }
  vapidPublicKey: string
  vapidPrivateKey: string
  vapidSubject: string
  webBaseUrl: string
  /** Paired-device credential for JIT JWT signing (WS connection + HTTP proxy). */
  deviceCredential?: string
  adapterInstanceId?: string
  /** Server origin used as JWT `iss` claim in DO contexts (no request URL). */
  serverOrigin?: string
  /** Attention 面板分析用 LLM（OpenAI 兼容）。三者任一为空即视为未配置 → 降级。 */
  attentionLlm: {
    apiKey: string
    baseUrl: string
    model: string
  }
}

export function createConfig(env: Env): AppConfig {
  return {
    token: env.AGENT_CHAT_TOKEN || '',
    piAdapterUrl: DEFAULT_PI_ADAPTER_URL,
    originalPiAdapterUrl: DEFAULT_PI_ADAPTER_URL,
    piAdapterToken: '',
    artifactTokenSecret: env.AGENT_CHAT_TOKEN || 'agent-chat-local-artifacts',
    logLevel: env.LOG_LEVEL || 'info',
    r2: {
      accountId: env.R2_ACCOUNT_ID || '',
      accessKeyId: env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: env.R2_SECRET_ACCESS_KEY || '',
      bucket: env.R2_BUCKET || 'agent-chat-artifacts',
      publicUrl: env.R2_PUBLIC_URL || '',
    },
    vapidPublicKey: env.VAPID_PUBLIC_KEY || '',
    vapidPrivateKey: env.VAPID_PRIVATE_KEY || '',
    vapidSubject: env.VAPID_SUBJECT || 'mailto:admin@example.com',
    webBaseUrl: env.AGENT_CHAT_WEB_URL || '',
    attentionLlm: {
      apiKey: env.ATTENTION_LLM_API_KEY || '',
      baseUrl: env.ATTENTION_LLM_BASE_URL || '',
      model: env.ATTENTION_LLM_MODEL || '',
    },
  }
}
