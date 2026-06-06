import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { GoalAnchor, RawEvent, TraceNode } from '../lib/attention'
import { buildGraphData, NODE_W, NODE_GAP } from '../lib/attention/graph-projector'
import { AttentionPanelContent } from '../components/attention/AttentionPanelContent'
import { AttentionXPanel } from '../components/attention/AttentionXPanel'
import { useMessageStore } from '../stores/message-store'

afterEach(cleanup)

vi.mock('../components/attention/MindMapGraph', () => ({
  default: ({ projection, onSelect, onFocus }: {
    projection?: { nodes: Array<{ id: string; title: string; collapsed: boolean; focusMessageId?: string | null }> }
    onSelect?: (id: string) => void
    onFocus?: (messageId: string) => void
  }) => (
    <div data-testid="mind-map-graph">
      {(projection?.nodes ?? []).map((node) => (
        <div
          key={node.id}
          role="button"
          tabIndex={0}
          data-testid={`mind-node-${node.id}`}
          data-collapsed={String(node.collapsed)}
          onClick={() => onSelect?.(node.id)}
        >
          {node.id}:{node.title}
          {node.focusMessageId && (
            <button
              type="button"
              aria-label={`定位到对应消息 ${node.id}`}
              onClick={(event) => {
                event.stopPropagation()
                onFocus?.(node.focusMessageId!)
              }}
            >
              Focus
            </button>
          )}
        </div>
      ))}
    </div>
  ),
}))

function node(over: Partial<TraceNode> = {}): TraceNode {
  return {
    id: over.id ?? 'cand_1',
    parent_id: null,
    branch_id: 'main',
    user_message: over.user_message ?? '用户消息',
    intent: '',
    rationale: null,
    conclusion: over.conclusion ?? '结论',
    planned_ref: null,
    alignment: 'unplanned',
    goal_distance: over.goal_distance ?? 0.2,
    status: over.status ?? 'done',
    event_ids: [],
    source_message_ids: [],
    step_count: over.step_count ?? 1,
    ts_start: 0,
    ts_end: 1,
    ...over,
  }
}

const GOAL: GoalAnchor = { raw_query: '修复登录 bug', normalized_goal: '修复登录 bug', ts: 0 }

// ── TC-AIT-222-01：drawer 内容渲染 goalAnchor + 节点列表 ─────────────────────
describe('TC-AIT-222-01 渲染目标 + 列表', () => {
  it('展示目标锚点与每个节点 conclusion', () => {
    const nodes = [
      node({ id: 'cand_1', conclusion: '定位根因' }),
      node({ id: 'cand_2', conclusion: '修复并回归' }),
    ]
    render(<AttentionPanelContent nodes={nodes} goalAnchor={GOAL} />)
    expect(screen.getByText('修复登录 bug')).toBeTruthy()
    expect(screen.getByText('定位根因')).toBeTruthy()
    expect(screen.getByText('修复并回归')).toBeTruthy()
  })

  it('空节点显示占位', () => {
    render(<AttentionPanelContent nodes={[]} goalAnchor={GOAL} />)
    expect(screen.getByText('暂无决策节点')).toBeTruthy()
  })
})

// ── TC-AIT-222-02：实时 append，节点稳定不丢 ─────────────────────────────────
describe('TC-AIT-222-02 实时 append', () => {
  it('追加节点后列表新增，前序仍在', () => {
    const n1 = node({ id: 'cand_1', conclusion: '第一步' })
    const n2 = node({ id: 'cand_2', conclusion: '第二步' })
    const { rerender } = render(<AttentionPanelContent nodes={[n1, n2]} goalAnchor={GOAL} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)

    rerender(<AttentionPanelContent nodes={[n1, n2, node({ id: 'cand_3', conclusion: '第三步' })]} goalAnchor={GOAL} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('第一步')).toBeTruthy()
    expect(screen.getByText('第三步')).toBeTruthy()
  })

  it('graph-projector：节点 id/x 稳定，append 不影响前序坐标', () => {
    const nodes = [node({ id: 'cand_1' }), node({ id: 'cand_2' })]
    const g1 = buildGraphData(nodes)
    expect(g1.nodes).toHaveLength(2)
    expect(g1.edges).toHaveLength(1)
    expect(g1.nodes[0].position.x).toBe(0)
    expect(g1.nodes[1].position.x).toBe(NODE_W + NODE_GAP)

    const g2 = buildGraphData([...nodes, node({ id: 'cand_3' })])
    // 前序节点 id 与坐标不变（不整树重排）
    expect(g2.nodes[0]).toEqual(g1.nodes[0])
    expect(g2.nodes[1]).toEqual(g1.nodes[1])
    expect(g2.edges).toHaveLength(2)
  })
})

