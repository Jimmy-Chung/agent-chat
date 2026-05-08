import { describe, it, expect, beforeEach } from 'vitest'
import { useTopicStore } from '../stores/topic-store'
import type { Topic } from '@agent-chat/protocol'

function makeTopic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: 't1',
    name: 'Test Topic',
    kind: 'normal',
    agent_type: 'general',
    pi_session_id: null,
    programming_spec_json: null,
    general_spec_json: null,
    sop_template_id: null,
    current_model: null,
    history_frozen_at: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    archived: false,
    ...overrides,
  }
}

describe('TopicStore', () => {
  beforeEach(() => {
    useTopicStore.setState({
      topics: [],
      activeTopicId: null,
      loading: false,
    })
  })

  it('should have correct initial state', () => {
    const state = useTopicStore.getState()
    expect(state.topics).toEqual([])
    expect(state.activeTopicId).toBeNull()
    expect(state.loading).toBe(false)
  })

  it('selectTopic sets activeTopicId', () => {
    useTopicStore.getState().selectTopic('abc-123')
    expect(useTopicStore.getState().activeTopicId).toBe('abc-123')
  })

  it('setTopics replaces the topics array', () => {
    const topics = [makeTopic({ id: 't1' }), makeTopic({ id: 't2' })]
    useTopicStore.getState().setTopics(topics)
    expect(useTopicStore.getState().topics).toEqual(topics)
  })

  it('upsertTopic adds a new topic', () => {
    const topic = makeTopic({ id: 't1' })
    useTopicStore.getState().upsertTopic(topic)
    expect(useTopicStore.getState().topics).toHaveLength(1)
    expect(useTopicStore.getState().topics[0]).toEqual(topic)
  })

  it('upsertTopic updates an existing topic by id', () => {
    useTopicStore.getState().upsertTopic(makeTopic({ id: 't1', name: 'Old' }))
    useTopicStore.getState().upsertTopic(makeTopic({ id: 't1', name: 'New' }))

    const { topics } = useTopicStore.getState()
    expect(topics).toHaveLength(1)
    expect(topics[0].name).toBe('New')
  })

  it('removeTopic removes a topic from the array', () => {
    useTopicStore.getState().setTopics([
      makeTopic({ id: 't1' }),
      makeTopic({ id: 't2' }),
    ])
    useTopicStore.getState().removeTopic('t1')
    expect(useTopicStore.getState().topics).toHaveLength(1)
    expect(useTopicStore.getState().topics[0].id).toBe('t2')
  })

  it('removeTopic clears activeTopicId when removing the active topic', () => {
    useTopicStore.getState().setTopics([makeTopic({ id: 't1' })])
    useTopicStore.getState().selectTopic('t1')
    expect(useTopicStore.getState().activeTopicId).toBe('t1')

    useTopicStore.getState().removeTopic('t1')
    expect(useTopicStore.getState().activeTopicId).toBeNull()
  })

  it('removeTopic does not clear activeTopicId when removing a different topic', () => {
    useTopicStore.getState().setTopics([
      makeTopic({ id: 't1' }),
      makeTopic({ id: 't2' }),
    ])
    useTopicStore.getState().selectTopic('t1')
    useTopicStore.getState().removeTopic('t2')
    expect(useTopicStore.getState().activeTopicId).toBe('t1')
  })
})
