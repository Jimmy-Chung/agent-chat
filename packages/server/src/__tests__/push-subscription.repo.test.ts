import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDb, teardownTestDb } from './db-helper'
import {
  upsertSubscription,
  deleteSubscription,
  listSubscriptions,
} from '../db/repos/push-subscription.repo'

beforeEach(async () => {
  await setupTestDb()
})

afterEach(() => {
  teardownTestDb()
})

const EP1 = 'https://push.example.com/sub/1'
const EP2 = 'https://push.example.com/sub/2'

describe('push-subscription.repo', () => {
  it('upserts a new subscription', async () => {
    const result = await upsertSubscription(EP1, 'P256_A', 'AUTH_A')
    expect(result.endpoint).toBe(EP1)
    expect(result.p256dh).toBe('P256_A')
    expect(result.auth).toBe('AUTH_A')
    expect(typeof result.id).toBe('string')
    expect(result.id.length).toBeGreaterThan(0)
  })

  it('lists all subscriptions', async () => {
    await upsertSubscription(EP1, 'P256_A', 'AUTH_A')
    await upsertSubscription(EP2, 'P256_B', 'AUTH_B')
    const subs = await listSubscriptions()
    expect(subs.length).toBe(2)
    expect(subs.find((s) => s.endpoint === EP1)).toBeTruthy()
    expect(subs.find((s) => s.endpoint === EP2)).toBeTruthy()
  })

  it('returns empty array when no subscriptions exist', async () => {
    const subs = await listSubscriptions()
    expect(subs).toHaveLength(0)
  })

  it('updates keys when endpoint already exists', async () => {
    await upsertSubscription(EP1, 'P256_OLD', 'AUTH_OLD')
    const updated = await upsertSubscription(EP1, 'P256_NEW', 'AUTH_NEW')
    expect(updated.p256dh).toBe('P256_NEW')
    expect(updated.auth).toBe('AUTH_NEW')

    const subs = await listSubscriptions()
    expect(subs).toHaveLength(1)
    expect(subs[0].p256dh).toBe('P256_NEW')
  })

  it('deletes a subscription by endpoint', async () => {
    await upsertSubscription(EP1, 'P256_A', 'AUTH_A')
    await upsertSubscription(EP2, 'P256_B', 'AUTH_B')
    await deleteSubscription(EP1)
    const subs = await listSubscriptions()
    expect(subs.find((s) => s.endpoint === EP1)).toBeUndefined()
    expect(subs.find((s) => s.endpoint === EP2)).toBeTruthy()
  })

  it('delete is idempotent for non-existent endpoint', async () => {
    await expect(deleteSubscription('https://non-existent.example.com')).resolves.not.toThrow()
  })
})
