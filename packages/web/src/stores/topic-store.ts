'use client'

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Topic } from '@agent-chat/protocol'

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

export const useTopicStore = create<TopicState & TopicActions>()(
  immer((set) => ({
    topics: [],
    activeTopicId: null,
    loading: false,

    fetchTopics: async () => {
      set((s) => {
        s.loading = true
      })
      // Actual fetching is done via WS; this sets loading state
      set((s) => {
        s.loading = false
      })
    },

    selectTopic: (id) => {
      set((s) => {
        s.activeTopicId = id
      })
    },

    createTopic: (_name, _agentType) => {
      // Dispatched via WS client — placeholder for store-level logic
    },

    deleteTopic: (_id) => {
      // Dispatched via WS client — placeholder for store-level logic
    },

    renameTopic: (_id, _name) => {
      // Dispatched via WS client — placeholder for store-level logic
    },

    setTopics: (topics) => {
      set((s) => {
        s.topics = topics
      })
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
)
