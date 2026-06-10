import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GoalAnchor, TraceNode } from '../lib/attention'
import type { MindMapNode } from '../lib/attention/mind-map-projector'
import {
  AttentionSopExportModal,
  resolveAttentionSopSelectionPreview,
  resolveAttentionSopVisualDepths,
} from '../components/attention/AttentionSopExportModal'

const send = vi.fn(() => true)

vi.mock('../lib/ws-client', () => ({
  getWsClient: () => ({ send }),
}))

afterEach(() => {
  cleanup()
  send.mockClear()
})

const GOAL: GoalAnchor = { raw_query: '导出 SOP', normalized_goal: '导出 SOP', ts: 0 }

function node(id: string, overrides: Partial<TraceNode> = {}): TraceNode {
  const order = Number(id.replace(/\D/g, '')) || 1
  return {
    id,
    parent_id: null,
    branch_id: 'main',
    user_message: `用户输入 ${id}`,
    user_summary: `步骤 ${id}`,
    assistant_summary: `助手输出 ${id}`,
    intent: '',
    rationale: null,
    conclusion: `结论 ${id}`,
    planned_ref: null,
    alignment: 'unplanned',
    goal_distance: 0.2,
    status: 'done',
    event_ids: [id],
    source_message_ids: [`m-${id}`],
    step_count: 1,
    ts_start: order * 100,
    ts_end: order * 100 + 1,
    ...overrides,
  }
}

function mindNode(id: string, sourceNodeIds: string[]): MindMapNode {
  return {
    id,
    kind: 'aggregate',
    treeNodeId: id,
    title: id,
    subtitle: '',
    relation: 'main',
    goalDistance: 0,
    active: false,
    current: false,
    collapsed: true,
    depth: 1,
    sourceNodeIds,
    aggregation: null,
    hasChildren: true,
    position: { x: 0, y: 0 },
  }
}

describe('Attention SOP export modal', () => {
  it('deduplicates selected aggregate sources and keeps trace order in preview', () => {
    const preview = resolveAttentionSopSelectionPreview(
      [node('n1'), node('n2'), node('n3')],
      [
        mindNode('agg_a', ['n2', 'n1']),
        mindNode('agg_b', ['n2']),
      ],
    )

    expect(preview.map((entry) => entry.id)).toEqual(['n1', 'n2'])
  })

  it('sends selected projection node ids without mutating the attention panel state', () => {
    render(
      <AttentionSopExportModal
        topicId="topic-1"
        activeGoalId="goal-1"
        nodes={[node('n1', { user_summary: '第一步' }), node('n2', { user_summary: '第二步' })]}
        goalAnchor={GOAL}
        planItems={[]}
        onClose={() => {}}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('例如：AkShare 数据分析 SOP'), {
      target: { value: 'AkShare SOP' },
    })
    fireEvent.click(screen.getByLabelText('选择 第一步'))
    fireEvent.click(screen.getByText('导出到 SOP 中心'))

    expect(send).toHaveBeenCalledWith({
      type: 'sop_template.export_from_attention',
      data: {
        topicId: 'topic-1',
        goalId: 'goal-1',
        name: 'AkShare SOP',
        selectedNodeIds: ['user_n1'],
      },
    })
  })

  it('computes nested visual indentation from expansion edges only', () => {
    const depths = resolveAttentionSopVisualDepths({
      nodes: [
        mindNode('tree_goal', ['n1']),
        mindNode('agg_topic', ['n1', 'n2']),
        mindNode('nested_n1', ['n1']),
        mindNode('nested_child', ['n2']),
        mindNode('user_n3', ['n3']),
      ],
      edges: [
        { id: 'main_tree_goal_agg_topic', source: 'tree_goal', target: 'agg_topic', kind: 'main' },
        { id: 'expand_agg_topic_nested_n1', source: 'agg_topic', target: 'nested_n1', kind: 'main' },
        { id: 'nested_nested_n1_nested_child', source: 'nested_n1', target: 'nested_child', kind: 'main' },
        { id: 'main_nested_child_user_n3', source: 'nested_child', target: 'user_n3', kind: 'main' },
      ],
    })

    expect(depths.get('tree_goal')).toBe(0)
    expect(depths.get('agg_topic')).toBe(0)
    expect(depths.get('nested_n1')).toBe(1)
    expect(depths.get('nested_child')).toBe(2)
    expect(depths.get('user_n3')).toBe(0)
  })
})
