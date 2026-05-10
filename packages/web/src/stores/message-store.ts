'use client'

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Message, MessagePart } from '@agent-chat/protocol'

interface MessageState {
  byTopic: Record<string, Message[]>
  partsByMessage: Record<string, MessagePart[]>
  loading: boolean
  streamingText: Record<string, string>
  streamingMessageId: string | null
  todosByTopic: Record<string, Array<{ id: string; content: string; status: string; activeForm?: string }>>
  planByTopic: Record<string, string>
  agentStatusByTopic: Record<string, string>
  usageByMessage: Record<string, { model: string; inputTokens: number; outputTokens: number }>
  interactions: Record<string, { interactionId: string; messageId: string; topicId: string; interactionKind: string; prompt: string; options?: string[] }>
}

interface MessageActions {
  fetchMessages: (topicId: string) => void
  addMessage: (topicId: string, msg: Message) => void
  updateMessage: (messageId: string, updates: Partial<Message>) => void
  appendPart: (messageId: string, part: MessagePart) => void
  setMessages: (topicId: string, messages: Message[]) => void
  removeMessagesByTopic: (topicId: string) => void
  startStreaming: (messageId: string) => void
  appendDelta: (messageId: string, text: string) => void
  setStreamingText: (messageId: string, text: string) => void
  endStreaming: (messageId: string) => void
  setTodos: (topicId: string, items: Array<{ id: string; content: string; status: string; activeForm?: string }>) => void
  setPlan: (topicId: string, plan: string) => void
  setAgentStatus: (topicId: string, state: string) => void
  setUsage: (messageId: string, data: { model: string; inputTokens: number; outputTokens: number }) => void
  setInteraction: (id: string, data: { interactionId: string; messageId: string; topicId: string; interactionKind: string; prompt: string; options?: string[] }) => void
}

export const useMessageStore = create<MessageState & MessageActions>()(
  immer((set) => ({
    byTopic: {},
    partsByMessage: {},
    loading: false,
    streamingText: {},
    streamingMessageId: null,
    todosByTopic: {},
    planByTopic: {},
    agentStatusByTopic: {},
    usageByMessage: {},
    interactions: {},

    fetchMessages: (_topicId) => {
      // Loading is done via WS; placeholder for store-level logic
    },

    addMessage: (topicId, msg) => {
      set((s) => {
        if (!s.byTopic[topicId]) {
          s.byTopic[topicId] = []
        }
        s.byTopic[topicId].push(msg)
      })
    },

    updateMessage: (messageId, updates) => {
      set((s) => {
        for (const topicMessages of Object.values(s.byTopic)) {
          const idx = topicMessages.findIndex((m) => m.id === messageId)
          if (idx >= 0) {
            Object.assign(topicMessages[idx], updates)
            break
          }
        }
      })
    },

    appendPart: (messageId, part) => {
      set((s) => {
        if (!s.partsByMessage[messageId]) {
          s.partsByMessage[messageId] = []
        }
        s.partsByMessage[messageId].push(part)
      })
    },

    setMessages: (topicId, messages) => {
      set((s) => {
        s.byTopic[topicId] = messages
      })
    },

    removeMessagesByTopic: (topicId) => {
      set((s) => {
        delete s.byTopic[topicId]
      })
    },

    startStreaming: (messageId) => {
      set((s) => {
        s.streamingMessageId = messageId
        if (!s.streamingText[messageId]) {
          s.streamingText[messageId] = ''
        }
      })
    },

    appendDelta: (messageId, text) => {
      set((s) => {
        const prev = s.streamingText[messageId] ?? ''
        s.streamingText[messageId] = prev + text
      })
    },

    setStreamingText: (messageId, text) => {
      set((s) => {
        s.streamingText[messageId] = text
      })
    },

    endStreaming: (messageId) => {
      set((s) => {
        if (s.streamingMessageId === messageId) {
          s.streamingMessageId = null
        }
        delete s.streamingText[messageId]
      })
    },

    setTodos: (topicId, items) => {
      set((s) => {
        s.todosByTopic[topicId] = items
      })
    },

    setPlan: (topicId, plan) => {
      set((s) => {
        s.planByTopic[topicId] = plan
      })
    },

    setAgentStatus: (topicId, state) => {
      set((s) => {
        s.agentStatusByTopic[topicId] = state
      })
    },

    setUsage: (messageId, data) => {
      set((s) => {
        s.usageByMessage[messageId] = data
      })
    },

    setInteraction: (id, data) => {
      set((s) => {
        s.interactions[id] = data
      })
    },
  })),
)
