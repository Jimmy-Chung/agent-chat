import type { WebSocket } from 'ws'
import type { SessionManager } from './session-manager'
import type { CronSimulator } from './cron-simulator'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import { decodeFrame, encodeFrame, createFrame, rpcRequestSchema } from '@agent-chat/protocol'
import { config } from './config'
import pino from 'pino'

const log = pino({ name: 'mock-pi-server' })

export interface MockServer {
  start(): Promise<void>
  stop(): Promise<void>
  port(): number
}

export function createMockServer(
  sessionManager: SessionManager,
  cronSim: CronSimulator,
): MockServer {
  const httpServer = createServer((req, res) => {
    if (req.url === '/healthz' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          ok: true,
          activeSessions: sessionManager.activeSessionCount(),
        }),
      )
      return
    }
    res.writeHead(404)
    res.end('not found')
  })

  const wss = new WebSocketServer({
    server: httpServer,
    path: config.wsPath,
  })

  let pingInterval: ReturnType<typeof setInterval> | null = null

  wss.on('connection', (ws: WebSocket, req) => {
    // Auth check: accept token from Authorization header OR query parameter
    const authHeader = req.headers.authorization
    const headerToken = authHeader?.replace('Bearer ', '') || undefined
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const queryToken = url.searchParams.get('token') ?? undefined
    const token = headerToken ?? queryToken

    if (token !== config.token) {
      log.warn('auth failed, closing with 4401')
      ws.close(4401, 'Unauthorized')
      return
    }

    log.info('client connected')

    // Send adapter.ready event immediately after connection
    const readyEvent = {
      seq: 0,
      sessionId: '',
      ts: Date.now(),
      payload: {
        kind: 'adapter.ready',
        adapterInstanceId: 'mock-pi',
        startupTime: Date.now(),
        version: '1.0.0',
      },
    }
    ws.send(encodeFrame(createFrame('event', readyEvent)))

    // Ping/pong heartbeat
    const alive = () => {
      if (ws.readyState === 1) ws.ping()
    }
    const heartbeat = setInterval(alive, 30000)
    ws.on('pong', () => {
      // still alive
    })
    ws.on('close', () => clearInterval(heartbeat))

    // Handle incoming frames
    ws.on('message', (raw: Buffer) => {
      try {
        const frame = decodeFrame(raw.toString())
        handleFrame(ws, frame)
      } catch (err) {
        log.error({ err }, 'failed to decode frame')
        sendError(ws, 'DECODE_ERROR', 'Invalid frame')
      }
    })
  })

  function handleFrame(ws: WebSocket, frame: ReturnType<typeof decodeFrame>) {
    if (frame.t === 'rpc') {
      handleRpc(ws, frame)
    } else {
      log.warn({ type: frame.t }, 'unknown frame type')
    }
  }

  function handleRpc(ws: WebSocket, frame: ReturnType<typeof decodeFrame>) {
    const parsed = rpcRequestSchema.safeParse(frame.d)
    if (!parsed.success) {
      sendError(ws, 'INVALID_RPC', 'Invalid RPC request')
      return
    }

    const { method, params } = parsed.data
    const id = frame.id ?? ''

    try {
      const result = dispatchRpc(ws, method, params)
      const reply = createFrame('rpc.result', { result }, id)
      ws.send(encodeFrame(reply))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const reply = createFrame('rpc.error', { code: 'RPC_ERROR', message }, id)
      ws.send(encodeFrame(reply))
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function dispatchRpc(ws: WebSocket, method: string, params: any): any {
    switch (method) {
      case 'createSession': {
        const res = sessionManager.createSession(params)
        // Auto-attach calling client (matches adapter v1.6.0 behavior)
        sessionManager.attachSession(res.sessionId, ws)
        return res
      }
      case 'attachSession': {
        sessionManager.attachSession(params.sessionId, ws)
        return { ok: true }
      }
      case 'detachExtension': {
        sessionManager.detachExtension(params.sessionId)
        return { ok: true }
      }
      case 'destroySession': {
        sessionManager.destroySession(params.sessionId)
        return { ok: true }
      }
      case 'abortSession': {
        sessionManager.abortSession(params.sessionId)
        return { ok: true }
      }
      case 'resumeSession': {
        // Try attach first; if session not found, recreate
        try {
          sessionManager.attachSession(params.sessionId, ws)
          return { sessionId: params.sessionId, resumed: true, replayedCount: 0 }
        } catch {
          const result = sessionManager.createSession(params)
          sessionManager.attachSession(result.sessionId, ws)
          return { sessionId: result.sessionId, resumed: false, replayedCount: 0 }
        }
      }
      case 'sendUserMessage': {
        return sessionManager.sendUserMessage(params.sessionId, params.content)
      }
      case 'resolveInteraction': {
        sessionManager.resolveInteraction(
          params.sessionId,
          params.interactionId,
          params.decision,
        )
        return { ok: true }
      }
      case 'createCron': {
        return cronSim.createCron(
          params.originSessionId,
          params.cronExpr,
          params.prompt,
        )
      }
      case 'listCrons': {
        return cronSim.listCrons()
      }
      case 'pauseCron': {
        cronSim.pauseCron(params.cronId)
        return { ok: true }
      }
      case 'resumeCron': {
        cronSim.resumeCron(params.cronId)
        return { ok: true }
      }
      case 'deleteCron': {
        cronSim.deleteCron(params.cronId)
        return { ok: true }
      }
      case 'setSessionModel': {
        return { ok: true }
      }
      case 'setPlanMode': {
        return { ok: true }
      }
      case 'getUsage': {
        return {
          totalInputTokens: 0,
          totalOutputTokens: 0,
          byModel: {},
        }
      }
      default:
        throw new Error(`unknown RPC method: ${method}`)
    }
  }

  function sendError(ws: WebSocket, code: string, message: string) {
    if (ws.readyState !== 1) return
    const frame = createFrame('error', { code, message })
    ws.send(encodeFrame(frame))
  }

  function start(): Promise<void> {
    return new Promise((resolve) => {
      httpServer.listen(config.port, config.host, () => {
        log.info(`listening on ${config.host}:${config.port}`)
        pingInterval = setInterval(() => {
          for (const ws of wss.clients) {
            const ext = ws as WebSocket
            if (ext.readyState === 1) ext.ping()
          }
        }, 30000)
        resolve()
      })
    })
  }

  function stop(): Promise<void> {
    return new Promise((resolve) => {
      if (pingInterval) clearInterval(pingInterval)
      cronSim.stopAll()
      for (const ws of wss.clients) {
        ws.close(1001, 'server shutting down')
      }
      wss.close(() => {
        httpServer.close(() => {
          log.info('server stopped')
          resolve()
        })
      })
    })
  }

  return { start, stop, port: () => config.port }
}
