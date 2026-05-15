import { describe, it, expect, beforeEach } from 'vitest'
import { useMessageStore } from '../stores/message-store'

// We test the dispatch logic by directly calling store methods
// the same way ws-client does — this avoids mocking WebSocket

describe('ws-client dispatch — C: delta 分发逻辑', () => {
  beforeEach(() => {
    useMessageStore.setState({
      byTopic: {},
      partsByMessage: {},
      loading: false,
      streamingText: {},
      streamingTopicId: null,
      todosByTopic: {},
      planByTopic: {},
      agentStatusByTopic: {},
      usageByMessage: {},
      interactions: {},
    })
  })

  function simulateMessageStart(topicId: string, messageId: string) {
    const store = useMessageStore.getState()
    store.addMessage(topicId, {
      id: messageId,
      topic_id: topicId,
      role: 'assistant',
      status: 'streaming',
      started_at: Date.now(),
      finished_at: null,
      stop_reason: null,
      cron_run_id: null,
      turn_id: null,
      client_message_id: null,
      retry_count: 0,
      max_retries: 2,
    })
    store.startStreaming(topicId, messageId)
  }

  function simulateMessageDelta(messageId: string, content: string) {
    // This mirrors the fixed ws-client behavior (appendDelta, not setStreamingText)
    useMessageStore.getState().appendDelta(messageId, content)
  }

  function simulateMessageEnd(messageId: string, stopReason: string) {
    const store = useMessageStore.getState()
    if (store.streamingText[messageId] !== undefined) {
      const streamText = store.streamingText[messageId]
      if (streamText) {
        store.appendPart(messageId, {
          id: `${messageId}-text-final`,
          message_id: messageId,
          ordinal: 0,
          kind: 'text',
          content_json: JSON.stringify(streamText),
        })
      }
      store.endStreaming(messageId)
    }
    store.updateMessage(messageId, {
      status: stopReason === 'aborted' ? 'aborted' : 'done',
      finished_at: Date.now(),
      stop_reason: stopReason,
    })
  }

  it('C1: message.start 初始化流式状态', () => {
    simulateMessageStart('topic1', 'msg1')
    const state = useMessageStore.getState()
    expect(state.streamingTopicId).toBe('topic1')
    expect(state.streamingText['msg1']).toBe('')
    const msg = state.byTopic['topic1']?.[0]
    expect(msg).toBeDefined()
    expect(msg!.status).toBe('streaming')
  })

  it('C2: message.delta 增量累加（修复后行为）', () => {
    simulateMessageStart('topic1', 'msg1')
    simulateMessageDelta('msg1', 'Hello ')
    simulateMessageDelta('msg1', 'World')
    simulateMessageDelta('msg1', '!')
    expect(useMessageStore.getState().streamingText['msg1']).toBe('Hello World!')
  })

  it('C4: message.end 保存最终文本并清除流式状态', () => {
    simulateMessageStart('topic1', 'msg1')
    simulateMessageDelta('msg1', 'Hello World!')
    simulateMessageEnd('msg1', 'end_turn')

    const state = useMessageStore.getState()
    expect(state.streamingTopicId).toBeNull()
    expect(state.streamingText['msg1']).toBeUndefined()

    const msg = state.byTopic['topic1']?.[0]
    expect(msg!.status).toBe('done')
    expect(msg!.stop_reason).toBe('end_turn')

    const parts = state.partsByMessage['msg1']
    expect(parts).toHaveLength(1)
    expect(JSON.parse(parts![0].content_json)).toBe('Hello World!')
  })

  it('C5: message.end stopReason=aborted 设置 aborted 状态', () => {
    simulateMessageStart('topic1', 'msg1')
    simulateMessageDelta('msg1', 'partial...')
    simulateMessageEnd('msg1', 'aborted')

    const msg = useMessageStore.getState().byTopic['topic1']?.[0]
    expect(msg!.status).toBe('aborted')
    expect(msg!.stop_reason).toBe('aborted')
  })

  it('C6: 多个 delta 间穿插 tool.call 不影响累加', () => {
    simulateMessageStart('topic1', 'msg1')
    simulateMessageDelta('msg1', 'Let me check.')

    // Simulate tool.call — doesn't affect streaming text
    const store = useMessageStore.getState()
    store.appendPart('msg1', {
      id: 'part-tool-1',
      message_id: 'msg1',
      ordinal: 0,
      kind: 'tool_use',
      content_json: JSON.stringify({ toolUseId: 'tu1', name: 'Read', input: { path: '/tmp/a' } }),
    })

    simulateMessageDelta('msg1', ' Done!')
    expect(useMessageStore.getState().streamingText['msg1']).toBe('Let me check. Done!')
  })
})
