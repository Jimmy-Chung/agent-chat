import { describe, expect, it, vi } from 'vitest'
import type { MindMapProjection } from '@agent-chat/protocol'
import { buildMindMapProjection, type TraceNode } from '@agent-chat/protocol'
import {
  applyAggregationDecisions,
  buildAggregationDecisionPrompt,
  collectAggregationGroups,
  parseAggregationDecisionStore,
  resolveAggregationDecisions,
} from '../services/attention-aggregation-decisions'

function projection(): MindMapProjection {
  return {
    nodes: [
      {
        id: 'root',
        kind: 'goal',
        treeNodeId: 'tree_goal',
        title: '目标',
        subtitle: '',
        relation: 'main',
        goalDistance: 0,
        active: false,
        current: false,
        collapsed: false,
        depth: 0,
        sourceNodeIds: [],
        aggregation: null,
        hasChildren: true,
        position: { x: 0, y: 0 },
      },
      {
        id: 'agg_topic_1',
        kind: 'aggregate',
        treeNodeId: 'topic_1',
        title: '已 compact：旧上下文',
        subtitle: '3 轮用户输入 · 已聚合',
        relation: 'main',
        goalDistance: 0.2,
        active: false,
        current: false,
        collapsed: true,
        depth: 1,
        sourceNodeIds: ['a', 'b', 'c'],
        aggregation: {
          reason: 'capacity_compact',
          groupKey: 'a|b|c',
          groupType: 'capacity',
          childCount: 3,
          turnCount: 3,
          toolCount: 2,
          sourceTitles: ['登录排查', 'token 修复', '验证部署'],
        },
        hasChildren: true,
        position: { x: 300, y: 0 },
      },
    ],
    edges: [],
  }
}

