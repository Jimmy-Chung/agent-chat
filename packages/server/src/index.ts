import 'dotenv/config'
import Fastify from 'fastify'
import { WebSocketServer } from 'ws'
import { config } from './config'
import { logger } from './logger'
import { runMigrations, closeDb } from './db/migrate'
import { wsHub } from './ws/hub'
import { piClient } from './pi/client'
import { routePiEvents } from './pi/event-router'
import { registerTopicHandlers } from './ws/handlers/topic.handler'
import { registerMessageHandlers } from './ws/handlers/message.handler'
import { registerInteractionHandlers } from './ws/handlers/interaction.handler'
import { registerCronHandlers } from './ws/handlers/cron.handler'
import { registerArtifactHandlers } from './ws/handlers/artifact.handler'
import { registerSearchHandlers } from './ws/handlers/search.handler'
import { registerSopTemplateHandlers } from './ws/handlers/sop_template.handler'
import { registerHealthRoute } from './routes/health'
import { seedSystemTopics } from './seed'
import * as topicRepo from './db/repos/topic.repo'
import { initR2 } from './r2/client'

async function main() {
  logger.info({ config: { ...config, token: '***', r2: '***' } }, 'Starting server')

  // Init DB
  runMigrations()

  // Seed system topics
  seedSystemTopics()

  // Init R2 (optional)
  await initR2()

  // Setup Fastify
  const app = Fastify({ logger: false })

  // Health route
  registerHealthRoute(app, piClient)

  // Create HTTP server
  await app.ready()
  const server = app.server

  // WebSocket server
  const wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (ws, req) => {
    // Extract token from URL query or headers
    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    const token =
      url.searchParams.get('token') ||
      req.headers.authorization?.replace('Bearer ', '')

    const ok = wsHub.addClient(ws, token)
    if (ok) {
      // Send initial topics list
      const topics = topicRepo.listTopics()
      wsHub.sendToClient(ws, {
        type: 'topics.list',
        data: { topics },
      })
    }
  })

  // Register WS handlers
  registerTopicHandlers(wsHub, piClient)
  registerMessageHandlers(wsHub, piClient)
  registerInteractionHandlers(wsHub, piClient)
  registerCronHandlers(wsHub, piClient)
  registerArtifactHandlers(wsHub)
  registerSearchHandlers(wsHub)
  registerSopTemplateHandlers(wsHub)

  // Start heartbeat
  wsHub.startHeartbeat()

  // Route PI events to WS hub
  routePiEvents(piClient, wsHub)

  // Start server
  server.listen(config.port, config.host, () => {
    logger.info(`Server listening on ${config.host}:${config.port}`)

    // Restore PI sessions for existing topics
    restorePiSessions()
  })

  async function restorePiSessions() {
    const topics = topicRepo.listTopics()
    const withSession = topics.filter((t) => t.pi_session_id && t.kind === 'normal')
    if (withSession.length === 0) return

    logger.info({ count: withSession.length }, 'Restoring PI sessions...')
    for (const topic of withSession) {
      try {
        await piClient.reconnectSession(topic.pi_session_id!)
        logger.info({ topicId: topic.id, sessionId: topic.pi_session_id }, 'PI session restored')
      } catch (err) {
        logger.warn({ err, topicId: topic.id, sessionId: topic.pi_session_id }, 'Failed to restore PI session, clearing stale session ID')
        topicRepo.updateTopic(topic.id, { pi_session_id: null })
      }
    }
  }

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...')
    wsHub.closeAll()
    piClient.disconnect()
    await app.close()
    closeDb()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server')
  process.exit(1)
})
