'use client'

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Message, MessagePart } from '@agent-chat/protocol'

export interface StoredInteraction {
  interactionId: string
  messageId: string
  topicId: string
  interactionKind: string
  prompt: string
  options?: string[]
  status?: 'pending' | 'resolved' | 'timeout'
  response?: string
  defaultTimeoutMs?: number
}

export interface PendingMessage {
  id: string
  content: string
  clientMessageId: string
  queuedAt: number
}

interface MessageState {
  byTopic: Record<string, Message[]>
  partsByMessage: Record<string, MessagePart[]>
  loading: boolean
  streamingText: Record<string, string>
  streamingThinking: Record<string, string>
  streamingToolInputs: Record<string, Record<string, string>>
  streamingTopicId: string | null
  streamingMessageId: string | null
  todosByTopic: Record<string, Array<{ id: string; content: string; status: string; activeForm?: string }>>
  planByTopic: Record<string, string>
  agentStatusByTopic: Record<string, string>
  agentPhaseByTopic: Record<string, string | undefined>
  progressByTopic: Record<string, { phase: string; message: string; metadata?: Record<string, unknown> }>
  usageByMessage: Record<string, { model: string; inputTokens: number; outputTokens: number }>
  interactions: Record<string, StoredInteraction>
  pendingMessagesByTopic: Record<string, PendingMessage[]>
}

interface MessageActions {
  fetchMessages: (topicId: string) => void
  addMessage: (topicId: string, msg: Message) => void
  updateMessage: (messageId: string, updates: Partial<Message>) => void
  removeMessage: (messageId: string) => void
  appendPart: (messageId: string, part: MessagePart) => void
  upsertSnapshotPart: (messageId: string, kind: MessagePart['kind'], contentJson: string, stableId: string) => void
  getPartContent: (messageId: string, kind: MessagePart['kind']) => string
  setMessages: (topicId: string, messages: Message[]) => void
  reconcileAgentStatusFromMessages: (topicId: string) => void
  removeMessagesByTopic: (topicId: string) => void
  startStreaming: (topicId: string, messageId: string) => void
  appendDelta: (messageId: string, text: string) => void
  appendThinkingDelta: (messageId: string, text: string) => void
  appendToolInputDelta: (messageId: string, toolUseId: string, text: string) => void
  setStreamingText: (messageId: string, text: string) => void
  setStreamingThinking: (messageId: string, text: string) => void
  endStreaming: (messageId: string) => void
  setTodos: (topicId: string, items: Array<{ id: string; content: string; status: string; activeForm?: string }>) => void
  setPlan: (topicId: string, plan: string) => void
  setAgentStatus: (topicId: string, state: string, phase?: string) => void
  setProgress: (topicId: string, progress: { phase: string; message: string; metadata?: Record<string, unknown> }) => void
  clearProgress: (topicId: string) => void
  setUsage: (messageId: string, data: { model: string; inputTokens: number; outputTokens: number }) => void
  setInteraction: (id: string, data: StoredInteraction) => void
  setInteractionsForTopic: (topicId: string, interactions: StoredInteraction[]) => void
  addPendingMessage: (topicId: string, content: string, clientMessageId: string) => void
  removePendingMessage: (topicId: string, id: string) => void
  clearPendingMessages: (topicId: string) => void
  flushPendingMessages: (topicId: string) => PendingMessage[]
}

