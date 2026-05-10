import 'dotenv/config'
import { config } from './config'
import { createScenarioRunner } from './scenario-runner'
import { createCronSimulator } from './cron-simulator'
import { createSessionManager } from './session-manager'
import { createMockServer } from './server'
import pino from 'pino'

const log = pino({ name: 'mock-pi' })

async function main() {
  const runner = createScenarioRunner()

  // Wire cron simulator to session manager (circular dep resolved via getters)
  // These will be set after sessionManager is created
  let sessionManagerRef: ReturnType<typeof createSessionManager> | null = null

  const cronSim = createCronSimulator(
    runner,
    (sessionId) => sessionManagerRef?.getWs(sessionId) ?? null,
    (sessionId) => sessionManagerRef?.getSeq(sessionId) ?? 1,
    (sessionId, seq) => sessionManagerRef?.setSeq(sessionId, seq),
  )

  const sessionManager = createSessionManager(runner, cronSim)
  sessionManagerRef = sessionManager

  const server = createMockServer(sessionManager, cronSim)

  await server.start()
  log.info(`mock-pi server started on ${config.host}:${config.port}`)
  log.info(`websocket path: ${config.wsPath}`)

  const shutdown = async () => {
    log.info('shutting down...')
    await server.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  log.error(err, 'failed to start')
  process.exit(1)
})