describe('attention aggregation decisions', () => {
  it('collects aggregation groups with stable decision keys', () => {
    const groups = collectAggregationGroups(projection())
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      nodeId: 'agg_topic_1',
      decisionKey: 'capacity:a|b|c',
      groupType: 'capacity',
    })
    expect(buildAggregationDecisionPrompt(groups)).toContain('登录排查 / token 修复 / 验证部署')
  })

  it('applies LLM title and summary to aggregate nodes', () => {
    const groups = collectAggregationGroups(projection())
    const patched = applyAggregationDecisions(projection(), groups, {
      'capacity:a|b|c': {
        mergeable: true,
        confidence: 0.9,
        title: '登录修复闭环',
        summary: '排查并验证登录 token 问题',
        reason: '同一修复阶段',
      },
    })
    const node = patched.nodes.find((n) => n.id === 'agg_topic_1')!
    expect(node.title).toBe('登录修复闭环')
    expect(node.subtitle).toBe('排查并验证登录 token 问题 · 已聚合')
    expect(node.aggregation?.semanticConfidence).toBe(0.9)
  })

  it('resolves misses through injected LLM and freezes next store', async () => {
    const decide = vi.fn().mockResolvedValue({
      ok: true,
      decisions: [{
        mergeable: true,
        confidence: 0.8,
        title: '登录修复',
        summary: '登录 token 排查与验证',
        reason: '同一问题',
      }],
    })
    const result = await resolveAggregationDecisions({
      projection: projection(),
      frozenStore: {},
      llm: { apiKey: 'k', baseUrl: 'u', model: 'm' },
      decideAggregations: decide,
    })
    expect(decide).toHaveBeenCalledTimes(1)
    expect(result.nextStore['capacity:a|b|c']?.title).toBe('登录修复')
    expect(result.projection.nodes.find((n) => n.id === 'agg_topic_1')?.title).toBe('登录修复')
  })

  it('parses frozen store defensively', () => {
    expect(parseAggregationDecisionStore('{bad')).toEqual({})
    expect(parseAggregationDecisionStore(JSON.stringify({
      k: { mergeable: false, confidence: 2, title: 't', summary: 's', reason: 'r' },
    })).k).toEqual({ mergeable: false, confidence: 1, title: 't', summary: 's', reason: 'r' })
  })

  it('blocked branch aggregation keeps a resolved branch expanded', () => {
    const traceNodes: TraceNode[] = [
      {
        id: 'cand_main_1',
        user_message: '继续修登录主线',
        intent: '登录主线',
        goal_distance: 0.1,
        ts_start: 0,
        ts_end: 0,
        source_message_ids: ['msg_main_1'],
        user_kind: 'instruction',
      },
      {
        id: 'cand_branch_1',
        user_message: '顺便问一下今天天气怎样',
        intent: '天气问题',
        goal_distance: 0.9,
        ts_start: 1,
        ts_end: 1,
        source_message_ids: ['msg_branch_1'],
        user_kind: 'question',
      },
      {
        id: 'cand_main_2',
        user_message: '回到登录问题继续修 token',
        intent: '登录 token',
        goal_distance: 0.1,
        ts_start: 2,
        ts_end: 2,
        source_message_ids: ['msg_main_2'],
        user_kind: 'instruction',
      },
    ].map((partial, index) => ({
      id: partial.id,
      parent_id: null,
      branch_id: 'main',
      user_message: partial.user_message,
      intent: partial.intent,
      rationale: null,
      conclusion: '继续处理登录',
      planned_ref: null,
      alignment: 'unplanned',
      goal_distance: partial.goal_distance,
      status: 'done',
      event_ids: [],
      source_message_ids: partial.source_message_ids,
      step_count: 0,
      user_kind: partial.user_kind,
      assistant_actions: [],
      user_message_count: 1,
      exchanges: [],
      ts_start: partial.ts_start ?? index,
      ts_end: partial.ts_end ?? index,
    })) as TraceNode[]
    const goal = { raw_query: '修登录', normalized_goal: '修登录', ts: 0 }
    const collapsed = buildMindMapProjection(traceNodes, goal, [], new Set())
    const aggregate = collapsed.nodes.find((node) => node.kind === 'aggregate' && node.aggregation?.groupType === 'branch')
    expect(aggregate).toBeTruthy()
    const key = aggregate?.aggregation?.groupKey
    expect(key).toBe('msg_branch_1')
    const blockKey = collectAggregationGroups(collapsed).find((group) => group.nodeId === aggregate?.id)?.blockKey
    expect(blockKey).toBe('branch:cand_branch_1')

    const expanded = buildMindMapProjection(traceNodes, goal, [], new Set(), {
      blockedAggregationKeys: new Set([blockKey!]),
    })
    expect(expanded.nodes.some((node) => node.kind === 'aggregate' && node.aggregation?.groupType === 'branch')).toBe(false)
  })

  it('blocked content aggregation expands a multi-message trace node', async () => {
    const traceNodes: TraceNode[] = [{
      id: 'cand_multi_1',
      parent_id: null,
      branch_id: 'main',
      user_message: '第一件事修登录，第二件事看账单',
      intent: '多问题输入',
      rationale: null,
      conclusion: '包含两个问题',
      planned_ref: null,
      alignment: 'unplanned',
      goal_distance: 0.2,
      status: 'done',
      event_ids: [],
      source_message_ids: ['msg_login', 'msg_billing'],
      step_count: 0,
      user_kind: 'instruction',
      assistant_actions: [],
      user_message_count: 2,
      exchanges: [
        {
          id: 'ex_login',
          message_id: 'msg_login',
          user_message: '修登录',
          user_kind: 'instruction',
          assistant_summary: '处理登录',
          assistant_actions: [],
          event_ids: [],
          tool_count: 0,
          ts_start: 0,
          ts_end: 0,
        },
        {
          id: 'ex_billing',
          message_id: 'msg_billing',
          user_message: '看账单',
          user_kind: 'instruction',
          assistant_summary: '处理账单',
          assistant_actions: [],
          event_ids: [],
          tool_count: 0,
          ts_start: 0,
          ts_end: 0,
        },
      ],
      ts_start: 0,
      ts_end: 0,
    }]
    const goal = { raw_query: '修登录', normalized_goal: '修登录', ts: 0 }
    const collapsed = buildMindMapProjection(traceNodes, goal, [], new Set())
    const aggregate = collapsed.nodes.find((node) => node.kind === 'aggregate' && node.aggregation?.groupType === 'content')
    expect(aggregate).toBeTruthy()
    expect(collectAggregationGroups(collapsed).find((group) => group.nodeId === aggregate?.id)?.blockKey).toBe('content:cand_multi_1')

    const result = await resolveAggregationDecisions({
      projection: collapsed,
      frozenStore: {},
      llm: { apiKey: 'k', baseUrl: 'u', model: 'm' },
      decideAggregations: vi.fn().mockResolvedValue({
        ok: true,
        decisions: [{
          mergeable: false,
          confidence: 0.7,
          title: '不聚合',
          summary: '两个不同问题',
          reason: '登录和账单不是同一主题',
        }],
      }),
    })
    expect([...result.rejectedKeys]).toEqual(['content:cand_multi_1'])

    const expanded = buildMindMapProjection(traceNodes, goal, [], new Set(), {
      blockedAggregationKeys: result.rejectedKeys,
    })
    expect(expanded.nodes.some((node) => node.kind === 'aggregate' && node.aggregation?.groupType === 'content')).toBe(false)

    const final = await resolveAggregationDecisions({
      projection: expanded,
      frozenStore: result.nextStore,
      llm: { apiKey: 'k', baseUrl: 'u', model: 'm' },
      decideAggregations: vi.fn(),
    })
    expect(final.nextStore['content:msg_billing|msg_login']?.mergeable).toBe(false)
  })
})
