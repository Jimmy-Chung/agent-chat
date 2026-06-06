import { describe, it, expect, beforeEach } from 'vitest'
import { useMessageStore } from '../stores/message-store'

describe('MessageStore streaming — B: 流式状态', () => {
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
      focusedMessageTarget: null,
    })
  })

  it('B1: appendDelta 增量追加', () => {
    const store = useMessageStore.getState()
    store.appendDelta('m1', 'Hello ')
    store.appendDelta('m1', 'World')
    expect(useMessageStore.getState().streamingText['m1']).toBe('Hello World')
  })

  it('B2: setStreamingText 快照替换', () => {
    const store = useMessageStore.getState()
    store.setStreamingText('m1', 'Hello ')
    store.setStreamingText('m1', 'World')
    expect(useMessageStore.getState().streamingText['m1']).toBe('World')
  })

  it('B3: 完整流式生命周期', () => {
    const store = useMessageStore.getState()
    store.startStreaming('topic1', 'm1')
    expect(useMessageStore.getState().streamingTopicId).toBe('topic1')
    expect(useMessageStore.getState().streamingText['m1']).toBe('')

    store.appendDelta('m1', 'Hello ')
    store.appendDelta('m1', 'World')
    store.appendDelta('m1', '!')
    expect(useMessageStore.getState().streamingText['m1']).toBe('Hello World!')

    store.endStreaming('m1')
    expect(useMessageStore.getState().streamingTopicId).toBeNull()
    expect(useMessageStore.getState().streamingText['m1']).toBeUndefined()
  })

  it('B4: endStreaming 保留其他消息的流', () => {
    const store = useMessageStore.getState()
    store.startStreaming('topic1', 'm1')
    store.startStreaming('topic2', 'm2')
    store.endStreaming('m1')
    expect(useMessageStore.getState().streamingTopicId).toBe('topic2')
    expect(useMessageStore.getState().streamingText['m1']).toBeUndefined()
  })

  it('B5: appendDelta 在未 startStreaming 时自动初始化', () => {
    useMessageStore.getState().appendDelta('m1', 'text')
    expect(useMessageStore.getState().streamingText['m1']).toBe('text')
  })

  it('B6: 高频 appendDelta 性能 (1000次 < 300ms)', () => {
    const store = useMessageStore.getState()
    store.startStreaming('topic1', 'm1')
    const start = performance.now()
    for (let i = 0; i < 1000; i++) {
      store.appendDelta('m1', `chunk${i} `)
    }
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(300)
    expect(useMessageStore.getState().streamingText['m1']).toContain('chunk999')
  })
})
