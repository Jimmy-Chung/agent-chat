export const config = {
  port: Number(process.env.PORT) || 7331,
  host: '127.0.0.1',
  token: process.env.AGENT_CHAT_TOKEN || 'test-token',
  wsPath: '/api/agent-chat/v1/socket',
}
