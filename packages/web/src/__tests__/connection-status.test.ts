import { describe, expect, it } from 'vitest'
import { resolvePiBadgeState, resolveTopicSessionDotState } from '../lib/connection-status'

describe('connection status helpers', () => {
  it('shows disconnected when ws is down regardless of adapter state', () => {
    expect(resolvePiBadgeState('disconnected', {
      reachable: true,
      checkedAt: Date.now(),
    })).toEqual({
      tone: 'danger',
      pulse: false,
      label: '未连接服务',
    })
  })

  it('shows adapter unreachable when worker is connected but adapter probe failed', () => {
    expect(resolvePiBadgeState('connected', {
      reachable: false,
      checkedAt: Date.now(),
      lastError: 'HTTP 502',
    })).toEqual({
      tone: 'danger',
      pulse: false,
      label: 'Agent 服务不可达',
    })
  })

  it('shows connected only when both worker and adapter are reachable', () => {
    expect(resolvePiBadgeState('connected', {
      reachable: true,
      checkedAt: Date.now(),
      version: '1.2.3',
    })).toEqual({
      tone: 'ok',
      pulse: false,
      label: '已连接',
    })
  })

  it('maps topic session dot states', () => {
    expect(resolveTopicSessionDotState('connected')).toBe('healthy')
    expect(resolveTopicSessionDotState('reconnecting')).toBe('unhealthy')
    expect(resolveTopicSessionDotState('disconnected')).toBe('unhealthy')
    expect(resolveTopicSessionDotState(undefined)).toBe('hidden')
  })
})
