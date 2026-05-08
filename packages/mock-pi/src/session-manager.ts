import type { WebSocket } from 'ws'
import type { ScenarioRunner } from './scenario-runner'
import type { CronSimulator } from './cron-simulator'
import type {
  CreateSessionParams,
  PIPayload,
} from '@agent-chat/protocol'
import { encodeFrame, createFrame } from '@agent-chat/protocol'
import pino from 'pino'

const log = pino({ name: 'session-manager' })

interface Session {
  sessionId: string
  kind: 'programming' | 'general'
  programming?: CreateSessionParams['programming']
  general?: CreateSessionParams['general']
  ws: WebSocket | null
  seq: number
  abortController: AbortController | null
  pendingInteraction: string | null
}

export interface SessionManager {
  createSession(params: CreateSessionParams): { sessionId: string }
  attachSession(sessionId: string, ws: WebSocket): void
  detachExtension(sessionId: string): void
  destroySession(sessionId: string): void
  abortSession(sessionId: string): void
  sendUserMessage(sessionId: string, content: string): { messageId: string }
  resolveInteraction(
    sessionId: string,
    interactionId: string,
    decision: string,
  ): void
  getWs(sessionId: string): WebSocket | null
  getSeq(sessionId: string): number
  setSeq(sessionId: string, seq: number): void
  activeSessionCount(): number
}

