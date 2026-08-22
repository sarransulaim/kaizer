import 'server-only'

import { eq, inArray } from 'drizzle-orm'
import webpush from 'web-push'

import { db } from './db'
import { notifications, pushSubscriptions } from './db/schema'

/**
 * Web push delivery.
 *
 * Subscriptions live in Postgres rather than memory so they survive restarts
 * and redeploys — a phone that subscribed last month must still get Saturday's
 * prep alert without the owner re-enabling anything.
 */

let configured = false

function configure(): boolean {
  if (configured) return true

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com'

  if (!publicKey || !privateKey) return false

  webpush.setVapidDetails(subject, publicKey, privateKey)
  configured = true
  return true
}

export type PushPayload = {
  title: string
  body: string
  url?: string
  tag?: string
}

/**
 * Sends to every active subscription. Endpoints that come back 404/410 are
 * permanently gone (app deleted, browser data cleared) and are deactivated so
 * the list doesn't accumulate dead devices.
 */
export async function sendPushToAll(payload: PushPayload) {
  if (!configure()) {
    console.warn('[push] VAPID keys not configured; skipping send')
    return { delivered: 0, failed: 0 }
  }

  const subscriptions = await db.query.pushSubscriptions.findMany({
    where: eq(pushSubscriptions.active, true),
  })

  if (subscriptions.length === 0) return { delivered: 0, failed: 0 }

  const body = JSON.stringify(payload)
  const expired: string[] = []
  let delivered = 0
  let failed = 0

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
        )
        delivered += 1
      } catch (error) {
        failed += 1
        const statusCode = (error as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) {
          expired.push(sub.id)
        } else {
          console.error('[push] send failed', statusCode, sub.endpoint.slice(0, 40))
        }
      }
    }),
  )

  if (expired.length > 0) {
    await db
      .update(pushSubscriptions)
      .set({ active: false })
      .where(inArray(pushSubscriptions.id, expired))
  }

  return { delivered, failed }
}

/**
 * Sends once and only once for a given key.
 *
 * The prep scheduler re-evaluates the same orders on every cron tick, so
 * without this the kitchen would be pinged about the same tray repeatedly. The
 * unique constraint on `dedupe_key` is what enforces it — the insert is
 * attempted first, and a conflict means someone already sent this.
 */
export async function sendPushOnce(
  dedupeKey: string,
  kind: string,
  payload: PushPayload,
  orderId?: string,
): Promise<boolean> {
  const [row] = await db
    .insert(notifications)
    .values({
      kind,
      orderId: orderId ?? null,
      dedupeKey,
      title: payload.title,
      body: payload.body,
      url: payload.url ?? null,
    })
    .onConflictDoNothing({ target: notifications.dedupeKey })
    .returning()

  // Another tick (or another instance) already claimed this notification.
  if (!row) return false

  const { delivered, failed } = await sendPushToAll(payload)

  await db
    .update(notifications)
    .set({ sentAt: new Date(), deliveredCount: delivered, failedCount: failed })
    .where(eq(notifications.id, row.id))

  return true
}
