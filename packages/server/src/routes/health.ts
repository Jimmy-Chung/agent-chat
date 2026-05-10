import type { FastifyInstance } from 'fastify'
import fs from 'node:fs'
import { config } from '../config'
import type { PiClient } from '../pi/client'

export function registerHealthRoute(
  app: FastifyInstance,
  pi: PiClient,
): void {
  app.get('/healthz', async (_req, reply) => {
    let dbSize = 0
    try {
      const stat = fs.statSync(config.dbPath)
      dbSize = stat.size
    } catch {
      // DB file may not exist yet
    }

    reply.send({
      status: 'ok',
      pi: pi.isConnected ? 'connected' : 'disconnected',
      dbSizeBytes: dbSize,
      timestamp: Date.now(),
    })
  })
}
