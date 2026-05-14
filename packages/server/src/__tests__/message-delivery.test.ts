import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getTopic } = vi.hoisted(() => ({
  getTopic: vi.fn(),
}))

vi.mock('../db/repos/topic.repo', () => ({
  getTopic,
}))

import { restoreExistingTopicSession } from '../ws/message-delivery'

describe('message-delivery session restore', () => {
  beforeEach(() => {
    getTopic.mockReset()
  })

  it('reconnects a stored session when topic.select restores an old topic', async () => {
    getTopic.mockResolvedValue({
      id: 'topic-1',
      pi_session_id: 'sess-1',
    })

    const pi = {
      hasSession: vi.fn().mockReturnValue(false),
      reconnectSession: vi.fn().mockResolvedValue(undefined),
      recreateSession: vi.fn(),
      disconnectSession: vi.fn(),
    }

    await expect(restoreExistingTopicSession('topic-1', pi as never)).resolves.toBe(true)
    expect(pi.reconnectSession).toHaveBeenCalledWith('sess-1')
    expect(pi.recreateSession).not.toHaveBeenCalled()
  })

  it('re-attaches when the stored session is already connected', async () => {
    getTopic.mockResolvedValue({
      id: 'topic-1',
      pi_session_id: 'sess-1',
    })

    const pi = {
      hasSession: vi.fn().mockReturnValue(true),
      reconnectSession: vi.fn(),
      recreateSession: vi.fn(),
      disconnectSession: vi.fn(),
    }

    await expect(restoreExistingTopicSession('topic-1', pi as never)).resolves.toBe(true)
    expect(pi.reconnectSession).toHaveBeenCalledWith('sess-1')
    expect(pi.recreateSession).not.toHaveBeenCalled()
  })

  it('falls back to recreate when reconnect fails during topic restore', async () => {
    getTopic.mockResolvedValue({
      id: 'topic-1',
      pi_session_id: 'sess-1',
      agent_type: 'general',
      programming_spec_json: null,
      general_spec_json: null,
      current_model: null,
    })

    const pi = {
      hasSession: vi.fn().mockReturnValue(false),
      reconnectSession: vi.fn().mockRejectedValue(new Error('session_not_found')),
      recreateSession: vi.fn().mockResolvedValue({ sessionId: 'sess-1' }),
      disconnectSession: vi.fn(),
    }

    await expect(restoreExistingTopicSession('topic-1', pi as never)).resolves.toBe(true)
    expect(pi.reconnectSession).toHaveBeenCalledWith('sess-1')
    expect(pi.recreateSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'sess-1',
      kind: 'general',
      topicId: 'topic-1',
    }))
  })

  it('returns false when topic restore recreate also fails', async () => {
    getTopic.mockResolvedValue({
      id: 'topic-1',
      pi_session_id: 'sess-1',
      agent_type: 'general',
      programming_spec_json: null,
      general_spec_json: null,
      current_model: null,
    })

    const pi = {
      hasSession: vi.fn().mockReturnValue(false),
      reconnectSession: vi.fn().mockRejectedValue(new Error('session_not_found')),
      recreateSession: vi.fn().mockRejectedValue(new Error('recreate_failed')),
      disconnectSession: vi.fn(),
    }

    await expect(restoreExistingTopicSession('topic-1', pi as never)).resolves.toBe(false)
    expect(pi.reconnectSession).toHaveBeenCalledWith('sess-1')
    expect(pi.recreateSession).toHaveBeenCalled()
  })

  it('returns false when topic has no bound session', async () => {
    getTopic.mockResolvedValue({
      id: 'topic-1',
      pi_session_id: null,
    })

    const pi = {
      hasSession: vi.fn(),
      reconnectSession: vi.fn(),
      recreateSession: vi.fn(),
      disconnectSession: vi.fn(),
    }

    await expect(restoreExistingTopicSession('topic-1', pi as never)).resolves.toBe(false)
    expect(pi.reconnectSession).not.toHaveBeenCalled()
    expect(pi.recreateSession).not.toHaveBeenCalled()
  })
})
