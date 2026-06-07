import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAttentionTrace } from '../lib/attention/use-attention-trace'
import { useMessageStore } from '../stores/message-store'

afterEach(() => {
  vi.restoreAllMocks()
  useMessageStore.setState({
    byTopic: {},
    partsByMessage: {},
    agentStatusByTopic: {},
  } as any)
})

describe('Attention server-owned hook', () => {
  it('TC-AIT-SRV-06 不调用 interpret/PUT snapshot，只调用 goals/snapshot/rebuild 并渲染 server snapshot', async () => {
    useMessageStore.setState({
      byTopic: {
        topic_1: [
          {
            id: 'm1',
            topic_id: 'topic_1',
            role: 'user',
            status: 'done',
            started_at: 1,
            finished_at: 2,
            stop_reason: null,
            cron_run_id: null,
            turn_id: null,
            client_message_id: null,
            retry_count: 0,
            max_retries: 2,
          },
        ],
      },
      partsByMessage: {
        m1: [{ id: 'p1', message_id: 'm1', ordinal: 0, kind: 'text', content_json: JSON.stringify({ content: '第一句话目标' }) }],
      },
      agentStatusByTopic: { topic_1: 'idle' },
    } as any)

    const calls: Array<{ url: string; method: string; body?: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      const path = String(url)
      calls.push({ url: path, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : undefined })
      if (path.endsWith('/attention/goals/topic_1')) {
        return Response.json({ goals: [{ id: 'g1', topic_id: 'topic_1', goal_text: '第一句话目标', title: '默认目标', is_default: true, active: true, source_message_count: 1, source_last_event_ts: 2, created_at: 1, updated_at: 1, has_snapshot: true }] })
      }
      if (path.endsWith('/attention/goals/g1/snapshot')) {
        return Response.json({
          snapshot: {
            id: 'g1',
            topic_id: 'topic_1',
            goal_text: '第一句话目标',
            title: '默认目标',
            is_default: true,
            active: true,
            source_message_count: 1,
            source_last_event_ts: 2,
            created_at: 1,
            updated_at: 1,
            has_snapshot: true,
            goal_json: JSON.stringify({ raw_query: '第一句话目标', normalized_goal: '第一句话目标', ts: 1 }),
            raw_events_json: JSON.stringify([{ id: 'e1', ts: 1, kind: 'message', role: 'user', payload: { text: '第一句话目标' } }]),
            candidates_json: '[]',
            interpret_json: '{}',
            trace_nodes_json: JSON.stringify([{
              id: 'cand_1',
              parent_id: null,
              branch_id: 'main',
              user_message: '业务目标',
              intent: '业务目标',
              rationale: null,
              conclusion: 'server 生成的节点',
              planned_ref: null,
              alignment: 'unplanned',
              goal_distance: 0.1,
              status: 'done',
              event_ids: ['e1'],
              source_message_ids: ['m1'],
              step_count: 0,
              ts_start: 1,
              ts_end: 2,
            }]),
            plan_items_json: '[]',
            degraded_reason: null,
          },
        })
      }
      if (path.endsWith('/attention/goals/g1/rebuild')) {
        return Response.json({ ok: true, snapshot: null })
      }
      return Response.json({}, { status: 404 })
    }))

    const { result } = renderHook(() => useAttentionTrace('topic_1'))
    await waitFor(() => expect(result.current.nodes).toHaveLength(1))

    expect(result.current.nodes[0].conclusion).toBe('server 生成的节点')
    expect(calls.some((call) => call.url.endsWith('/attention/interpret'))).toBe(false)
    expect(calls.some((call) => call.method === 'PUT' && call.url.includes('/snapshot'))).toBe(false)
    expect(calls.filter((call) => call.url.endsWith('/attention/goals/g1/rebuild'))).toHaveLength(1)
    expect(calls.find((call) => call.url.endsWith('/attention/goals/g1/rebuild'))?.body).toBe('{}')
  })

  it('切换 topic 时不会显示上一个 topic 的 attention snapshot', async () => {
    const goal = (id: string, topicId: string, text: string) => ({
      id,
      topic_id: topicId,
      goal_text: text,
      title: '默认目标',
      is_default: true,
      active: true,
      source_message_count: 1,
      source_last_event_ts: 2,
      created_at: 1,
      updated_at: 1,
      has_snapshot: true,
    })
    const snapshot = (id: string, topicId: string, text: string, conclusion: string) => ({
      ...goal(id, topicId, text),
      goal_json: JSON.stringify({ raw_query: text, normalized_goal: text, ts: 1 }),
      raw_events_json: JSON.stringify([{ id: `${topicId}_event`, ts: 1, kind: 'message', role: 'user', payload: { text } }]),
      candidates_json: '[]',
      interpret_json: '{}',
      trace_nodes_json: JSON.stringify([{
        id: `${topicId}_cand`,
        parent_id: null,
        branch_id: 'main',
        user_message: text,
        intent: text,
        rationale: null,
        conclusion,
        planned_ref: null,
        alignment: 'unplanned',
        goal_distance: 0.1,
        status: 'done',
        event_ids: [`${topicId}_event`],
        source_message_ids: [`${topicId}_message`],
        step_count: 0,
        ts_start: 1,
        ts_end: 2,
      }]),
      plan_items_json: '[]',
      degraded_reason: null,
    })

    const oldSnapshot = snapshot('old_goal', 'old_topic', '旧目录目标', '旧图节点')
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const path = String(url)
      if (path.endsWith('/attention/goals/old_topic')) {
        return Response.json({ goals: [goal('old_goal', 'old_topic', '旧目录目标')] })
      }
      if (path.endsWith('/attention/goals/old_goal/snapshot')) {
        return Response.json({ snapshot: oldSnapshot })
      }
      if (path.endsWith('/attention/goals/new_topic')) {
        return Response.json({ goals: [goal('new_goal', 'new_topic', '新目录目标')] })
      }
      if (path.endsWith('/attention/goals/new_goal/snapshot')) {
        return Response.json({ snapshot: oldSnapshot })
      }
      if (path.endsWith('/attention/goals/new_goal/rebuild')) {
        return Response.json({ ok: true, snapshot: oldSnapshot })
      }
      return Response.json({}, { status: 404 })
    }))

    const { result, rerender } = renderHook(
      ({ topicId }) => useAttentionTrace(topicId),
      { initialProps: { topicId: 'old_topic' } },
    )
    await waitFor(() => expect(result.current.nodes[0]?.conclusion).toBe('旧图节点'))

    rerender({ topicId: 'new_topic' })
    expect(result.current.nodes).toHaveLength(0)

    await waitFor(() => expect(result.current.activeGoalId).toBe('new_goal'))
    expect(result.current.nodes).toHaveLength(0)
    expect(result.current.goalAnchor?.normalized_goal).toBe('新目录目标')
  })
})
