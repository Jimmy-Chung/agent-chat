'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import type { Topic } from '@agent-chat/protocol'
import { getWsClient } from '@/lib/ws-client'
import { useMessageStore } from './message-store'

const ACTIVE_TOPIC_STORAGE_KEY = 'AGENT_CHAT_ACTIVE_TOPIC_ID'

interface TopicState {
  topics: Topic[]
  activeTopicId: string | null
  loading: boolean
}

interface TopicActions {
  fetchTopics: () => Promise<void>
  selectTopic: (id: string) => void
  createTopic: (name: string, agentType: Topic['agent_type']) => void
  deleteTopic: (id: string) => void
  renameTopic: (id: string, name: string) => void
  setTopics: (topics: Topic[]) => void
  upsertTopic: (topic: Topic) => void
  removeTopic: (id: string) => void
}

const requestTopicData = (topicId: string) => {
  const client = getWsClient()
  client.send({ type: 'topic.select', data: { topicId } })
  client.send({ type: 'messages.load', data: { topicId } })
}

export const useTopicStore = create<TopicState & TopicActions>()(
  persist(
    immer((set, get) => ({
      topics: [],
      activeTopicId: null,
      loading: false,

      fetchTopics: async () => {
        set((s) => {
          s.loading = true
        })
        set((s) => {
          s.loading = false
        })
      },

      selectTopic: (id) => {
        set((s) => {
          s.activeTopicId = id
        })
        useMessageStore.getState().clearUnread(id)
        requestTopicData(id)
      },

      createTopic: (_name, _agentType) => {
        // Dispatched via WS client — placeholder for store-level logic
      },

      deleteTopic: (_id) => {
        // Dispatched via WS client — placeholder for store-level logic
      },

      renameTopic: (id, name) => {
        getWsClient().send({ type: 'topic.rename', data: { id, name } })
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
          if (idx >= 0) {
            s.topics[idx] = topic
          } else {
            s.topics.push(topic)
          }
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
      name: ACTIVE_TOPIC_STORAGE_KEY,
      partialize: (state) => ({ activeTopicId: state.activeTopicId }),
    },
  ),
)
