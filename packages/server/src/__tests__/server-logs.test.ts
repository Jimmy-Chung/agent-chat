import { describe, expect, it, beforeAll } from 'vitest'
import { setupTestDb } from './db-helper'
import { clearLogs, getLogs, logGatewayEvent, logPiEvent } from '../server-logs'

describe('server logs', () => {
  beforeAll(async () => {
    await setupTestDb()
    await clearLogs()
  })

  it('persists and queries logs from D1', async () => {
    await logPiEvent('sess-1', {
      seq: 1,
      turnId: 'turn-1',
      payload: { kind: 'message.delta', messageId: 'msg-1' },
    })
    await logGatewayEvent({
      eventKind: 'sendUserMessage.dispatch',
      sessionId: 'sess-1',
      topicId: 'topic-1',
      messageId: 'msg-1',
      clientMessageId: 'cm-1',
      status: 'dispatching',
      payload: { contentLength: 3 },
    })

    const all = await getLogs()
    expect(all.count).toBe(2)
    expect(all.entries[0]?.eventKind).toBe('sendUserMessage.dispatch')
    expect(all.entries[1]?.eventKind).toBe('message.delta')

    const filtered = await getLogs({ sessionId: 'sess-1' })
    expect(filtered.count).toBe(2)

    const topicFiltered = await getLogs({ topicId: 'topic-1' })
    expect(topicFiltered.count).toBe(1)
  })
})
