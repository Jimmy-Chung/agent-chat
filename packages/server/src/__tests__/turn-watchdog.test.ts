import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  clearPendingTurnWatchdog,
  startPendingTurnWatchdog,
} from '../pi/event-router'

interface BroadcastEvent {
  type: string
  data: unknown
}

function createBroadcaster() {
  const events: BroadcastEvent[] = []
  return {
    broadcast(type: string, data: unknown) {
      events.push({ type, data })
    },
    events,
  }
}

describe('BUG-040 ④ — turn watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires error + agent.status idle when no PI event arrives in time', () => {
    const broadcaster = createBroadcaster()
    startPendingTurnWatchdog('topic-1', 'user-msg-1', broadcaster, 30_000)

    vi.advanceTimersByTime(29_999)
    expect(broadcaster.events).toHaveLength(0)

    vi.advanceTimersByTime(1)
    expect(broadcaster.events).toEqual([
      {
        type: 'error',
        data: {
          code: 'TURN_NO_RESPONSE',
          message: expect.any(String),
          details: {
            topicId: 'topic-1',
            userMessageId: 'user-msg-1',
            timeoutMs: 30_000,
          },
        },
      },
      {
        type: 'agent.status',
        data: { topicId: 'topic-1', state: 'idle' },
      },
    ])
  })

  it('does not fire when watchdog is cleared before timeout', () => {
    const broadcaster = createBroadcaster()
    startPendingTurnWatchdog('topic-1', 'user-msg-1', broadcaster, 30_000)
    clearPendingTurnWatchdog('topic-1')

    vi.advanceTimersByTime(60_000)
    expect(broadcaster.events).toHaveLength(0)
  })

  it('clearing one topic does not affect another topic watchdog', () => {
    const broadcaster = createBroadcaster()
    startPendingTurnWatchdog('topic-1', 'msg-1', broadcaster, 30_000)
    startPendingTurnWatchdog('topic-2', 'msg-2', broadcaster, 30_000)

    clearPendingTurnWatchdog('topic-1')

    vi.advanceTimersByTime(30_000)
    expect(broadcaster.events.map((e) => e.type)).toEqual(['error', 'agent.status'])
    expect((broadcaster.events[0].data as { details: { topicId: string } }).details.topicId).toBe('topic-2')

    clearPendingTurnWatchdog('topic-2')
  })

  it('starting a new watchdog for the same topic resets the timer', () => {
    const broadcaster = createBroadcaster()
    startPendingTurnWatchdog('topic-1', 'msg-1', broadcaster, 30_000)

    vi.advanceTimersByTime(20_000)
    // Re-arm: should clear previous timer and start fresh.
    startPendingTurnWatchdog('topic-1', 'msg-2', broadcaster, 30_000)

    vi.advanceTimersByTime(20_000)
    expect(broadcaster.events).toHaveLength(0)

    vi.advanceTimersByTime(10_000)
    expect(broadcaster.events.map((e) => e.type)).toEqual(['error', 'agent.status'])
    expect((broadcaster.events[0].data as { details: { userMessageId: string } }).details.userMessageId).toBe('msg-2')

    clearPendingTurnWatchdog('topic-1')
  })
})
