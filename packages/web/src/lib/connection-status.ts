import type { ConnectionStatus } from '@/stores/ws-store'

export interface AdapterLinkState {
  reachable: boolean | null
  lastError?: string
  checkedAt: number | null
  version?: string | null
}

export type BadgeTone = 'ok' | 'warning' | 'danger' | 'neutral'

export interface PiBadgeState {
  tone: BadgeTone
  pulse: boolean
  label: string
}

export function resolvePiBadgeState(
  wsStatus: ConnectionStatus,
  adapterLink: AdapterLinkState,
): PiBadgeState {
  if (wsStatus === 'connecting') {
    return { tone: 'warning', pulse: true, label: '连接中...' }
  }

  if (wsStatus !== 'connected') {
    return { tone: 'danger', pulse: false, label: '未连接服务' }
  }

  if (adapterLink.reachable === null) {
    return { tone: 'warning', pulse: true, label: '检查 Agent...' }
  }

  if (adapterLink.reachable === false) {
    return { tone: 'danger', pulse: false, label: 'Agent 服务不可达' }
  }

  return { tone: 'ok', pulse: false, label: '已连接' }
}

export function resolveTopicSessionDotState(
  sessionState: string | undefined,
): 'healthy' | 'unhealthy' | 'hidden' {
  if (!sessionState) return 'hidden'
  if (sessionState === 'connected') return 'healthy'
  if (sessionState === 'reconnecting' || sessionState === 'disconnected') return 'unhealthy'
  return 'hidden'
}