// ── TC-AIT-222-03：React Flow dynamic import / SSR 不报错（projector 纯函数可用）─
describe('TC-AIT-222-03 图数据 / dynamic', () => {
  it('buildGraphData 为纯函数，空输入安全', () => {
    expect(buildGraphData([])).toEqual({ nodes: [], edges: [] })
  })

  it('面板内容在无 renderGraph（SSR/降级）时正常渲染列表，不依赖 React Flow', () => {
    render(<AttentionPanelContent nodes={[node({ conclusion: '仅列表' })]} goalAnchor={GOAL} />)
    expect(screen.getByText('仅列表')).toBeTruthy()
  })
})

// ── TC-AIT-222-04：点节点 → NodeCard 详情（子交互可展开）────────────────────
describe('TC-AIT-222-04 点选 + 详情', () => {
  it('点击节点显示 NodeCard，子交互可展开', () => {
    const withSub = node({
      id: 'cand_1',
      conclusion: '处理登录',
      user_message: '修一下登录',
      exchanges: [
        { id: 'ex1', message_id: 'm1', user_message: '修一下登录', user_kind: 'instruction', assistant_summary: '看了代码', assistant_actions: [], event_ids: [], tool_count: 1, ts_start: 0, ts_end: 1 },
        { id: 'ex2', message_id: 'm2', user_message: '还报错', user_kind: 'evidence', assistant_summary: '改了 token 校验', assistant_actions: [], event_ids: [], tool_count: 2, ts_start: 1, ts_end: 2 },
      ],
    })
    render(<AttentionPanelContent nodes={[withSub]} goalAnchor={GOAL} />)
    // 初始无详情卡
    expect(screen.queryByTestId('attention-node-card')).toBeNull()

    // 点击列表里的节点
    fireEvent.click(screen.getByText('处理登录'))
    expect(screen.getByTestId('attention-node-card')).toBeTruthy()

    // 展开子交互
    fireEvent.click(screen.getByText('2 轮子交互'))
    expect(screen.getByTestId('attention-subexchanges')).toBeTruthy()
    expect(screen.getByText('改了 token 校验')).toBeTruthy()
  })
})

