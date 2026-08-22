import { sql } from 'drizzle-orm'

import { db } from './db'

/**
 * Realtime fan-out uses Postgres itself as the message bus.
 *
 * A write calls `pg_notify`; the SSE route (`/api/stream`) holds a dedicated
 * client on `LISTEN orders_changed` and pushes each notification down to every
 * connected phone and the kitchen tablet. Because Railway runs a persistent
 * Node process, those connections can simply stay open — no polling, no
 * websocket service, no third-party vendor.
 */

export const ORDERS_CHANNEL = 'orders_changed'

export type OrderChangePayload = {
  type: 'created' | 'status' | 'payment' | 'updated' | 'deleted'
  orderId: string
  serviceDate: string
  at: string
}

export async function publishOrderChange(
  payload: Omit<OrderChangePayload, 'at'>,
): Promise<void> {
  const body = JSON.stringify({ ...payload, at: new Date().toISOString() })

  try {
    await db.execute(sql`SELECT pg_notify(${ORDERS_CHANNEL}, ${body})`)
  } catch (error) {
    // A failed notification must never fail the write that triggered it —
    // clients fall back to their periodic refresh.
    console.error('[realtime] pg_notify failed', error)
  }
}
