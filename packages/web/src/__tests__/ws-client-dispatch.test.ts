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

  function simulateWsTextDelta(messageId: string, content: string) {
    const store = useMessageStore.getState()
    const hadStreamingText = useMessageStore.getState().streamingText[messageId] !== undefined
    if (!hadStreamingText) {
      const existingText = store.getPartContent(messageId, 'text')
      store.setStreamingText(messageId, existingText)
    }
    store.appendDelta(messageId, content)
    const nextText = `${useMessageStore.getState().streamingText[messageId] ?? ''}`
    store.upsertSnapshotPart(
      messageId,
      'text',
      JSON.stringify({ content: nextText }),
      `${messageId}-text`,
    )
    const status = Object.values(useMessageStore.getState().byTopic)
      .flat()
      .find((entry) => entry.id === messageId)?.status
    if (!hadStreamingText && status && status !== 'streaming') {
      store.endStreaming(messageId)
    }
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

  function simulateWsMessageEnd(messageId: string, stopReason: string) {
    const store = useMessageStore.getState()
    store.endStreaming(messageId)
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

  it('AIT-187: message.end 后到达的 late text delta 仍更新最终快照', () => {
    simulateMessageStart('topic1', 'msg1')
    simulateWsTextDelta('msg1', 'Hello ')
    simulateWsMessageEnd('msg1', 'end_turn')

    expect(useMessageStore.getState().streamingText['msg1']).toBeUndefined()

    simulateWsTextDelta('msg1', 'tail')

    const state = useMessageStore.getState()
    const msg = state.byTopic['topic1']?.[0]
    expect(msg!.status).toBe('done')
    expect(state.streamingText['msg1']).toBeUndefined()
    expect(JSON.parse(state.partsByMessage['msg1'][0].content_json)).toEqual({ content: 'Hello tail' })
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

  it('C7: history reload 后从已有快照继续累加 delta', () => {
    const store = useMessageStore.getState()
    store.setMessages('topic1', [{
      id: 'msg1',
      topic_id: 'topic1',
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
    }])
    store.upsertSnapshotPart('msg1', 'text', JSON.stringify({ content: 'Hello' }), 'msg1-text')
    store.appendDelta('msg1', 'Hello')

    store.setMessages('topic1', [{
      id: 'msg1',
      topic_id: 'topic1',
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
    }])

    if (useMessageStore.getState().streamingText['msg1'] === undefined) {
      const existingText = store.getPartContent('msg1', 'text')
      store.setStreamingText('msg1', existingText)
    }
    store.appendDelta('msg1', ' world')
    const nextText = `${useMessageStore.getState().streamingText['msg1'] ?? ''}`
    store.upsertSnapshotPart('msg1', 'text', JSON.stringify({ content: nextText }), 'msg1-text')

    expect(useMessageStore.getState().streamingText['msg1']).toBe('Hello world')
    expect(JSON.parse(useMessageStore.getState().partsByMessage['msg1'][0].content_json)).toEqual({ content: 'Hello world' })
  })
})

describe('BUG-040 ⑤ — agent.status idle 强制收口 streaming 残留', () => {
  beforeEach(() => {
    useMessageStore.setState({
      byTopic: {},
      partsByMessage: {},
      loading: false,
      streamingText: {},
      streamingThinking: {},
      streamingToolInputs: {},
      streamingTopicId: null,
      streamingMessageId: null,
      todosByTopic: {},
      planByTopic: {},
      agentStatusByTopic: {},
      progressByTopic: {},
      usageByMessage: {},
      interactions: {},
    })
  })

  // Mirrors the ws-client.ts behavior on agent.status: idle.
  function simulateAgentIdle(topicId: string) {
    const store = useMessageStore.getState()
    store.setAgentStatus(topicId, 'idle')
    const state = useMessageStore.getState()
    const streamingMessages = (state.byTopic[topicId] ?? []).filter(
      (m) => m.status === 'streaming',
    )
    for (const m of streamingMessages) {
      store.endStreaming(m.id)
      store.updateMessage(m.id, {
        status: 'aborted',
        finished_at: Date.now(),
        stop_reason: 'aborted',
      })
    }
    if (state.streamingTopicId === topicId && state.streamingMessageId) {
      store.endStreaming(state.streamingMessageId)
    }
  }

  function addAssistantStreamingMessage(topicId: string, id: string) {
    useMessageStore.getState().addMessage(topicId, {
      id,
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
    useMessageStore.getState().startStreaming(topicId, id)
  }

  it('finalizes all streaming messages on a topic when agent goes idle', () => {
    addAssistantStreamingMessage('topic-a', 'msg-1')
    addAssistantStreamingMessage('topic-a', 'msg-2')
    useMessageStore.getState().appendDelta('msg-1', 'partial-1')
    useMessageStore.getState().appendDelta('msg-2', 'partial-2')

    simulateAgentIdle('topic-a')

    const state = useMessageStore.getState()
    expect(state.agentStatusByTopic['topic-a']).toBe('idle')
    expect(state.byTopic['topic-a'].every((m) => m.status === 'aborted')).toBe(true)
    expect(state.streamingText['msg-1']).toBeUndefined()
    expect(state.streamingText['msg-2']).toBeUndefined()
  })

  it('does not touch streaming messages on other topics', () => {
    addAssistantStreamingMessage('topic-a', 'msg-a')
    addAssistantStreamingMessage('topic-b', 'msg-b')
    useMessageStore.getState().appendDelta('msg-a', 'a')
    useMessageStore.getState().appendDelta('msg-b', 'b')

    simulateAgentIdle('topic-a')

    const state = useMessageStore.getState()
    expect(state.byTopic['topic-a'][0].status).toBe('aborted')
    expect(state.byTopic['topic-b'][0].status).toBe('streaming')
    expect(state.streamingText['msg-b']).toBe('b')
  })

  it('keeps already-done messages untouched', () => {
    const store = useMessageStore.getState()
    store.addMessage('topic-a', {
      id: 'done-msg',
      topic_id: 'topic-a',
      role: 'assistant',
      status: 'done',
      started_at: Date.now() - 1000,
      finished_at: Date.now() - 500,
      stop_reason: 'end_turn',
      cron_run_id: null,
      turn_id: null,
      client_message_id: null,
      retry_count: 0,
      max_retries: 2,
    })
    addAssistantStreamingMessage('topic-a', 'stuck-msg')

    simulateAgentIdle('topic-a')

    const state = useMessageStore.getState()
    const done = state.byTopic['topic-a'].find((m) => m.id === 'done-msg')
    const stuck = state.byTopic['topic-a'].find((m) => m.id === 'stuck-msg')
    expect(done?.status).toBe('done')
    expect(done?.stop_reason).toBe('end_turn')
    expect(stuck?.status).toBe('aborted')
  })
})

describe('tool-card loading — 多工具消息不互相覆盖（#3 回归）', () => {
  beforeEach(() => {
    useMessageStore.setState({
      byTopic: {},
      partsByMessage: {},
      loading: false,
      streamingText: {},
      streamingThinking: {},
      streamingToolInputs: {},
      streamingTopicId: null,
      streamingMessageId: null,
      todosByTopic: {},
      planByTopic: {},
      agentStatusByTopic: {},
      usageByMessage: {},
      interactions: {},
    })
  })

  // Mirror ws-client.ts stableId conventions for tool parts.
  function toolCall(messageId: string, toolUseId: string, name: string) {
    useMessageStore.getState().upsertSnapshotPart(
      messageId,
      'tool_use',
      JSON.stringify({ toolUseId, name, input: {} }),
      `tool-${toolUseId}`,
    )
  }
  function toolResult(messageId: string, toolUseId: string, output: unknown) {
    useMessageStore.getState().upsertSnapshotPart(
      messageId,
      'tool_result',
      JSON.stringify({ toolUseId, output, isError: false }),
      `tool-result-${toolUseId}`,
    )
  }

  // Replicates TopicPanel's toolResults map: keyed by content.toolUseId, not part id.
  function buildToolResults(messageId: string): Record<string, { toolUseId: string }> {
    const map: Record<string, { toolUseId: string }> = {}
    for (const part of useMessageStore.getState().partsByMessage[messageId] ?? []) {
      if (part.kind === 'tool_result') {
        const d = JSON.parse(part.content_json) as { toolUseId: string }
        map[d.toolUseId] = { toolUseId: d.toolUseId }
      }
    }
    return map
  }
  // A tool_use card spins while no matching result exists (MessageBubble isRunning={!result}).
  function isRunning(messageId: string, toolUseId: string): boolean {
    return buildToolResults(messageId)[toolUseId] === undefined
  }

  it('两个工具调用各自保留独立 part，不被同 kind 覆盖', () => {
    // Edit 文件常见序列：Read + Edit，kind 均为 tool_use / tool_result
    toolCall('msg1', 'A', 'Read')
    toolResult('msg1', 'A', 'file contents')
    toolCall('msg1', 'B', 'Edit')
    toolResult('msg1', 'B', 'edit applied')

    const parts = useMessageStore.getState().partsByMessage['msg1']
    const toolUses = parts.filter((p) => p.kind === 'tool_use')
    const toolResults = parts.filter((p) => p.kind === 'tool_result')
    expect(toolUses).toHaveLength(2)
    expect(toolResults).toHaveLength(2)
    // 两张卡片都能匹配到自己的结果 → 都不转圈
    expect(isRunning('msg1', 'A')).toBe(false)
    expect(isRunning('msg1', 'B')).toBe(false)
  })

  it('结果迟到的工具卡片在结果到达前转圈、到达后收口（不会永久 loading）', () => {
    // 卡死复现序列：callA → resultA → callB，B 的结果稍后才到
    toolCall('msg1', 'A', 'Read')
    toolResult('msg1', 'A', 'file contents')
    toolCall('msg1', 'B', 'Edit')

    // A 已完成，B 仍在运行（正确的中间态，而非被 A 的结果错配）
    expect(isRunning('msg1', 'A')).toBe(false)
    expect(isRunning('msg1', 'B')).toBe(true)

    // B 的结果到达后，B 收口 —— 文件写完不再永久 loading
    toolResult('msg1', 'B', 'edit applied')
    expect(isRunning('msg1', 'B')).toBe(false)
    expect(useMessageStore.getState().partsByMessage['msg1'].filter((p) => p.kind === 'tool_use')).toHaveLength(2)
  })
})
