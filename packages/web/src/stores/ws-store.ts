'use client'

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { ClientEvent } from '@agent-chat/protocol'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

/** claude-code 别名 → 真实模型映射（AIT-201 / 契约 AIT-200）。 */
export interface ModelMapping {
  opus?: string
  sonnet?: string
  haiku?: string
}

export const MODEL_ALIASES = ['opus', 'sonnet', 'haiku'] as const
export type ModelAlias = (typeof MODEL_ALIASES)[number]

export interface ProviderConfig {
  id: string
  name: string
  provider: string
  apiKey?: string
  baseUrl?: string
  models?: string[]
  /** 别名→真实模型；仅 claude-code 第三方 provider 配了 ANTHROPIC_DEFAULT_*_MODEL 时返回。 */
  modelMapping?: ModelMapping
  isActive?: boolean
  isDefault?: boolean
  /** 内置默认 provider，不可编辑/删除。 */
  builtin?: boolean
  group?: string
}

export interface AdapterLinkState {
  reachable: boolean | null
  lastError?: string
  checkedAt: number | null
  version?: string | null
}

interface WsState {
  status: ConnectionStatus
  lastSeq: number | null
  sessionHealthByTopic: Record<string, { state: string; lastError?: string }>
  sessionReadyByTopic: Record<string, boolean>
  adapterLink: AdapterLinkState
  unauthorized: boolean
  providerConfigs: ProviderConfig[]
  providerConfigsLoading: boolean
  workspacePath: string | null
}

interface WsActions {
  connect: () => void
  disconnect: () => void
  sendEvent: (event: ClientEvent) => void
  setStatus: (status: ConnectionStatus) => void
  setLastSeq: (seq: number) => void
  setSessionHealth: (topicId: string, state: string, lastError?: string) => void
  setSessionReady: (topicId: string, ready: boolean) => void
  setAdapterLink: (next: AdapterLinkState) => void
  setUnauthorized: () => void
  setProviderConfigs: (configs: ProviderConfig[]) => void
  setProviderConfigsLoading: (loading: boolean) => void
  setWorkspacePath: (path: string | null) => void
}

export const useWsStore = create<WsState & WsActions>()(
  immer((set) => ({
    status: 'disconnected' as ConnectionStatus,
    lastSeq: null,
    sessionHealthByTopic: {},
    sessionReadyByTopic: {},
    adapterLink: { reachable: null, checkedAt: null, version: null },
    unauthorized: false,
    providerConfigs: [],
    providerConfigsLoading: false,
    workspacePath: null,

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

    setAdapterLink: (next) => {
      set((s) => {
        s.adapterLink = next
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

    setWorkspacePath: (path) => {
      set((s) => {
        s.workspacePath = path
      })
    },
  })),
)
