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
  endStreaming: (messageId: string) => void
}

export const useMessageStore = create<MessageState & MessageActions>()(
  immer((set) => ({
    byTopic: {},
    partsByMessage: {},
    loading: false,
    streamingText: {},
    streamingMessageId: null,

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

    endStreaming: (messageId) => {
      set((s) => {
        if (s.streamingMessageId === messageId) {
          s.streamingMessageId = null
        }
        delete s.streamingText[messageId]
      })
    },
  })),
)
