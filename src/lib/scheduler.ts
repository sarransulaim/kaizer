import 'server-only'

import { and, eq, gte, inArray, lte } from 'drizzle-orm'

import { db } from './db'
import { menuItems, menuVariants, orders } from './db/schema'
import { formatCentsCompact } from './money'
import { ACTIVE_STATUSES } from './orders/status'
import { getPrepSummary } from './orders/queries'
import { sendPushOnce } from './push'
import { formatTime, minutesUntil, today } from './time'

/**
 * Notification scheduler, run on a cron tick.
 *
 * Every alert goes through `sendPushOnce` with a stable dedupe key, so the tick
 * can run as often as we like — and can safely overlap or be retried — without
 * the kitchen being pinged twice about the same tray. That means the schedule
 * is "at least once per window" rather than "exactly on the minute", which is
 * the right trade for something a phone might be asleep for.
 */

const PREP_WINDOW_HOURS = 48
const DUE_SOON_MINUTES = 60
const PREP_SHEET_HOUR = 6

export async function runScheduler(now = new Date()) {
  const sent: string[] = []

  sent.push(...(await sendPrepStartAlerts()))
  sent.push(...(await sendDueSoonAlerts()))

  const sheet = await sendDailyPrepSheet(now)
  if (sheet) sent.push(sheet)

  return { sent, count: sent.length }
}

/**
 * "Start cooking now." Each menu item carries its own lead time — mutton needs
 * a longer marination than kheer — so an order's alert fires off the longest
 * lead among the items actually ordered.
 */
async function sendPrepStartAlerts(): Promise<string[]> {
  const horizon = new Date(Date.now() + PREP_WINDOW_HOURS * 3600_000)

  const open = await db.query.orders.findMany({
    where: and(
      inArray(orders.status, ACTIVE_STATUSES),
      lte(orders.serviceAt, horizon),
      gte(orders.serviceAt, new Date()),
    ),
    with: { customer: true, items: true },
  })

  if (open.length === 0) return []

  /* One query for the lead times of every variant in play, rather than a
     per-order round trip. */
  const variantIds = open
    .flatMap((o) => o.items.map((i) => i.menuVariantId))
    .filter((id): id is string => Boolean(id))

  const leadByVariant = new Map<string, number>()
  if (variantIds.length > 0) {
    const rows = await db
      .select({
        variantId: menuVariants.id,
        prepLeadHours: menuItems.prepLeadHours,
      })
      .from(menuVariants)
      .innerJoin(menuItems, eq(menuVariants.menuItemId, menuItems.id))
      .where(inArray(menuVariants.id, variantIds))

    for (const row of rows) leadByVariant.set(row.variantId, row.prepLeadHours)
  }

  const sent: string[] = []

  for (const order of open) {
    const leadHours = Math.max(
      ...order.items.map((item) =>
        item.menuVariantId ? (leadByVariant.get(item.menuVariantId) ?? 12) : 12,
      ),
      0,
    )

    const startBy = order.serviceAt.getTime() - leadHours * 3600_000
    if (Date.now() < startBy) continue

    const summary = order.items
      .map((i) => `${i.quantity}× ${i.itemNameSnapshot} (${i.sizeLabelSnapshot})`)
      .join(', ')

    const delivered = await sendPushOnce(
      `prep:${order.id}`,
      'prep_alert',
      {
        title: `Start prep — ${order.customer.name}`,
        body: `Due ${formatTime(order.serviceTime)}. ${summary}`,
        url: `/orders/${order.id}`,
        tag: `prep-${order.id}`,
      },
      order.id,
    )

    if (delivered) sent.push(`prep:${order.id}`)
  }

  return sent
}

/** An order is an hour out and still isn't marked ready. */
async function sendDueSoonAlerts(): Promise<string[]> {
  const soon = new Date(Date.now() + DUE_SOON_MINUTES * 60_000)

  const due = await db.query.orders.findMany({
    where: and(
      inArray(orders.status, ['new', 'confirmed', 'prepping']),
      lte(orders.serviceAt, soon),
      gte(orders.serviceAt, new Date()),
    ),
    with: { customer: true },
  })

  const sent: string[] = []

  for (const order of due) {
    const minutes = Math.max(minutesUntil(order.serviceAt), 0)

    const delivered = await sendPushOnce(
      `due:${order.id}`,
      'order_due',
      {
        title: `${order.customer.name} in ${minutes}m`,
        body: `${formatTime(order.serviceTime)} · ${order.fulfillmentType.replace('_', ' ')} · not ready yet`,
        url: `/orders/${order.id}`,
        tag: `due-${order.id}`,
      },
      order.id,
    )

    if (delivered) sent.push(`due:${order.id}`)
  }

  return sent
}

/** Morning roll-up of everything the kitchen has to produce today. */
async function sendDailyPrepSheet(now: Date): Promise<string | null> {
  const hourLocal = Number(
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'America/New_York',
    }).format(now),
  )

  if (hourLocal < PREP_SHEET_HOUR) return null

  const date = today()
  const summary = await getPrepSummary(date)
  if (summary.length === 0) return null

  const dayOrders = await db.query.orders.findMany({
    where: eq(orders.serviceDate, date),
  })

  const billable = dayOrders.filter((o) => o.status !== 'cancelled')
  const revenue = billable.reduce((sum, o) => sum + o.totalCents, 0)

  const lines = summary
    .map((line) => `${line.quantity}× ${line.itemName} ${line.sizeLabel}`)
    .join(' · ')

  const delivered = await sendPushOnce(`sheet:${date}`, 'prep_sheet', {
    title: `Today: ${billable.length} orders · ${formatCentsCompact(revenue)}`,
    body: lines,
    url: '/prep',
    tag: 'prep-sheet',
  })

  return delivered ? `sheet:${date}` : null
}
