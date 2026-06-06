import { describe, expect, it } from 'vitest'
import type { Message, MessagePart } from '@agent-chat/protocol'
import { resolveGoalAnchor } from '../lib/attention/use-attention-trace'

function makeMessage(id: string, startedAt: number): Message {
  return {
    id,
    topic_id: 'topic-1',
    role: 'user',
    status: 'done',
    started_at: startedAt,
    finished_at: startedAt + 1,
    stop_reason: null,
    cron_run_id: null,
    turn_id: null,
    client_message_id: null,
    retry_count: 0,
    max_retries: 2,
  }
}

function textPart(messageId: string, content: string): MessagePart {
  return {
    id: `${messageId}:text`,
    message_id: messageId,
    ordinal: 0,
    kind: 'text',
    content_json: JSON.stringify({ content }),
  }
}

describe('resolveGoalAnchor', () => {
  it('prefers explicit topic attention target over the first user message', () => {
    const anchor = resolveGoalAnchor({
      explicitTarget: '这个话题是为了注册平台',
      explicitUpdatedAt: 1234,
      messages: [makeMessage('m1', 1000)],
      partsByMessage: {
        m1: [textPart('m1', '第一句只是背景')],
      },
    })

    expect(anchor).toEqual({
      raw_query: '这个话题是为了注册平台',
      normalized_goal: '这个话题是为了注册平台',
      ts: 1234,
    })
  })

  it('falls back to the first user message when no explicit target exists', () => {
    const anchor = resolveGoalAnchor({
      explicitTarget: null,
      explicitUpdatedAt: null,
      messages: [
        makeMessage('m1', 1000),
        makeMessage('m2', 2000),
      ],
      partsByMessage: {
        m1: [textPart('m1', '如何注册平台')],
        m2: [textPart('m2', '继续讨论')],
      },
    })

    expect(anchor).toEqual({
      raw_query: '如何注册平台',
      normalized_goal: '如何注册平台',
      ts: 1000,
    })
  })
})
