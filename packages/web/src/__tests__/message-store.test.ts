import { describe, it, expect, beforeEach } from 'vitest'
import { useMessageStore } from '../stores/message-store'
import type { Message, MessagePart } from '@agent-chat/protocol'

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    topic_id: 'topic1',
    role: 'user',
    status: 'done',
    started_at: Date.now(),
    finished_at: null,
    stop_reason: null,
    cron_run_id: null,
    ...overrides,
  }
}

function makePart(overrides: Partial<MessagePart> = {}): MessagePart {
  return {
    id: 'p1',
    message_id: 'm1',
    ordinal: 0,
    kind: 'text',
    content_json: '"hello"',
    ...overrides,
  }
}

describe('MessageStore', () => {
  beforeEach(() => {
    useMessageStore.setState({
      byTopic: {},
      partsByMessage: {},
      loading: false,
      streamingText: {},
      streamingMessageId: null,
    })
  })

  it('should have correct initial state', () => {
    const state = useMessageStore.getState()
    expect(state.byTopic).toEqual({})
    expect(state.partsByMessage).toEqual({})
    expect(state.loading).toBe(false)
    expect(state.streamingText).toEqual({})
    expect(state.streamingMessageId).toBeNull()
  })

  it('setMessages sets messages for a topic', () => {
    const msgs = [makeMessage({ id: 'm1' }), makeMessage({ id: 'm2' })]
    useMessageStore.getState().setMessages('topic1', msgs)
    expect(useMessageStore.getState().byTopic['topic1']).toEqual(msgs)
  })

  it('setMessages replaces existing messages for a topic', () => {
    useMessageStore.getState().setMessages('topic1', [makeMessage({ id: 'm1' })])
    const newMsgs = [makeMessage({ id: 'm2' }), makeMessage({ id: 'm3' })]
    useMessageStore.getState().setMessages('topic1', newMsgs)
    expect(useMessageStore.getState().byTopic['topic1']).toEqual(newMsgs)
  })

  it('addMessage appends a message to a topic', () => {
    useMessageStore.getState().setMessages('topic1', [makeMessage({ id: 'm1' })])
    const newMsg = makeMessage({ id: 'm2' })
    useMessageStore.getState().addMessage('topic1', newMsg)

    const msgs = useMessageStore.getState().byTopic['topic1']
    expect(msgs).toHaveLength(2)
    expect(msgs[1]).toEqual(newMsg)
  })

  it('addMessage creates the topic array if it does not exist', () => {
    const msg = makeMessage({ id: 'm1' })
    useMessageStore.getState().addMessage('topic1', msg)
    expect(useMessageStore.getState().byTopic['topic1']).toEqual([msg])
  })

  it('updateMessage updates a specific message by id', () => {
    useMessageStore.getState().setMessages('topic1', [
      makeMessage({ id: 'm1', status: 'streaming' }),
      makeMessage({ id: 'm2', status: 'streaming' }),
    ])
    useMessageStore.getState().updateMessage('m1', { status: 'done' })

    const msgs = useMessageStore.getState().byTopic['topic1']
    expect(msgs[0].status).toBe('done')
    expect(msgs[1].status).toBe('streaming')
  })

  it('appendPart adds a part to a message', () => {
    const part1 = makePart({ id: 'p1', message_id: 'm1', ordinal: 0 })
    const part2 = makePart({ id: 'p2', message_id: 'm1', ordinal: 1 })
    useMessageStore.getState().appendPart('m1', part1)
    useMessageStore.getState().appendPart('m1', part2)

    const parts = useMessageStore.getState().partsByMessage['m1']
    expect(parts).toHaveLength(2)
    expect(parts[0]).toEqual(part1)
    expect(parts[1]).toEqual(part2)
  })

  it('removeMessagesByTopic removes all messages for a topic', () => {
    useMessageStore.getState().setMessages('topic1', [makeMessage({ id: 'm1' })])
    useMessageStore.getState().setMessages('topic2', [makeMessage({ id: 'm2' })])
    useMessageStore.getState().removeMessagesByTopic('topic1')

    const state = useMessageStore.getState()
    expect(state.byTopic['topic1']).toBeUndefined()
    expect(state.byTopic['topic2']).toBeDefined()
  })

  describe('streaming', () => {
    it('startStreaming sets streamingMessageId and initializes text', () => {
      useMessageStore.getState().startStreaming('m1')
      const state = useMessageStore.getState()
      expect(state.streamingMessageId).toBe('m1')
      expect(state.streamingText['m1']).toBe('')
    })

    it('startStreaming does not overwrite existing streaming text', () => {
      useMessageStore.setState({ streamingText: { m1: 'hello' } })
      useMessageStore.getState().startStreaming('m1')
      expect(useMessageStore.getState().streamingText['m1']).toBe('hello')
    })

    it('appendDelta appends text to streaming message', () => {
      useMessageStore.getState().startStreaming('m1')
      useMessageStore.getState().appendDelta('m1', 'Hello ')
      useMessageStore.getState().appendDelta('m1', 'World')

      expect(useMessageStore.getState().streamingText['m1']).toBe('Hello World')
    })

    it('appendDelta handles missing streaming text entry', () => {
      useMessageStore.getState().appendDelta('m1', 'text')
      expect(useMessageStore.getState().streamingText['m1']).toBe('text')
    })

    it('endStreaming clears streamingMessageId and removes streamingText', () => {
      useMessageStore.getState().startStreaming('m1')
      useMessageStore.getState().appendDelta('m1', 'Hello')
      useMessageStore.getState().endStreaming('m1')

      const state = useMessageStore.getState()
      expect(state.streamingMessageId).toBeNull()
      expect(state.streamingText['m1']).toBeUndefined()
    })

    it('endStreaming does not clear streamingMessageId if it belongs to a different message', () => {
      useMessageStore.getState().startStreaming('m1')
      useMessageStore.getState().endStreaming('m2')
      expect(useMessageStore.getState().streamingMessageId).toBe('m1')
    })
  })
})
