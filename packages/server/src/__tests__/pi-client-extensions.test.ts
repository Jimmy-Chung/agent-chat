import { describe, expect, it } from 'vitest'
import { PiRpcError } from '../pi/client'

describe('PiRpcError', () => {
  it('preserves error code', () => {
    const err = new PiRpcError('session_not_found', 'Session does not exist')
    expect(err.code).toBe('session_not_found')
    expect(err.message).toBe('RPC error: session_not_found - Session does not exist')
    expect(err.name).toBe('PiRpcError')
  })

  it('is instanceof Error', () => {
    const err = new PiRpcError('session_busy', 'Session is busy')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(PiRpcError)
  })

  it('can be distinguished from generic errors', () => {
    const rpcErr = new PiRpcError('internal', 'Something broke')
    const genericErr = new Error('Something broke')

    expect(rpcErr instanceof PiRpcError).toBe(true)
    expect(genericErr instanceof PiRpcError).toBe(false)
  })

  it('matches session_not_found for recreate branching', () => {
    const err = new PiRpcError('session_not_found', 'gone')
    expect(err.code).toBe('session_not_found')
    if (err instanceof PiRpcError && err.code === 'session_not_found') {
      // This is the branching logic used in message-delivery
      expect(true).toBe(true)
    } else {
      expect.unreachable('should match session_not_found')
    }
  })

  it('matches session_busy for retry branching', () => {
    const err = new PiRpcError('session_busy', 'try later')
    expect(err.code).toBe('session_busy')
    if (err instanceof PiRpcError && err.code === 'session_busy') {
      expect(true).toBe(true)
    } else {
      expect.unreachable('should match session_busy')
    }
  })
})
