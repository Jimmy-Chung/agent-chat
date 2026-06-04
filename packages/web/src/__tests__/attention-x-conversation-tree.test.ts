import { describe, expect, it } from 'vitest'
import type { GoalAnchor, TraceNode } from '../lib/attention'
import { governConversationTree } from '../lib/attention/conversation-tree'
import { buildMindMapProjection } from '../lib/attention/mind-map-projector'

const GOAL: GoalAnchor = { raw_query: '修复登录问题', normalized_goal: '修复登录问题', ts: 0 }

function node(id: string, over: Partial<TraceNode> = {}): TraceNode {
  const order = Number(id.replace(/\D/g, '')) || 1
  return {
    id,
    parent_id: null,
    branch_id: 'main',
    user_message: `用户回合 ${id}`,
    intent: '',
    rationale: null,
    conclusion: `结论 ${id}`,
    planned_ref: null,
    alignment: 'unplanned',
    goal_distance: 0.2,
    status: 'done',
    event_ids: [id],
    step_count: 1,
    user_kind: 'instruction',
    ts_start: order * 1000,
    ts_end: order * 1000 + 1,
    ...over,
  }
}

describe('attention-x conversation tree governance', () => {
  it('groups long chat turns into collapsed topic nodes while keeping the active topic expanded', () => {
    const tree = governConversationTree([
      node('n1'),
      node('n2'),
      node('n3'),
      node('n4'),
      node('n5'),
      node('n6', { user_kind: 'question' }),
    ], GOAL, [], { topicTurnLimit: 2, keepExpandedRecentTopics: 1 })

    const topics = tree.orderedIds.map((id) => tree.nodes[id]).filter((entry) => entry.kind === 'topic')
    expect(topics.length).toBeGreaterThan(1)
    expect(topics.some((topic) => topic.collapsed)).toBe(true)
    expect(topics.at(-1)?.active).toBe(true)
    expect(topics.at(-1)?.collapsed).toBe(false)
  })

  it('attaches off-goal work as a child topic under the active topic', () => {
    const tree = governConversationTree([
      node('n1', { goal_distance: 0.1 }),
      node('n2', { goal_distance: 0.8, user_kind: 'question' }),
      node('n3', { goal_distance: 0.82 }),
      node('n4', { goal_distance: 0.15 }),
    ], GOAL, [])

    const branchTopic = tree.orderedIds.map((id) => tree.nodes[id]).find((entry) => entry.kind === 'topic' && entry.relation === 'branch')
    expect(branchTopic?.parentId).toBe('topic_main_n1')
    expect(branchTopic?.childIds).toContain('turn_n2')
  })

  it('projects governed tree into a connected user-node mind map', () => {
    const projection = buildMindMapProjection([
      node('n1', { goal_distance: 0.1 }),
      node('n2', { goal_distance: 0.72, user_kind: 'question' }),
    ], GOAL, [])

    expect(projection.nodes.map((entry) => entry.kind)).toContain('goal')
    expect(projection.nodes.map((entry) => entry.kind)).toContain('user')
    expect(projection.edges.length).toBeGreaterThan(0)
    expect(projection.edges.some((edge) => edge.kind === 'branch')).toBe(true)
  })

  it('uses user messages as graph node subjects instead of assistant conclusions', () => {
    const tree = governConversationTree([
      node('n1', { user_message: '用户：我要修登录', conclusion: 'AI：定位 token 过期' }),
    ], GOAL, [])

    expect(tree.nodes.topic_main_n1.title).toContain('用户：我要修登录')
    expect(tree.nodes.topic_main_n1.title).not.toContain('AI：定位')
    expect(tree.nodes.turn_n1.title).toContain('用户：我要修登录')
    expect(tree.nodes.turn_n1.title).not.toContain('AI：定位')
  })

  it('lays out branch and return turns left-to-right by event time', () => {
    const projection = buildMindMapProjection([
      node('n1', { goal_distance: 0.1, user_message: '讨论 A' }),
      node('n2', { goal_distance: 0.8, user_kind: 'question', user_message: '突然讨论 B' }),
      node('n3', { goal_distance: 0.82, user_message: '继续 B' }),
      node('n4', { goal_distance: 0.15, user_kind: 'instruction', user_message: '回到 A' }),
    ], GOAL, [])

    const branch = projection.nodes.find((entry) => entry.id === 'agg_topic_branch_n2')
    const n4 = projection.nodes.find((entry) => entry.id === 'user_n4')
    expect(branch?.position.x).toBeLessThan(n4?.position.x ?? 0)
    expect(branch?.position.y).toBeGreaterThan(projection.nodes.find((entry) => entry.id === 'user_n1')?.position.y ?? 0)
    expect(branch?.title).toContain('突然讨论 B')
  })

  it('expands an aggregate node into a local user-message subgraph', () => {
    const collapsed = buildMindMapProjection([
      node('n1', { goal_distance: 0.1, user_message: '讨论 A' }),
      node('n2', { goal_distance: 0.8, user_kind: 'question', user_message: '突然讨论 B' }),
      node('n3', { goal_distance: 0.82, user_message: '继续 B' }),
      node('n4', { goal_distance: 0.15, user_kind: 'instruction', user_message: '回到 A' }),
    ], GOAL, [])
    expect(collapsed.nodes.some((entry) => entry.id === 'nested_n2')).toBe(false)

    const expanded = buildMindMapProjection([
      node('n1', { goal_distance: 0.1, user_message: '讨论 A' }),
      node('n2', { goal_distance: 0.8, user_kind: 'question', user_message: '突然讨论 B' }),
      node('n3', { goal_distance: 0.82, user_message: '继续 B' }),
      node('n4', { goal_distance: 0.15, user_kind: 'instruction', user_message: '回到 A' }),
    ], GOAL, [], new Set(['agg_topic_branch_n2']))
    expect(expanded.nodes.find((entry) => entry.id === 'nested_n2')?.title).toBe('突然讨论 B')
    expect(expanded.edges.some((edge) => edge.source === 'agg_topic_branch_n2' && edge.target === 'nested_n2')).toBe(true)
  })

  it('archives a resolved child topic and marks the latest turn as current', () => {
    const tree = governConversationTree([
      node('n1', { goal_distance: 0.1 }),
      node('n2', { goal_distance: 0.78, user_kind: 'question' }),
      node('n3', { goal_distance: 0.82 }),
      node('n4', { goal_distance: 0.18, user_kind: 'instruction' }),
    ], GOAL, [], { topicTurnLimit: 3, keepExpandedRecentTopics: 1 })

    const branchTopic = tree.orderedIds.map((id) => tree.nodes[id]).find((entry) => entry.kind === 'topic' && entry.relation === 'branch')
    expect(branchTopic?.collapsed).toBe(true)
    expect(branchTopic?.aggregation?.reason).toBe('resolved')
    expect(tree.nodes.turn_n4.current).toBe(true)
    expect(tree.nodes.turn_n4.active).toBe(true)
  })

  it('keeps a single mainline and routes unrelated weather questions into one dashed branch', () => {
    const goal: GoalAnchor = { raw_query: '帮我做一个 todo web 应用', normalized_goal: '做 todo web 应用', ts: 0 }
    const projection = buildMindMapProjection([
      node('n1', { user_message: '帮我做一个 todo web 应用', goal_distance: 0.05 }),
      node('n2', {
        user_message: '选 vue',
        user_kind: 'choice',
        goal_distance: 0.12,
        exchanges: [{
          id: 'e2',
          user_message: '选 vue',
          user_kind: 'choice',
          prev_ai_summary: '你要怎么做？给出选项：vue、react、svelte',
          assistant_summary: '采用 vue 实现 todo web 应用',
          assistant_actions: ['options', 'solve'],
          event_ids: ['n2'],
          tool_count: 0,
          ts_start: 2000,
          ts_end: 2001,
        }],
      }),
      node('n3', { user_message: '好的我试一下', goal_distance: 0.22, conclusion: '实现完成，用户准备试用' }),
      node('n4', { user_message: '帮我修改一个页面的按钮', goal_distance: 0.18, conclusion: '按钮页面已修改' }),
      node('n5', { user_message: '今天天气怎样', user_kind: 'question', goal_distance: 0.86, conclusion: '今天 17 度' }),
      node('n6', { user_message: '今天会下雨吗', user_kind: 'question', goal_distance: 0.88, conclusion: '不会下雨' }),
      node('n7', { user_message: '帮我刷新一下页面，看看修改按钮的效果', goal_distance: 0.24 }),
    ], goal, [])

    const edge = (source: string, target: string) => projection.edges.find((entry) => entry.source === source && entry.target === target)

    expect(edge('tree_goal', 'user_n1')?.kind).toBe('main')
    expect(edge('user_n1', 'user_n2')?.kind).toBe('main')
    expect(edge('user_n2', 'user_n3')?.kind).toBe('main')
    expect(edge('user_n3', 'user_n4')?.kind).toBe('main')
    expect(edge('user_n4', 'user_n7')?.kind).toBe('main')
    expect(edge('user_n4', 'agg_topic_branch_n5')?.kind).toBe('branch')
    expect(projection.nodes.find((entry) => entry.id === 'agg_topic_branch_n5')?.title).toContain('今天天气怎样')
  })

  it('keeps follow-up questions about the previous assistant answer on the mainline', () => {
    const goal: GoalAnchor = {
      raw_query: '我想调研一下关于中国人境外投资的一些现状',
      normalized_goal: '中国人境外投资现状调研',
      ts: 0,
    }
    const projection = buildMindMapProjection([
      node('n1', {
        user_message: '我想调研一下关于中国人境外投资的一些现状',
        goal_distance: 0.08,
        conclusion: '整理中国境外投资现状、主要目的地、个人境外投资渠道和政策环境',
        exchanges: [{
          id: 'e1',
          user_message: '我想调研一下关于中国人境外投资的一些现状',
          user_kind: 'instruction',
          assistant_summary: '中国境外投资现状包含主要投资方向、代表国家、资金规模、ODI、东南亚、欧洲、中东和个人境外投资渠道',
          assistant_actions: ['solve'],
          event_ids: ['n1'],
          tool_count: 0,
          ts_start: 1000,
          ts_end: 1001,
        }],
      }),
      node('n2', {
        user_message: '可以把投资的主要国家跟著要资金画成一张图吗',
        user_kind: 'question',
        goal_distance: 0.74,
        conclusion: '绘制中国 ODI 主要目的地和年均资金规模条形图',
      }),
      node('n3', {
        user_message: '现在这个项目的目录是在哪里的',
        user_kind: 'question',
        goal_distance: 0.86,
      }),
    ], goal, [])

    const edge = (source: string, target: string) => projection.edges.find((entry) => entry.source === source && entry.target === target)
    expect(edge('user_n1', 'user_n2')?.kind).toBe('main')
    expect(edge('user_n2', 'user_n3')?.kind).toBe('branch')
  })

  it('keeps follow-ups on the mainline when the previous AI answer has a long preface', () => {
    const goal: GoalAnchor = {
      raw_query: '我想调研一下关于中国人境外投资的一些现状',
      normalized_goal: '中国人境外投资现状调研',
      ts: 0,
    }
    const longAssistantSummary = [
      '很抱歉，目前 web_search 工具因 API 密钥问题暂时不可用。不过，我可以根据已有知识先整理综合调研框架和核心要点。',
      '宏观规模与趋势包括 ODI 流量、存量、结构变化和政策监管。',
      '主要投资方向包含代表国家、主要目的地、投资资金规模、年均 ODI 流量、东南亚、欧洲、中东、巴西、美国和澳大利亚。',
    ].join('')
    const projection = buildMindMapProjection([
      node('n1', {
        user_message: '我想调研一下关于中国人境外投资的一些现状',
        goal_distance: 0.08,
        conclusion: '境外投资调研框架',
        exchanges: [{
          id: 'e1-long',
          user_message: '我想调研一下关于中国人境外投资的一些现状',
          user_kind: 'instruction',
          assistant_summary: longAssistantSummary,
          assistant_actions: ['solve'],
          event_ids: ['n1'],
          tool_count: 0,
          ts_start: 1000,
          ts_end: 1001,
        }],
      }),
      node('n2', {
        user_message: '可以把投资的主要国家跟著要资金画成一张图吗',
        user_kind: 'question',
        goal_distance: 0.9,
        conclusion: '生成主要国家和资金图表',
      }),
    ], goal, [])

    expect(projection.edges.find((entry) => entry.source === 'user_n1' && entry.target === 'user_n2')?.kind).toBe('main')
  })

  it('compacts direct children before a layer exceeds the attention limit', () => {
    const nodes = Array.from({ length: 14 }, (_, index) =>
      node(`n${index + 1}`, {
        user_message: `继续修复登录问题 ${index + 1}`,
        goal_distance: 0.1,
      }),
    )
    const tree = governConversationTree(nodes, GOAL, [], {
      topicTurnLimit: 30,
      compactSoftLimit: 8,
      maxDirectChildren: 10,
    })
    const topic = tree.nodes.topic_main_n1
    const visibleChildren = topic.childIds.filter((id) => {
      const child = tree.nodes[id]
      return child?.kind === 'turn' || child?.kind === 'topic'
    })
    const compactTopic = visibleChildren.map((id) => tree.nodes[id]).find((entry) => entry.kind === 'topic' && entry.aggregation?.reason === 'capacity_compact')

    expect(visibleChildren.length).toBeLessThanOrEqual(10)
    expect(compactTopic?.collapsed).toBe(true)
    expect(compactTopic?.childIds.length).toBeGreaterThan(1)
    expect(compactTopic?.aggregation?.turnCount).toBeGreaterThan(1)
  })

  it('renders capacity compact groups as expandable aggregate nodes', () => {
    const nodes = Array.from({ length: 14 }, (_, index) =>
      node(`n${index + 1}`, {
        user_message: `继续修复登录问题 ${index + 1}`,
        goal_distance: 0.1,
      }),
    )
    const collapsed = buildMindMapProjection(nodes, GOAL, [], new Set(), {
      topicTurnLimit: 30,
      compactSoftLimit: 8,
      maxDirectChildren: 10,
    })
    const aggregate = collapsed.nodes.find((entry) => entry.kind === 'aggregate' && entry.aggregation?.reason === 'capacity_compact')
    expect(aggregate?.hasChildren).toBe(true)
    expect(aggregate?.collapsed).toBe(true)

    const expanded = buildMindMapProjection(nodes, GOAL, [], new Set([aggregate?.id ?? '']), {
      topicTurnLimit: 30,
      compactSoftLimit: 8,
      maxDirectChildren: 10,
    })
    expect(expanded.nodes.some((entry) => entry.id.startsWith('nested_n'))).toBe(true)
  })

  it('uses summary titles for long user and aggregate nodes instead of truncating raw text', () => {
    const longMessage = '我想系统性调研一下中国高净值人群境外投资的主要国家、资金规模、合规路径、政策风险、资产配置偏好以及未来趋势'
    const projection = buildMindMapProjection([
      node('n1', {
        user_message: longMessage,
        goal_distance: 0.08,
      }),
      node('n2', {
        user_message: '顺便问一下今天天气怎样',
        user_kind: 'question',
        goal_distance: 0.9,
      }),
      node('n3', {
        user_message: '今天会下雨吗',
        user_kind: 'question',
        goal_distance: 0.88,
      }),
      node('n4', {
        user_message: '回到境外投资合规路径，帮我继续整理',
        goal_distance: 0.12,
      }),
    ], {
      raw_query: longMessage,
      normalized_goal: longMessage,
      ts: 0,
    }, [])

    const user = projection.nodes.find((entry) => entry.id === 'user_n1')
    const aggregate = projection.nodes.find((entry) => entry.id === 'agg_topic_branch_n2')
    expect(user?.title).not.toContain('…')
    expect(user?.title).not.toBe(longMessage.slice(0, user?.title.length ?? 0))
    expect(aggregate?.title).not.toContain('…')
  })

  it('does not render overlapping token fragments as node summaries', () => {
    const projection = buildMindMapProjection([
      node('n1', {
        user_message: 'adapter 那边已经经编辑，现在需要继续确认 mirror 版本',
        goal_distance: 0.08,
      }),
    ], {
      raw_query: 'adapter 那边已经经编辑，现在需要继续确认 mirror 版本',
      normalized_goal: 'adapter 那边已经经编辑，现在需要继续确认 mirror 版本',
      ts: 0,
    }, [])

    const title = projection.nodes.find((entry) => entry.id === 'user_n1')?.title ?? ''
    expect(title).not.toContain(' / 那边 / 边已')
    expect(title).not.toContain('边已 / 已经 / 经编')
  })
})
