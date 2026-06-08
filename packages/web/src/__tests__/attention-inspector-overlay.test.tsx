import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { GoalAnchor, TraceNode } from '../lib/attention'
import type { AttentionTrace, AttentionGoalMeta } from '../lib/attention/use-attention-trace'
import { AttentionInspectorOverlay } from '../components/layout/InspectorPanel'

afterEach(cleanup)

// 与 attention-panel.test.tsx 一致：把 MindMapGraph 替换为可点的 stub，
// goal 节点暴露「更新目标」按钮以打开弹窗。
vi.mock('../components/attention/MindMapGraph', () => ({
  default: ({ projection, onSelect, onUpdateGoal }: {
    projection?: { nodes: Array<{ id: string; title: string; kind: string }> }
    onSelect?: (id: string) => void
    onUpdateGoal?: () => void
  }) => (
    <div data-testid="mind-map-graph">
      {(projection?.nodes ?? []).map((n) => (
        <div key={n.id} role="button" tabIndex={0} onClick={() => onSelect?.(n.id)}>
          {n.id}:{n.title}
          {n.kind === 'goal' && onUpdateGoal && (
            <button type="button" aria-label="更新目标" onClick={(e) => { e.stopPropagation(); onUpdateGoal() }}>
              更新目标
            </button>
          )}
        </div>
      ))}
    </div>
  ),
}))

function traceNode(over: Partial<TraceNode> = {}): TraceNode {
  return {
    id: 'cand_1',
    parent_id: null,
    branch_id: 'main',
    user_message: '用户消息',
    intent: '',
    rationale: null,
    conclusion: '结论',
    planned_ref: null,
    alignment: 'unplanned',
    goal_distance: 0.2,
    status: 'done',
    event_ids: [],
    source_message_ids: [],
    step_count: 1,
    ts_start: 0,
    ts_end: 1,
    ...over,
  }
}

const GOAL: GoalAnchor = { raw_query: '默认目标文本', normalized_goal: '默认目标文本', ts: 0 }

function defaultGoalMeta(): AttentionGoalMeta {
  return {
    id: 'g1',
    topic_id: 'topic_1',
    goal_text: '默认目标文本',
    title: '默认目标',
    is_default: true,
    active: true,
    source_message_count: 10,
    source_last_event_ts: 10,
    created_at: 1,
    updated_at: 1,
    has_snapshot: true,
  }
}

function makeAttention(createGoal: AttentionTrace['createGoal']): AttentionTrace {
  return {
    nodes: [traceNode()],
    goalAnchor: GOAL,
    planItems: [],
    rawEvents: [],
    isAnalyzing: false,
    isLoadingSnapshot: false,
    llmUnavailableReason: null,
    goals: [defaultGoalMeta()],
    activeGoal: defaultGoalMeta(),
    activeGoalId: 'g1',
    goalDraft: '默认目标文本',
    setGoalDraft: vi.fn(),
    createGoal,
    selectGoal: vi.fn(async () => {}),
    renameGoal: vi.fn(async () => {}),
    reloadGoals: vi.fn(async () => {}),
  }
}

// 回归：InspectorPanel 的 Attention overlay 必须把弹窗输入的目标文本透传给
// createGoal。曾因 onCreateGoal={() => createGoal()} 丢掉 text 参数，导致
// createGoal 回退到 goalDraft（= 当前激活目标文本），落库的是默认目标副本，
// 表现为「目标没新增、图没重绘」。
describe('AttentionInspectorOverlay 更新目标透传文本', () => {
  it('保存弹窗时用用户输入的文本调用 createGoal，而非丢弃参数', async () => {
    const createGoal = vi.fn(async () => {})
    render(
      <AttentionInspectorOverlay
        topicId="topic_1"
        attention={makeAttention(createGoal)}
        closing={false}
        onClose={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByTestId('mind-map-graph')).toBeTruthy())

    // 打开更新目标弹窗
    fireEvent.click(screen.getByText('更新目标'))

    // 输入一个与默认目标不同的新目标
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: '我真正想要的新目标' } })

    // 保存：必须带着用户输入的文本，不能是 undefined / 默认目标文本
    fireEvent.click(screen.getByText('保存目标'))
    expect(createGoal).toHaveBeenCalledWith('我真正想要的新目标')
    expect(createGoal).not.toHaveBeenCalledWith()
    expect(createGoal).not.toHaveBeenCalledWith('默认目标文本')
  })
})
