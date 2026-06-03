import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { GoalAnchor, TraceNode } from '../lib/attention'
import { buildGraphData, NODE_W, NODE_GAP } from '../lib/attention/graph-projector'
import { AttentionPanelContent } from '../components/attention/AttentionPanelContent'

afterEach(cleanup)

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
        { id: 'ex1', user_message: '修一下登录', user_kind: 'instruction', assistant_summary: '看了代码', assistant_actions: [], event_ids: [], tool_count: 1, ts_start: 0, ts_end: 1 },
        { id: 'ex2', user_message: '还报错', user_kind: 'evidence', assistant_summary: '改了 token 校验', assistant_actions: [], event_ids: [], tool_count: 2, ts_start: 1, ts_end: 2 },
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
