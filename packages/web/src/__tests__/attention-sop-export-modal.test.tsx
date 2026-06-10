import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GoalAnchor, TraceNode } from '../lib/attention'
import type { MindMapNode } from '../lib/attention/mind-map-projector'
import {
  AttentionSopExportModal,
  resolveAttentionSopSelectionPreview,
} from '../components/attention/AttentionSopExportModal'

const send = vi.fn(() => true)

vi.mock('../lib/ws-client', () => ({
  getWsClient: () => ({ send }),
}))

vi.mock('../components/attention/MindMapGraph', () => ({
  default: ({ projection, onSelect, exportSelectedIds, onToggleExportSelect, onToggleExpand }: {
    projection?: { nodes: Array<{ id: string; title: string; hasChildren?: boolean }> }
    onSelect?: (id: string) => void
    exportSelectedIds?: ReadonlySet<string>
    onToggleExportSelect?: (id: string) => void
    onToggleExpand?: (id: string) => void
  }) => (
    <div data-testid="mind-map-graph">
      {(projection?.nodes ?? []).map((entry) => (
        <div key={entry.id}>
          <button type="button" onClick={() => onSelect?.(entry.id)}>
            {entry.title}
          </button>
          <input
            type="checkbox"
            checked={exportSelectedIds?.has(entry.id) ?? false}
            aria-label={`选择 ${entry.title}`}
            onChange={() => onToggleExportSelect?.(entry.id)}
          />
          {entry.hasChildren && (
            <button type="button" onClick={() => onToggleExpand?.(entry.id)}>
              展开 {entry.title}
            </button>
          )}
        </div>
      ))}
    </div>
  ),
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

  it('enables submit after selecting a node and sends source trace ids', () => {
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

    const submitButton = screen.getByText('导出到 SOP 中心') as HTMLButtonElement
    expect(submitButton.disabled).toBe(true)

    fireEvent.click(screen.getByLabelText('选择当前节点 第一步'))
    expect(submitButton.disabled).toBe(false)

    fireEvent.click(submitButton)

    expect(send).toHaveBeenCalledWith({
      type: 'sop_template.export_from_attention',
      data: {
        topicId: 'topic-1',
        goalId: 'goal-1',
        name: '导出 SOP',
        selectedNodeIds: ['user_n1'],
        selectedSourceIds: ['n1'],
      },
    })
  })
})
