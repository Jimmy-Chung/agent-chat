'use client'

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { ClientEvent } from '@agent-chat/protocol'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

interface WsState {
  status: ConnectionStatus
  lastSeq: number | null
}

interface WsActions {
  connect: () => void
  disconnect: () => void
  sendEvent: (event: ClientEvent) => void
  setStatus: (status: ConnectionStatus) => void
  setLastSeq: (seq: number) => void
}

export const useWsStore = create<WsState & WsActions>()(
  immer((set) => ({
    status: 'disconnected' as ConnectionStatus,
    lastSeq: null,

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
  })),
)
