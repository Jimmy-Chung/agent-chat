import { eq } from 'drizzle-orm'
import { getDb } from '../migrate'
import { pushSubscriptions } from '../schema'
import { ulid } from '../../lib/ulid'

export interface PushSub {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  created_at: number
}

export async function upsertSubscription(
  endpoint: string,
  p256dh: string,
  auth: string,
): Promise<PushSub> {
  const db = getDb()
  const existing = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint))
    .get()

  if (existing) {
    await db
      .update(pushSubscriptions)
      .set({ p256dh, auth })
      .where(eq(pushSubscriptions.endpoint, endpoint))
    return { id: existing.id, endpoint, p256dh, auth, created_at: existing.createdAt }
  }

  const id = ulid()
  const now = Date.now()
  await db.insert(pushSubscriptions).values({ id, endpoint, p256dh, auth, createdAt: now })
  return { id, endpoint, p256dh, auth, created_at: now }
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  const db = getDb()
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint))
}

export async function listSubscriptions(): Promise<PushSub[]> {
  const db = getDb()
  const rows = await db.select().from(pushSubscriptions).all()
  return rows.map((r) => ({
    id: r.id,
    endpoint: r.endpoint,
    p256dh: r.p256dh,
    auth: r.auth,
    created_at: r.createdAt,
  }))
}
