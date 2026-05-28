import { describe, expect, it } from 'vitest'
import { errorDetail } from '../error-detail'

describe('errorDetail', () => {
  it('preserves Error name, code, and message', () => {
    const err = new Error('boom') as Error & { code?: string }
    err.code = 'E_BOOM'

    expect(errorDetail(err)).toMatchObject({
      code: 'E_BOOM',
      name: 'Error',
      message: 'boom',
    })
  })

  it('extracts nested RPC error payloads', () => {
    expect(errorDetail({ error: { code: 'auth_invalid', message: 'bad token' } }))
      .toMatchObject({
        code: 'auth_invalid',
        message: 'bad token',
      })
  })

  it('stringifies object messages instead of returning [object Object]', () => {
    expect(errorDetail({ code: 'internal', message: { reason: 'missing token' } }))
      .toMatchObject({
        code: 'internal',
        message: '{"reason":"missing token"}',
      })
  })
})
