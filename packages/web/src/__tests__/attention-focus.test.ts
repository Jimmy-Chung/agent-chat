import { describe, it, expect, beforeEach } from 'vitest'
import { resolveFocusMessageId } from '../lib/attention/focus'
import { useMessageStore } from '../stores/message-store'
import type { TraceNode } from '../lib/attention'

function makeTraceNode(overrides: Partial<TraceNode> = {}): TraceNode {
  return {
    id: 'cand_1',
    parent_id: null,
    branch_id: 'main',
    user_message: '用户问题',
    intent: '',
    rationale: null,
    conclusion: 'AI 结论',
    planned_ref: null,
    alignment: 'unplanned',
    goal_distance: 0.5,
    status: 'done',
    event_ids: ['e1'],
    source_message_ids: ['m1'],
    step_count: 0,
    user_kind: 'question',
    assistant_actions: [],
    user_message_count: 1,
    exchanges: [{
      id: 'ex_1',
      message_id: 'm1',
      user_message: '用户问题',
      user_kind: 'question',
      assistant_summary: 'AI 结论',
      assistant_actions: [],
      event_ids: ['e1'],
      tool_count: 0,
      ts_start: 1,
      ts_end: 2,
    }],
    ts_start: 1,
    ts_end: 2,
    ...overrides,
  }
}

describe('Attention focus helpers', () => {
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
      agentPhaseByTopic: {},
      progressByTopic: {},
      usageByMessage: {},
      interactions: {},
      focusedMessageTarget: null,
      pendingMessagesByTopic: {},
      unreadByTopic: {},
    })
  })

  it('resolveFocusMessageId 使用节点第一条来源消息', () => {
    const traceById = new Map<string, TraceNode>([
      ['cand_1', makeTraceNode()],
      ['cand_2', makeTraceNode({ id: 'cand_2', source_message_ids: ['m2'], exchanges: [{ id: 'ex_2', message_id: 'm2', user_message: 'x', user_kind: 'question', assistant_summary: 'y', assistant_actions: [], event_ids: ['e2'], tool_count: 0, ts_start: 3, ts_end: 4 }], ts_start: 3, ts_end: 4 })],
    ])
    expect(resolveFocusMessageId(['cand_1', 'cand_2'], traceById)).toBe('m1')
  })

  it('focusMessage 会推进 requestId 并更新目标消息', () => {
    const store = useMessageStore.getState()
    store.focusMessage('topic-1', 'msg-1')
    const first = useMessageStore.getState().focusedMessageTarget
    store.focusMessage('topic-1', 'msg-1')
    const second = useMessageStore.getState().focusedMessageTarget

    expect(first?.messageId).toBe('msg-1')
    expect(second?.requestId).toBe((first?.requestId ?? 0) + 1)
  })
})
