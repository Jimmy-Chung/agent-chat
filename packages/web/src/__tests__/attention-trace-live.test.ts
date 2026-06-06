import { describe, expect, it } from 'vitest'
import type { Message } from '@agent-chat/protocol'
import { hasActiveAttentionMessage } from '../lib/attention/use-attention-trace'

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