export const useMessageStore = create<MessageState & MessageActions>()(
  immer((set, get) => ({
    byTopic: {},
    partsByMessage: {},
    loading: false,
    streamingText: {},
    streamingThinking: {},
    streamingToolInputs: {},
    streamingTopicId: null,
    streamingMessageId: null,
    todosByTopic: {},
    planByTopic: {},
    agentStatusByTopic: {},
    agentPhaseByTopic: {},
    progressByTopic: {},
    usageByMessage: {},
    interactions: {},
    pendingMessagesByTopic: {},

    fetchMessages: (_topicId) => {
      // Loading is done via WS; placeholder for store-level logic
    },

    addMessage: (topicId, msg) => {
      set((s) => {
        if (!s.byTopic[topicId]) {
          s.byTopic[topicId] = []
        }
        const exists = s.byTopic[topicId].some((message) => message.id === msg.id)
        if (!exists) {
          s.byTopic[topicId].push(msg)
        }
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

    removeMessage: (messageId) => {
      set((s) => {
        for (const [topicId, topicMessages] of Object.entries(s.byTopic)) {
          const nextMessages = topicMessages.filter((m) => m.id !== messageId)
          if (nextMessages.length !== topicMessages.length) {
            s.byTopic[topicId] = nextMessages
            break
          }
        }
        delete s.partsByMessage[messageId]
        delete s.streamingText[messageId]
        delete s.streamingThinking[messageId]
        delete s.streamingToolInputs[messageId]
        delete s.usageByMessage[messageId]
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

    upsertSnapshotPart: (messageId, kind, contentJson, stableId) => {
      set((s) => {
        if (!s.partsByMessage[messageId]) {
          s.partsByMessage[messageId] = []
        }

        const parts = s.partsByMessage[messageId]
        const existingIndex = parts.findIndex(
          (part) => part.id === stableId || part.kind === kind,
        )

        if (existingIndex >= 0) {
          parts[existingIndex].id = stableId
          parts[existingIndex].kind = kind
          parts[existingIndex].content_json = contentJson
        } else {
          parts.push({
            id: stableId,
            message_id: messageId,
            ordinal: parts.length,
            kind,
            content_json: contentJson,
          })
        }
      })
    },

    getPartContent: (messageId, kind) => {
      const state = get()
      const part = state.partsByMessage[messageId]?.find((entry: MessagePart) => entry.kind === kind)
      if (!part) return ''
      try {
        const parsed = JSON.parse(part.content_json) as { content?: string } | string
        return typeof parsed === 'string' ? parsed : parsed.content ?? ''
      } catch {
        return ''
      }
    },

    setMessages: (topicId, messages) => {
      set((s) => {
        const previousMessageIds = new Set((s.byTopic[topicId] ?? []).map((m) => m.id))
        const nextMessageIds = new Set(messages.map((m) => m.id))
        s.byTopic[topicId] = messages

        for (const messageId of previousMessageIds) {
          if (nextMessageIds.has(messageId)) continue
          delete s.partsByMessage[messageId]
          delete s.streamingText[messageId]
          delete s.streamingThinking[messageId]
          delete s.streamingToolInputs[messageId]
          delete s.usageByMessage[messageId]
        }
      })
    },

    reconcileAgentStatusFromMessages: (topicId) => {
      set((s) => {
        const hasActiveMessages = (s.byTopic[topicId] ?? []).some((m) =>
          m.status === 'streaming'
          || m.status === 'pending'
          || m.status === 'retrying'
          || m.status === 'needs_retry',
        )
        if (hasActiveMessages) return

        s.agentStatusByTopic[topicId] = 'idle'
        delete s.agentPhaseByTopic[topicId]
        delete s.progressByTopic[topicId]
      })
    },

    removeMessagesByTopic: (topicId) => {
      set((s) => {
        const messageIds = (s.byTopic[topicId] ?? []).map((message) => message.id)
        delete s.byTopic[topicId]
        delete s.pendingMessagesByTopic[topicId]
        for (const messageId of messageIds) {
          delete s.partsByMessage[messageId]
          delete s.streamingText[messageId]
          delete s.streamingThinking[messageId]
          delete s.streamingToolInputs[messageId]
          delete s.usageByMessage[messageId]
        }
      })
    },

    startStreaming: (topicId, messageId) => {
      set((s) => {
        s.streamingTopicId = topicId
        s.streamingMessageId = messageId
        if (s.streamingText[messageId] === undefined) {
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

    appendThinkingDelta: (messageId, text) => {
      set((s) => {
        const prev = s.streamingThinking[messageId] ?? ''
        s.streamingThinking[messageId] = prev + text
      })
    },

    appendToolInputDelta: (messageId, toolUseId, text) => {
      set((s) => {
        if (!s.streamingToolInputs[messageId]) {
          s.streamingToolInputs[messageId] = {}
        }
        const prev = s.streamingToolInputs[messageId][toolUseId] ?? ''
        s.streamingToolInputs[messageId][toolUseId] = prev + text
      })
    },

    setStreamingText: (messageId, text) => {
      set((s) => {
        s.streamingText[messageId] = text
      })
    },

    setStreamingThinking: (messageId, text) => {
      set((s) => {
        s.streamingThinking[messageId] = text
      })
    },

    endStreaming: (messageId) => {
      set((s) => {
        if (s.streamingMessageId === messageId) {
          s.streamingTopicId = null
          s.streamingMessageId = null
        }
        delete s.streamingText[messageId]
        delete s.streamingThinking[messageId]
        delete s.streamingToolInputs[messageId]
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

    setAgentStatus: (topicId, state, phase) => {
      set((s) => {
        s.agentStatusByTopic[topicId] = state
        if (state === 'idle') {
          delete s.agentPhaseByTopic[topicId]
        } else {
          s.agentPhaseByTopic[topicId] = phase
        }
      })
    },

    setProgress: (topicId, progress) => {
      set((s) => {
        s.progressByTopic[topicId] = progress
      })
    },

    clearProgress: (topicId) => {
      set((s) => {
        delete s.progressByTopic[topicId]
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

    setInteractionsForTopic: (topicId, interactions) => {
      set((s) => {
        for (const [id, interaction] of Object.entries(s.interactions)) {
          if (interaction.topicId === topicId) delete s.interactions[id]
        }
        for (const interaction of interactions) {
          s.interactions[interaction.interactionId] = interaction
        }
      })
    },

    addPendingMessage: (topicId, content, clientMessageId) => {
      set((s) => {
        if (!s.pendingMessagesByTopic[topicId]) {
          s.pendingMessagesByTopic[topicId] = []
        }
        s.pendingMessagesByTopic[topicId].push({
          id: `pm-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          content,
          clientMessageId,
          queuedAt: Date.now(),
        })
      })
    },

    removePendingMessage: (topicId, id) => {
      set((s) => {
        if (s.pendingMessagesByTopic[topicId]) {
          s.pendingMessagesByTopic[topicId] = s.pendingMessagesByTopic[topicId].filter((pm) => pm.id !== id)
          if (s.pendingMessagesByTopic[topicId].length === 0) {
            delete s.pendingMessagesByTopic[topicId]
          }
        }
      })
    },

    clearPendingMessages: (topicId) => {
      set((s) => {
        delete s.pendingMessagesByTopic[topicId]
      })
    },

    flushPendingMessages: (topicId): PendingMessage[] => {
      const pending = get().pendingMessagesByTopic[topicId] ?? []
      if (pending.length > 0) {
        set((s) => {
          delete s.pendingMessagesByTopic[topicId]
        })
      }
      return pending
    },
  })),
)