describe('Attention X 动态树详情', () => {
  afterEach(() => {
    useMessageStore.setState({ focusedMessageTarget: null })
  })

  it('LLM 不可用且没有快照节点时展示配置提示且不渲染动态树', () => {
    render(
      <AttentionXPanel
        topicId="topic_1"
        nodes={[]}
        goalAnchor={GOAL}
        planItems={[]}
        rawEvents={[]}
        llmUnavailable
      />,
    )

    expect(screen.getByText('注意力面板未激活')).toBeTruthy()
    expect(screen.getByText('请进行正确的 LLM 配置以激活注意力面板。')).toBeTruthy()
    expect(screen.queryByTestId('mind-map-graph')).toBeNull()
    expect(screen.queryByText('本地兜底不应展示')).toBeNull()
  })

  it('没有有效 trace 节点且还未进入 LLM 空态时不渲染 goal root 假节点', () => {
    render(
      <AttentionXPanel
        topicId="topic_1"
        nodes={[]}
        goalAnchor={GOAL}
        planItems={[]}
        rawEvents={[]}
      />,
    )

    expect(screen.getByText('暂无有效注意力节点')).toBeTruthy()
    expect(screen.queryByTestId('mind-map-graph')).toBeNull()
    expect(screen.queryByText('消息明细')).toBeNull()
  })

  it('LLM 不可用但已有快照节点时继续展示快照并提示无法重绘', async () => {
    render(
      <AttentionXPanel
        topicId="topic_1"
        nodes={[node({ conclusion: '已保存快照' })]}
        goalAnchor={GOAL}
        planItems={[]}
        rawEvents={[]}
        llmUnavailable
      />,
    )

    expect(screen.getByText('LLM 配置不可用，当前展示的是已保存快照；重新绘制需要正确配置 LLM。')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('mind-map-graph')).toBeTruthy())
  })

  it('展示目标历史，创建目标、切换目标，并在两个自定义目标后禁用创建', () => {
    const createGoal = vi.fn()
    const selectGoal = vi.fn()
    const changeDraft = vi.fn()
    render(
      <AttentionXPanel
        topicId="topic_1"
        nodes={[node()]}
        goalAnchor={GOAL}
        planItems={[]}
        rawEvents={[]}
        goals={[
          { id: 'g1', topic_id: 'topic_1', goal_text: '第一句话目标', title: '默认目标', is_default: true, active: true, source_message_count: 10, source_last_event_ts: 10, created_at: 1, updated_at: 1, has_snapshot: true },
          { id: 'g2', topic_id: 'topic_1', goal_text: '第二个目标内容', title: '第二目标', is_default: false, active: false, source_message_count: 20, source_last_event_ts: 20, created_at: 2, updated_at: 2, has_snapshot: true },
          { id: 'g3', topic_id: 'topic_1', goal_text: '第三个目标内容', title: '第三目标', is_default: false, active: false, source_message_count: 20, source_last_event_ts: 20, created_at: 3, updated_at: 3, has_snapshot: true },
        ]}
        activeGoal={{ id: 'g1', topic_id: 'topic_1', goal_text: '第一句话目标', title: '默认目标', is_default: true, active: true, source_message_count: 10, source_last_event_ts: 10, created_at: 1, updated_at: 1, has_snapshot: true }}
        activeGoalId="g1"
        goalDraft="更清晰的新目标"
        onGoalDraftChange={changeDraft}
        onCreateGoal={createGoal}
        onSelectGoal={selectGoal}
      />,
    )

    expect(screen.getByText('默认目标')).toBeTruthy()
    fireEvent.click(screen.getByText('第二目标'))
    expect(selectGoal).toHaveBeenCalledWith('g2')
    expect(screen.getByText('第三目标')).toBeTruthy()
    expect(screen.getByText('默认目标外最多创建 2 个目标。')).toBeTruthy()
    expect((screen.getByText('创建目标') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('描述一个更清晰的话题目标，Enter 创建新目标'), { target: { value: '新目标' } })
    expect(changeDraft).toHaveBeenCalledWith('新目标')
    expect(screen.queryByText('历史名')).toBeNull()
    expect(screen.queryByText('改名')).toBeNull()
    expect(screen.getByText('目标内容：第一句话目标')).toBeTruthy()
  })

  it('右侧详情按时间交错展示消息，并把 thinking/tool/todo/plan 合并到执行明细', () => {
    const attentionNode = node({
      id: 'cand_1',
      user_message: '帮我做 todo web 应用',
      conclusion: '完成 todo 页面',
      event_ids: ['assistant_1', 'interaction_request_1', 'assistant_2', 'think_1', 'tool_1', 'plan_1'],
      source_message_ids: ['m1', 'm2'],
      exchanges: [
        {
          id: 'ex1',
          message_id: 'm1',
          user_message: '帮我做 todo web 应用',
          user_kind: 'instruction',
          assistant_summary: '我先确认技术栈并准备实现。',
          assistant_actions: ['ask'],
          event_ids: ['think_1'],
          tool_count: 0,
          ts_start: 1,
          ts_end: 2,
        },
        {
          id: 'ex2',
          message_id: 'm2',
          user_message: '选 vue',
          user_kind: 'choice',
          assistant_summary: '已按 Vue 方案实现第一版。',
          assistant_actions: ['solve'],
          event_ids: ['tool_1', 'plan_1'],
          tool_count: 1,
          ts_start: 3,
          ts_end: 4,
        },
      ],
    })
    const rawEvents: RawEvent[] = [
      { id: 'user_1', ts: 1, kind: 'message', role: 'user', message_id: 'm1', payload: { text: '帮我做 todo web 应用' } },
      { id: 'assistant_1', ts: 2, kind: 'message', role: 'assistant', message_id: 'a1', payload: { text: '真实 AI 回复：我会先确认技术栈。' } },
      { id: 'interaction_request_1', ts: 2.5, kind: 'message', role: 'assistant', message_id: 'a1', payload: { text: '需要用户选择：请选择技术栈', options: ['Vue', 'React'] } },
      { id: 'user_2', ts: 3, kind: 'message', role: 'user', message_id: 'm2', payload: { text: '选 vue' } },
      { id: 'assistant_2', ts: 4, kind: 'message', role: 'assistant', message_id: 'a2', payload: { text: '真实 AI 回复：已按 Vue 实现第一版。' } },
      { id: 'think_1', ts: 2, kind: 'thinking', role: 'assistant', payload: { text: '分析技术栈选项' } },
      { id: 'tool_1', ts: 4, kind: 'tool_use', role: 'assistant', payload: { name: 'edit_file', input: { path: 'Todo.vue' }, output: '写入完成' } },
      { id: 'plan_1', ts: 5, kind: 'plan', role: 'assistant', payload: { text: '实现、检查、回归' } },
    ]

    render(
      <AttentionXPanel
        topicId="topic_1"
        nodes={[attentionNode]}
        goalAnchor={GOAL}
        planItems={[{ id: 'plan_item_1', text: '实现 todo 页面', status: 'completed', depth: 0, execution_node_id: 'cand_1' }]}
        rawEvents={rawEvents}
      />,
    )

    expect(screen.getByText('消息明细')).toBeTruthy()
    expect(screen.getByText('帮我做 todo web 应用')).toBeTruthy()
    expect(screen.getByText('真实 AI 回复：我会先确认技术栈。')).toBeTruthy()
    expect(screen.getByText(/需要用户选择：请选择技术栈/)).toBeTruthy()
    expect(screen.getByText(/候选项：Vue；React/)).toBeTruthy()
    expect(screen.getByText('选 vue')).toBeTruthy()
    expect(screen.getByText('真实 AI 回复：已按 Vue 实现第一版。')).toBeTruthy()
    expect(screen.getByText('执行明细 · 1 个工具')).toBeTruthy()
    expect(screen.getByText('思考')).toBeTruthy()
    expect(screen.getByText('edit_file')).toBeTruthy()
    expect(screen.getByText('Plan · completed')).toBeTruthy()
    expect(screen.queryByText('用户信息')).toBeNull()
    expect(screen.queryByText('AI 信息概要')).toBeNull()
    expect(screen.queryByText('Text 明细')).toBeNull()
  })

  it('点击聚合节点后展开子节点', () => {
    const nodes = Array.from({ length: 14 }, (_, index) =>
      node({
        id: `cand_${index + 1}`,
        user_message: `token 中心平台接入第 ${index + 1} 轮`,
        conclusion: `接入方案第 ${index + 1} 段`,
        exchanges: [{
          id: `ex_${index + 1}`,
          message_id: `m_${index + 1}`,
          user_message: `token 中心平台接入第 ${index + 1} 轮`,
          user_kind: 'instruction',
          assistant_summary: `接入方案第 ${index + 1} 段`,
          assistant_actions: ['solve'],
          event_ids: [`e_${index + 1}`],
          tool_count: 0,
          ts_start: index * 2,
          ts_end: index * 2 + 1,
        }],
      }),
    )

    render(
      <AttentionXPanel
        topicId="topic_1"
        nodes={nodes}
        goalAnchor={{ raw_query: 'token 中心平台注册', normalized_goal: 'token 中心平台注册', ts: 0 }}
        planItems={[]}
        rawEvents={[]}
      />,
    )

    const aggregate = screen.getAllByTestId(/^mind-node-agg_|^mind-node-user_/).find((entry) => entry.getAttribute('data-collapsed') === 'true')
    expect(aggregate).toBeTruthy()
    fireEvent.click(aggregate!)
    expect(screen.getAllByTestId(/^mind-node-nested_/).length).toBeGreaterThan(0)
  })

  it('点击图节点右上角定位入口时跳转对应消息且不触发展开', () => {
    const attentionNode = node({
      id: 'cand_1',
      user_message: '帮我修登录',
      source_message_ids: ['m_1'],
      exchanges: [{
        id: 'ex_1',
        message_id: 'm_1',
        user_message: '帮我修登录',
        user_kind: 'instruction',
        assistant_summary: '定位登录问题',
        assistant_actions: ['solve'],
        event_ids: ['e_1'],
        tool_count: 0,
        ts_start: 1,
        ts_end: 2,
      }],
    })

    render(
      <AttentionXPanel
        topicId="topic_1"
        nodes={[attentionNode]}
        goalAnchor={GOAL}
        planItems={[]}
        rawEvents={[]}
      />,
    )

    fireEvent.click(screen.getByLabelText('定位到对应消息 user_cand_1'))
    expect(useMessageStore.getState().focusedMessageTarget).toMatchObject({
      topicId: 'topic_1',
      messageId: 'm_1',
    })
    expect(screen.getByTestId('mind-node-user_cand_1').getAttribute('data-collapsed')).toBe('false')
  })
})
