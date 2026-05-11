import { describe, it, expect, beforeEach, vi } from 'vitest'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import type { Topic } from '@agent-chat/protocol'

const sendMock = vi.fn()

vi.mock('@/lib/ws-client', () => ({
  getWsClient: () => ({ send: sendMock }),
}))

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
    plan_mode: false,
    created_at: Date.now(),
    updated_at: Date.now(),
    archived: false,
    ...overrides,
  }
}

type TopicState = {
  topics: Topic[]
  activeTopicId: string | null
  loading: boolean
}

type TopicActions = {
  selectTopic: (id: string) => void
  setTopics: (topics: Topic[]) => void
  upsertTopic: (topic: Topic) => void
  removeTopic: (id: string) => void
}

function createTopicStore() {
  const requestTopicData = (topicId: string) => {
    sendMock({ type: 'messages.load', data: { topicId } })
    sendMock({ type: 'topic.resume', data: { topicId } })
    sendMock({ type: 'topic.select', data: { topicId } })
  }

  return create<TopicState & TopicActions>()(
    persist(
      immer((set, get) => ({
        topics: [],
        activeTopicId: null,
        loading: false,

        selectTopic: (id) => {
          set((s) => {
            s.activeTopicId = id
          })
          requestTopicData(id)
        },

        setTopics: (topics) => {
          const activeTopicId = get().activeTopicId
          const hasActiveTopic = activeTopicId
            ? topics.some((topic) => topic.id === activeTopicId)
            : false

          set((s) => {
            s.topics = topics
            if (s.activeTopicId && !hasActiveTopic) {
              s.activeTopicId = null
            }
          })

          if (hasActiveTopic && activeTopicId) {
            requestTopicData(activeTopicId)
          }
        },

        upsertTopic: (topic) => {
          set((s) => {
            const idx = s.topics.findIndex((t) => t.id === topic.id)
            if (idx >= 0) s.topics[idx] = topic
            else s.topics.push(topic)
          })
        },

        removeTopic: (id) => {
          set((s) => {
            s.topics = s.topics.filter((t) => t.id !== id)
            if (s.activeTopicId === id) {
              s.activeTopicId = null
            }
          })
        },
      })),
      {
        name: 'AGENT_CHAT_ACTIVE_TOPIC_ID',
        storage: {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        },
        partialize: (state) => ({ activeTopicId: state.activeTopicId }),
      },
    ),
  )
}

describe('TopicStore', () => {
  let useTopicStore: ReturnType<typeof createTopicStore>

  beforeEach(() => {
    sendMock.mockClear()
    useTopicStore = createTopicStore()
  })

  it('should have correct initial state', () => {
    const state = useTopicStore.getState()
    expect(state.topics).toEqual([])
    expect(state.activeTopicId).toBeNull()
    expect(state.loading).toBe(false)
  })

  it('selectTopic sets activeTopicId and requests topic data', () => {
    useTopicStore.getState().selectTopic('abc-123')
    expect(useTopicStore.getState().activeTopicId).toBe('abc-123')
    expect(sendMock).toHaveBeenCalledWith({ type: 'messages.load', data: { topicId: 'abc-123' } })
    expect(sendMock).toHaveBeenCalledWith({ type: 'topic.resume', data: { topicId: 'abc-123' } })
    expect(sendMock).toHaveBeenCalledWith({ type: 'topic.select', data: { topicId: 'abc-123' } })
  })

  it('setTopics replaces the topics array', () => {
    const topics = [makeTopic({ id: 't1' }), makeTopic({ id: 't2' })]
    useTopicStore.getState().setTopics(topics)
    expect(useTopicStore.getState().topics).toEqual(topics)
  })

  it('setTopics reloads the active topic when it still exists', () => {
    useTopicStore.setState({ activeTopicId: 't2', topics: [], loading: false })
    const topics = [makeTopic({ id: 't1' }), makeTopic({ id: 't2' })]

    useTopicStore.getState().setTopics(topics)

    expect(useTopicStore.getState().activeTopicId).toBe('t2')
    expect(sendMock).toHaveBeenCalledWith({ type: 'messages.load', data: { topicId: 't2' } })
    expect(sendMock).toHaveBeenCalledWith({ type: 'topic.resume', data: { topicId: 't2' } })
    expect(sendMock).toHaveBeenCalledWith({ type: 'topic.select', data: { topicId: 't2' } })
  })

  it('setTopics clears activeTopicId when restored topic no longer exists', () => {
    useTopicStore.setState({ activeTopicId: 'missing', topics: [], loading: false })
    useTopicStore.getState().setTopics([makeTopic({ id: 't1' })])

    expect(useTopicStore.getState().activeTopicId).toBeNull()
    expect(sendMock).not.toHaveBeenCalled()
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
    sendMock.mockClear()
    useTopicStore.getState().removeTopic('t1')
    expect(useTopicStore.getState().topics).toHaveLength(1)
    expect(useTopicStore.getState().topics[0].id).toBe('t2')
  })

  it('removeTopic clears activeTopicId when removing the active topic', () => {
    useTopicStore.getState().setTopics([makeTopic({ id: 't1' })])
    sendMock.mockClear()
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
    sendMock.mockClear()
    useTopicStore.getState().selectTopic('t1')
    sendMock.mockClear()
    useTopicStore.getState().removeTopic('t2')
    expect(useTopicStore.getState().activeTopicId).toBe('t1')
  })
})
