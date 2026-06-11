import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AttentionSopExportModal,
  resolveAttentionSopSelectionPreview,
} from '../components/attention/AttentionSopExportModal'
import type { GoalAnchor, TraceNode } from '../lib/attention'
import type { MindMapNode } from '../lib/attention/mind-map-projector'

const send = vi.fn(() => true)

vi.mock('../lib/ws-client', () => ({
  getWsClient: () => ({ send }),
}))

vi.mock('../components/attention/MindMapGraph', () => ({
  default: ({
    projection,
    onSelect,
    exportSelectedIds,
    onToggleExportSelect,
    onToggleExpand,
  }: {
    projection?: {
      nodes: Array<{ id: string; title: string; hasChildren?: boolean }>
    }
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

const GOAL: GoalAnchor = {
  raw_query: '导出 SOP',
  normalized_goal: '导出 SOP',
  ts: 0,
}

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
      [mindNode('agg_a', ['n2', 'n1']), mindNode('agg_b', ['n2'])],
    )

    expect(preview.map((entry) => entry.id)).toEqual(['n1', 'n2'])
  })

  it('enables submit after selecting a node and sends source trace ids', () => {
    render(
      <AttentionSopExportModal
        topicId="topic-1"
        activeGoalId="goal-1"
        nodes={[
          node('n1', { user_summary: '第一步' }),
          node('n2', { user_summary: '第二步' }),
        ]}
        goalAnchor={GOAL}
        planItems={[]}
        onClose={() => {}}
      />,
    )

    const submitButton = screen.getByText('生成 SOP 草稿') as HTMLButtonElement
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

  // TC-251-03 — 操作按钮固定在底栏，不在右栏滚动容器内
  it('keeps the action buttons outside the scrollable side pane', () => {
    render(
      <AttentionSopExportModal
        topicId="topic-1"
        activeGoalId="goal-1"
        nodes={[node('n1'), node('n2')]}
        goalAnchor={GOAL}
        planItems={[]}
        onClose={() => {}}
      />,
    )

    const scrollPane = screen.getByTestId('sop-export-side-scroll')
    expect(scrollPane.className).toContain('overflow-y-auto')
    const submitButton = screen.getByText('生成 SOP 草稿')
    expect(scrollPane.contains(submitButton)).toBe(false)
    expect(scrollPane.contains(screen.getByText('取消'))).toBe(false)
  })

  // TC-252-01/02 — 勾选聚合节点后展开，子节点显示为已选；取消子节点后父聚合退出全选态
  it('derives child checkbox state from selected sources of an aggregate', () => {
    const aggregateNode = node('n1', {
      user_summary: '聚合步骤',
      exchanges: [
        {
          id: 'ex1',
          message_id: 'm-ex1',
          user_message: '子输入一',
          user_kind: 'instruction',
          assistant_summary: '子输出一',
          assistant_actions: [],
          event_ids: ['e1'],
          tool_count: 0,
          ts_start: 100,
          ts_end: 101,
        },
        {
          id: 'ex2',
          message_id: 'm-ex2',
          user_message: '子输入二',
          user_kind: 'instruction',
          assistant_summary: '子输出二',
          assistant_actions: [],
          event_ids: ['e2'],
          tool_count: 0,
          ts_start: 102,
          ts_end: 103,
        },
      ],
    })
    render(
      <AttentionSopExportModal
        topicId="topic-1"
        activeGoalId="goal-1"
        nodes={[aggregateNode]}
        goalAnchor={GOAL}
        planItems={[]}
        onClose={() => {}}
      />,
    )

    // 勾选聚合节点并展开
    fireEvent.click(screen.getByLabelText('选择 聚合步骤'))
    fireEvent.click(screen.getByText('展开 聚合步骤'))

    // 展开后的子节点（exchange）勾选框显示为已选
    const childCheckbox = screen.getByLabelText(
      '选择 子输入一',
    ) as HTMLInputElement
    expect(childCheckbox.checked).toBe(true)
    expect(
      (screen.getByLabelText('选择 子输入二') as HTMLInputElement).checked,
    ).toBe(true)

    // 取消其中一个子节点 → 同源轨迹移出集合 → 父聚合退出全选态
    fireEvent.click(childCheckbox)
    expect(
      (screen.getByLabelText('选择 聚合步骤') as HTMLInputElement).checked,
    ).toBe(false)
  })

  // TC-252-03 — 载荷 selectedSourceIds 为源轨迹集合、selectedNodeIds 不含 goal
  it('submits source ids without including the goal node in selectedNodeIds', () => {
    render(
      <AttentionSopExportModal
        topicId="topic-1"
        activeGoalId="goal-1"
        nodes={[
          node('n1', { user_summary: '第一步' }),
          node('n2', { user_summary: '第二步' }),
        ]}
        goalAnchor={GOAL}
        planItems={[]}
        onClose={() => {}}
      />,
    )

    fireEvent.click(screen.getByLabelText('选择 第一步'))
    fireEvent.click(screen.getByLabelText('选择 第二步'))
    fireEvent.click(screen.getByText('生成 SOP 草稿'))

    const payload = (send.mock.calls.at(-1) as unknown[] | undefined)?.[0] as {
      data: { selectedNodeIds: string[]; selectedSourceIds: string[] }
    }
    expect(payload.data.selectedSourceIds.sort()).toEqual(['n1', 'n2'])
    expect(payload.data.selectedNodeIds.sort()).toEqual(['user_n1', 'user_n2'])
  })

  // TC-251-05 — 目标根节点不显示「展开子节点」（hasChildren 表示树根而非可折叠聚合）
  it('does not offer child expansion for the goal root node', () => {
    render(
      <AttentionSopExportModal
        topicId="topic-1"
        activeGoalId="goal-1"
        nodes={[node('n1', { user_summary: '第一步' })]}
        goalAnchor={GOAL}
        planItems={[]}
        onClose={() => {}}
      />,
    )

    // 选中目标根节点（标题为目标文案）
    fireEvent.click(screen.getByText('导出 SOP', { selector: 'button' }))
    expect(screen.getByText('goal')).toBeTruthy()
    expect(screen.queryByText('展开子节点')).toBeNull()
  })
})
