'use server'

import { eq } from 'drizzle-orm'

import { getCurrentActor } from './actor'
import { db } from './db'
import { pushSubscriptions } from './db/schema'
import { sendPushToAll } from './push'

/**
 * A browser `PushSubscription` serialized to JSON. Its `endpoint` is the stable
 * identity — the same device re-subscribing produces the same endpoint, so
 * upserting on it keeps one row per device rather than one per permission
 * prompt.
 */
type SerializedSubscription = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export async function subscribeToPush(
  subscription: SerializedSubscription,
  label?: string,
) {
  const actor = await getCurrentActor()

  await db
    .insert(pushSubscriptions)
    .values({
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userId: actor.id,
      label: label ?? null,
      active: true,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userId: actor.id,
        active: true,
        lastSeenAt: new Date(),
      },
    })

  return { ok: true as const }
}

export async function unsubscribeFromPush(endpoint: string) {
  await db
    .update(pushSubscriptions)
    .set({ active: false })
    .where(eq(pushSubscriptions.endpoint, endpoint))

  return { ok: true as const }
}

/** Fires a real push through the same path the scheduler uses. */
export async function sendTestPush() {
  const result = await sendPushToAll({
    title: 'Kaizr test',
    body: 'Notifications are working. This is what a prep alert looks like.',
    url: '/',
    tag: 'test',
  })

  if (result.delivered === 0) {
    return {
      ok: false as const,
      error:
        result.failed > 0
          ? 'No device accepted the notification'
          : 'No devices are subscribed yet',
    }
  }

  return { ok: true as const, delivered: result.delivered }
}
