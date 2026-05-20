'use client'

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { ClientEvent } from '@agent-chat/protocol'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export interface ProviderConfig {
  id: string
  name: string
  provider: string
  apiKey?: string
  baseUrl?: string
  models?: string[]
  isActive?: boolean
  isDefault?: boolean
  group?: string
}

interface WsState {
  status: ConnectionStatus
  lastSeq: number | null
  sessionHealthByTopic: Record<string, { state: string; lastError?: string }>
  sessionReadyByTopic: Record<string, boolean>
  unauthorized: boolean
  providerConfigs: ProviderConfig[]
  providerConfigsLoading: boolean
}

interface WsActions {
  connect: () => void
  disconnect: () => void
  sendEvent: (event: ClientEvent) => void
  setStatus: (status: ConnectionStatus) => void
  setLastSeq: (seq: number) => void
  setSessionHealth: (topicId: string, state: string, lastError?: string) => void
  setSessionReady: (topicId: string, ready: boolean) => void
  setUnauthorized: () => void
  setProviderConfigs: (configs: ProviderConfig[]) => void
  setProviderConfigsLoading: (loading: boolean) => void
}

export const useWsStore = create<WsState & WsActions>()(
  immer((set) => ({
    status: 'disconnected' as ConnectionStatus,
    lastSeq: null,
    sessionHealthByTopic: {},
    sessionReadyByTopic: {},
    unauthorized: false,
    providerConfigs: [],
    providerConfigsLoading: false,

    connect: () => {
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

    setSessionReady: (topicId, ready) => {
      set((s) => {
        s.sessionReadyByTopic[topicId] = ready
      })
    },

    setUnauthorized: () => {
      set((s) => {
        s.unauthorized = true
        s.status = 'disconnected'
      })
    },

    setProviderConfigs: (configs) => {
      set((s) => {
        s.providerConfigs = configs
      })
    },

    setProviderConfigsLoading: (loading) => {
      set((s) => {
        s.providerConfigsLoading = loading
      })
    },
  })),
)
