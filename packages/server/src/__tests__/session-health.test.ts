import { describe, expect, it } from 'vitest'
import { buildConnectedSessionHealthPayload } from '../ws/session-health'

describe('session-health helpers', () => {
  it('builds connected payload when topic session is attached', () => {
    expect(buildConnectedSessionHealthPayload({
      topicId: 'topic-1',
      piSessionId: 'sess-1',
      isAttached: true,
    })).toEqual({
      topicId: 'topic-1',
      state: 'connected',
      piSessionId: 'sess-1',
    })
  })

  it('returns null when no session is attached', () => {
    expect(buildConnectedSessionHealthPayload({
      topicId: 'topic-1',
      piSessionId: 'sess-1',
      isAttached: false,
    })).toBeNull()

    expect(buildConnectedSessionHealthPayload({
      topicId: 'topic-1',
      piSessionId: null,
      isAttached: true,
    })).toBeNull()
  })
})
