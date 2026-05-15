'use client'

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { ClientEvent } from '@agent-chat/protocol'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

interface WsState {
  status: ConnectionStatus
  lastSeq: number | null
  sessionHealthByTopic: Record<string, { state: string; lastError?: string }>
  unauthorized: boolean
}

interface WsActions {
  connect: () => void
  disconnect: () => void
  sendEvent: (event: ClientEvent) => void
  setStatus: (status: ConnectionStatus) => void
  setLastSeq: (seq: number) => void
  setSessionHealth: (topicId: string, state: string, lastError?: string) => void
  setUnauthorized: () => void
}

export const useWsStore = create<WsState & WsActions>()(
  immer((set) => ({
    status: 'disconnected' as ConnectionStatus,
    lastSeq: null,
    sessionHealthByTopic: {},
    unauthorized: false,

    connect: () => {
      // Actual connection is managed by ws-client; this updates state
      set((s) => {
        s.status = 'connecting'
      })
    },

    disconnect: () => {
      set((s) => {
        s.status = 'disconnected'
      })
    },

    sendEvent: (_event: ClientEvent) => {
      // Actual send is done via ws-client instance; placeholder
    },

    setStatus: (status) => {
      set((s) => {
        s.status = status
      })
    },

    setLastSeq: (seq) => {
      set((s) => {
        s.lastSeq = seq
      })
    },

    setSessionHealth: (topicId, state, lastError) => {
      set((s) => {
        s.sessionHealthByTopic[topicId] = { state, lastError }
      })
    },

    setUnauthorized: () => {
      set((s) => {
        s.unauthorized = true
        s.status = 'disconnected'
      })
    },
  })),
)