export function createSessionManager(
  runner: ScenarioRunner,
  cronSim: CronSimulator,
): SessionManager {
  const sessions = new Map<string, Session>()
  let idCounter = 0
  void cronSim

  function emitEvent(session: Session, payload: PIPayload) {
    if (!session.ws || session.ws.readyState !== 1) return
    const event = {
      seq: session.seq,
      sessionId: session.sessionId,
      ts: Date.now(),
      payload,
    }
    const frame = createFrame('pi.event', event, undefined, session.seq)
    session.ws.send(encodeFrame(frame))
    session.seq++
  }

  function createSession(params: CreateSessionParams): { sessionId: string } {
    const sessionId = `sess-${++idCounter}`
    const session: Session = {
      sessionId,
      kind: params.kind,
      programming: params.programming,
      general: params.general,
      ws: null,
      seq: 1,
      abortController: null,
      pendingInteraction: null,
    }
    sessions.set(sessionId, session)
    log.info({ sessionId, kind: params.kind }, 'session created')
    return { sessionId }
  }

  function attachSession(sessionId: string, ws: WebSocket): void {
    const session = sessions.get(sessionId)
    if (!session) throw new Error(`session not found: ${sessionId}`)
    session.ws = ws
    log.info({ sessionId }, 'session attached')

    // Send agent.status = idle on attach
    emitEvent(session, { kind: 'agent.status', state: 'idle' })
  }

  function detachExtension(sessionId: string): void {
    const session = sessions.get(sessionId)
    if (!session) throw new Error(`session not found: ${sessionId}`)
    session.kind = 'general'
    session.programming = undefined
    log.info({ sessionId }, 'extension detached, now general')
  }

  function destroySession(sessionId: string): void {
    const session = sessions.get(sessionId)
    if (!session) throw new Error(`session not found: ${sessionId}`)
    if (session.abortController) session.abortController.abort()
    sessions.delete(sessionId)
    log.info({ sessionId }, 'session destroyed')
  }

  function abortSession(sessionId: string): void {
    const session = sessions.get(sessionId)
    if (!session) throw new Error(`session not found: ${sessionId}`)
    if (session.abortController) {
      session.abortController.abort()
      session.abortController = null
    }
    emitEvent(session, { kind: 'agent.status', state: 'idle' })
    log.info({ sessionId }, 'session aborted')
  }

  function sendUserMessage(
    sessionId: string,
    content: string,
  ): { messageId: string } {
    const session = sessions.get(sessionId)
    if (!session) throw new Error(`session not found: ${sessionId}`)
    if (!session.ws || session.ws.readyState !== 1) {
      throw new Error(`session has no active WS: ${sessionId}`)
    }

    const messageId = `msg-${Date.now()}`
    const ac = new AbortController()
    session.abortController = ac

    // Fire and forget — the scenario runs asynchronously
    const ws = session.ws
    runScenario(session, ws, content, messageId, ac).catch((err) => {
      if (ac.signal.aborted) return
      log.error({ sessionId, err }, 'scenario error')
      emitEvent(session, {
        kind: 'error',
        code: 'SCENARIO_ERROR',
        message: String(err),
        recoverable: true,
      })
    })

    return { messageId }
  }

  async function runScenario(
    session: Session,
    ws: WebSocket,
    content: string,
    _messageId: string,
    ac: AbortController,
  ) {
    emitEvent(session, { kind: 'agent.status', state: 'thinking' })

    const seqStart = session.seq
    const newSeq = await runner.run(session.sessionId, ws, content, seqStart, (payload) => {
      // If this was an interaction.request, store it and pause
      if (payload.kind === 'interaction.request') {
        session.pendingInteraction = payload.interactionId
      }
    })

    if (ac.signal.aborted) return
    session.seq = newSeq
    session.abortController = null
    emitEvent(session, { kind: 'agent.status', state: 'idle' })
  }

  function resolveInteraction(
    sessionId: string,
    interactionId: string,
    _decision: string,
  ): void {
    const session = sessions.get(sessionId)
    if (!session) throw new Error(`session not found: ${sessionId}`)
    if (session.pendingInteraction !== interactionId) {
      throw new Error(
        `interaction not pending: ${interactionId} (expected ${session.pendingInteraction})`,
      )
    }

    session.pendingInteraction = null

    // Continue the approval scenario — emit remaining events
    if (!session.ws || session.ws.readyState !== 1) return

    const remainingPayloads: PIPayload[] = [
      {
        kind: 'tool.call',
        toolUseId: 'tu-approval-1',
        messageId: 'msg-approval-1',
        name: 'Edit',
        input: {
          file_path: '/src/app.ts',
          old_string: 'old content',
          new_string: 'new content',
        },
      },
      {
        kind: 'file.diff',
        messageId: 'msg-approval-1',
        path: '/src/app.ts',
        before: 'old content',
        after: 'new content',
      },
      {
        kind: 'tool.result',
        toolUseId: 'tu-approval-1',
        messageId: 'msg-approval-1',
        output: 'File updated successfully.',
        isError: false,
      },
      {
        kind: 'message.delta',
        messageId: 'msg-approval-1',
        part: { kind: 'text', content: 'Done! Edit applied.' },
      },
      { kind: 'message.end', messageId: 'msg-approval-1', stopReason: 'end_turn' },
      {
        kind: 'usage.delta',
        messageId: 'msg-approval-1',
        model: 'mock-model',
        inputTokens: 80,
        outputTokens: 120,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
      },
    ]

    // Use a micro-task chain with delays for realistic pacing
    const delay = () =>
      new Promise<void>((r) => setTimeout(r, 50 + Math.random() * 150))

    ;(async () => {
      for (const payload of remainingPayloads) {
        if (session.abortController?.signal.aborted) return
        emitEvent(session, payload)
        await delay()
      }
      session.abortController = null
      emitEvent(session, { kind: 'agent.status', state: 'idle' })
    })().catch((err) => {
      log.error({ sessionId, err }, 'error in resolve continuation')
    })
  }

  function getWs(sessionId: string): WebSocket | null {
    return sessions.get(sessionId)?.ws ?? null
  }

  function getSeq(sessionId: string): number {
    return sessions.get(sessionId)?.seq ?? 1
  }

  function setSeq(sessionId: string, seq: number): void {
    const session = sessions.get(sessionId)
    if (session) session.seq = seq
  }

  function activeSessionCount(): number {
    let count = 0
    for (const s of sessions.values()) {
      if (s.ws && s.ws.readyState === 1) count++
    }
    return count
  }

  return {
    createSession,
    attachSession,
    detachExtension,
    destroySession,
    abortSession,
    sendUserMessage,
    resolveInteraction,
    getWs,
    getSeq,
    setSeq,
    activeSessionCount,
  }
}
