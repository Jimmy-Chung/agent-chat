export const config = {
  port: Number(process.env.PORT) || 8080,
  host: '127.0.0.1',
  token: process.env.AGENT_CHAT_TOKEN || 'test-token',
  piAdapterUrl:
    process.env.PI_ADAPTER_URL ||
    'ws://127.0.0.1:7331/api/agent-chat/v1/socket',
  piAdapterToken: process.env.PI_ADAPTER_TOKEN || 'test-token',
  dbPath: process.env.DB_PATH || './data/agent-chat.db',
  r2: {
    accountId: process.env.R2_ACCOUNT_ID || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucket: process.env.R2_BUCKET || 'agent-chat-artifacts',
    publicUrl: process.env.R2_PUBLIC_URL || '',
  },
}
