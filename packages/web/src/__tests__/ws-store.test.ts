import { describe, it, expect, beforeEach } from 'vitest'
import { useWsStore } from '../stores/ws-store'
import type { ConnectionStatus } from '../stores/ws-store'

describe('WsStore', () => {
  beforeEach(() => {
    useWsStore.setState({ status: 'disconnected', lastSeq: null, sessionHealthByTopic: {} })
  })

  it('should have correct initial state', () => {
    const state = useWsStore.getState()
    expect(state.status).toBe('disconnected')
    expect(state.lastSeq).toBeNull()
    expect(state.sessionHealthByTopic).toEqual({})
  })

  it('connect sets status to connecting', () => {
    useWsStore.getState().connect()
    expect(useWsStore.getState().status).toBe('connecting')
  })

  it('disconnect sets status to disconnected', () => {
    useWsStore.getState().setStatus('connected')
    useWsStore.getState().disconnect()
    expect(useWsStore.getState().status).toBe('disconnected')
  })

  it('setStatus updates connection status', () => {
    const statuses: ConnectionStatus[] = [
      'connecting',
      'connected',
      'disconnected',
    ]
    for (const status of statuses) {
      useWsStore.getState().setStatus(status)
      expect(useWsStore.getState().status).toBe(status)
    }
  })

  it('setLastSeq updates seq number', () => {
    useWsStore.getState().setLastSeq(42)
    expect(useWsStore.getState().lastSeq).toBe(42)
    useWsStore.getState().setLastSeq(43)
    expect(useWsStore.getState().lastSeq).toBe(43)
  })

  it('setSessionHealth updates sessionHealthByTopic', () => {
    useWsStore.getState().setSessionHealth('topic1', 'connected')
    expect(useWsStore.getState().sessionHealthByTopic['topic1']).toEqual({ state: 'connected' })

    useWsStore.getState().setSessionHealth('topic2', 'disconnected', 'connection reset')
    expect(useWsStore.getState().sessionHealthByTopic['topic2']).toEqual({ state: 'disconnected', lastError: 'connection reset' })
  })
})
