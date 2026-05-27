import { describe, expect, it } from 'vitest'
import { rawTopicToTopic } from '@/lib/ws-client'

describe('ws-client topic mapping', () => {
  it('preserves programming spec for created programming topics', () => {
    const topic = rawTopicToTopic({
      id: 't1',
      name: 'Codex topic',
      kind: 'normal',
      agent_type: 'programming',
      pi_session_id: 'sess-1',
      programming_spec_json: JSON.stringify({
        extension: 'codex',
        yolo: false,
        cwd: '/tmp/codex',
        permissionMode: 'default',
      }),
      general_spec_json: null,
      current_model: null,
      history_frozen_at: null,
      plan_mode: false,
      created_at: 1,
      updated_at: 1,
      archived: false,
    })

    expect(topic.programming_spec_json).toContain('"extension":"codex"')
  })
})
