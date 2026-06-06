import { describe, expect, it } from 'vitest'
import type { Message } from '@agent-chat/protocol'
import { hasActiveAttentionMessage, toLoadedSnapshot } from '../lib/attention/use-attention-trace'

function makeMessage(overrides: Partial<Message>): Message {
  return {
    id: overrides.id ?? 'm1',
    topic_id: overrides.topic_id ?? 'topic-1',
    role: overrides.role ?? 'user',
    status: overrides.status ?? 'done',
    started_at: overrides.started_at ?? 1_000,
    finished_at: overrides.finished_at ?? 1_100,
    stop_reason: overrides.stop_reason ?? null,
    cron_run_id: overrides.cron_run_id ?? null,
    turn_id: overrides.turn_id ?? null,
    client_message_id: overrides.client_message_id ?? null,
    retry_count: overrides.retry_count ?? 0,
    max_retries: overrides.max_retries ?? 2,
  }
}

describe('hasActiveAttentionMessage', () => {
  it('treats streaming and retrying as active', () => {
    expect(hasActiveAttentionMessage([makeMessage({ status: 'streaming' })])).toBe(true)
    expect(hasActiveAttentionMessage([makeMessage({ role: 'assistant', status: 'retrying' })])).toBe(true)
  })

  it('treats fresh pending user messages as active', () => {
    expect(hasActiveAttentionMessage([makeMessage({ status: 'pending', started_at: Date.now() - 60_000 })])).toBe(true)
  })

  it('treats stale pending user messages and settled messages as inactive', () => {
    expect(hasActiveAttentionMessage([makeMessage({ status: 'pending', started_at: Date.now() - 5 * 60_000 })])).toBe(false)
    expect(hasActiveAttentionMessage([makeMessage({ status: 'needs_retry' })])).toBe(false)
    expect(hasActiveAttentionMessage([makeMessage({ status: 'done' })])).toBe(false)
  })
})

describe('toLoadedSnapshot', () => {
  function snapshot(overrides: Record<string, unknown> = {}) {
    return {
      id: 'goal_1',
      topic_id: 'topic-1',
      goal_text: '默认目标',
      title: '默认目标',
      is_default: true,
      active: true,
      source_message_count: 0,
      source_last_event_ts: 0,
      created_at: 1,
      updated_at: 1,
      has_snapshot: false,
      goal_json: null,
      raw_events_json: '[]',
      candidates_json: '[]',
      interpret_json: '{}',
      trace_nodes_json: '[]',
      plan_items_json: '[]',
      ...overrides,
    } as any
  }

  it('rejects default goal shells that have no saved graph data', () => {
    expect(toLoadedSnapshot(snapshot())).toBeNull()
  })

  it('rejects empty graph payloads even when stale metadata says a snapshot exists', () => {
    expect(toLoadedSnapshot(snapshot({ has_snapshot: true, source_message_count: 4, source_last_event_ts: 100 }))).toBeNull()
  })

  it('loads a valid persisted graph snapshot', () => {
    const loaded = toLoadedSnapshot(snapshot({
      has_snapshot: true,
      source_message_count: 4,
      source_last_event_ts: 100,
      goal_json: JSON.stringify({ raw_query: '目标', normalized_goal: '目标', ts: 1 }),
      raw_events_json: JSON.stringify([{ id: 'e1', ts: 1, kind: 'message', role: 'user', payload: { text: '你好' } }]),
      interpret_json: JSON.stringify({ conclusion: ['结论'], goalAlignment: [8] }),
      trace_nodes_json: JSON.stringify([{
        id: 'cand_1',
        parent_id: null,
        branch_id: 'main',
        user_message: '你好',
        intent: '',
        rationale: null,
        conclusion: '结论',
        planned_ref: null,
        alignment: 'unplanned',
        goal_distance: 0.2,
        status: 'done',
        event_ids: ['e1'],
        source_message_ids: ['m1'],
        step_count: 0,
        user_kind: 'instruction',
        assistant_actions: [],
        user_message_count: 1,
        exchanges: [],
        ts_start: 1,
        ts_end: 2,
      }]),
    }))
    expect(loaded?.nodes).toHaveLength(1)
    expect(loaded?.rawEvents).toHaveLength(1)
  })
})
