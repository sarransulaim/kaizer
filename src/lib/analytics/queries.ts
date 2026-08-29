import { and, asc, desc, gte, lte, sql } from 'drizzle-orm'

import { db } from '@/lib/db'
import {
  customers,
  orderItems,
  orders,
  type FulfillmentType,
  type OrderChannel,
  type PaymentMethod,
  type PaymentStatus,
} from '@/lib/db/schema'
import { addDays, endOfMonth, startOfMonth, today } from '@/lib/time'

/**
 * Reporting queries.
 *
 * Two rules run through all of it:
 *
 *  - **Cancelled orders never count.** They are not lost revenue, they are
 *    orders that did not happen; including them would overstate every figure.
 *    They are reported once, on their own, as a cancellation count.
 *  - **Booked and collected are different numbers.** A catering business takes
 *    deposits, so "we sold $4,000" and "we have $4,000" are rarely the same
 *    thing. Every revenue figure here says which one it is, and the gap between
 *    them is surfaced as outstanding rather than buried.
 *
 * Windows are expressed in `service_date` — the day the food is due, which is
 * the day the business thinks of an order as belonging to, not the day it was
 * typed in.
 */

export const RANGES = ['7d', '30d', '90d', 'month', 'all'] as const
export type Range = (typeof RANGES)[number]

export const RANGE_LABELS: Record<Range, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  month: 'This month',
  all: 'All time',
}

export function parseRange(value: string | string[] | undefined): Range {
  return typeof value === 'string' && (RANGES as readonly string[]).includes(value)
    ? (value as Range)
    : '30d'
}

/**
 * Resolve a range to concrete dates. "This month" and "All time" deliberately
 * reach into the future — a catering book is mostly forward-looking, and an
 * August total that omitted the bookings for next weekend would be wrong. The
 * page prints the resolved window so there is never any doubt what is counted.
 */
export async function resolveRange(
  range: Range,
): Promise<{ from: string; to: string }> {
  const now = today()

  if (range === 'month') return { from: startOfMonth(), to: endOfMonth() }

  if (range === 'all') {
    const [bounds] = await db
      .select({
        min: sql<string | null>`MIN(${orders.serviceDate})`,
        max: sql<string | null>`MAX(${orders.serviceDate})`,
      })
      .from(orders)

    return { from: bounds?.min ?? now, to: bounds?.max ?? now }
  }

  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  return { from: addDays(now, -(days - 1)), to: now }
}

/* -------------------------------------------------------------------------- */

export type Headline = {
  orders: number
  bookedCents: number
  collectedCents: number
  outstandingCents: number
  avgOrderCents: number
  cancelled: number
  customers: number
  repeatCustomers: number
  units: number
}

export type ItemRow = {
  itemName: string
  units: number
  revenueCents: number
  orderCount: number
}

export type SizeRow = ItemRow & { sizeLabel: string }

export type PaymentStatusRow = {
  status: PaymentStatus
  orders: number
  bookedCents: number
  collectedCents: number
}

export type MethodRow = {
  method: PaymentMethod | null
  orders: number
  collectedCents: number
}

export type DayRow = {
  weekday: number
  orders: number
  revenueCents: number
}

export type SeriesPoint = {
  date: string
  orders: number
  revenueCents: number
}

export type MixRow<T> = { key: T; orders: number; revenueCents: number }

export type CustomerRow = {
  name: string
  phone: string
  orders: number
  revenueCents: number
  outstandingCents: number
}

export type Analytics = {
  from: string
  to: string
  headline: Headline
  items: ItemRow[]
  sizes: SizeRow[]
  paymentStatus: PaymentStatusRow[]
  methods: MethodRow[]
  weekdays: DayRow[]
  series: SeriesPoint[]
  seriesGrouping: 'day' | 'week'
  fulfillment: MixRow<FulfillmentType>[]
  channels: MixRow<OrderChannel>[]
  topCustomers: CustomerRow[]
}

/** Only orders that actually happened count toward money. */
const billable = sql`${orders.status} <> 'cancelled'`

export async function getAnalytics(from: string, to: string): Promise<Analytics> {
  const inWindow = and(gte(orders.serviceDate, from), lte(orders.serviceDate, to))
  const balance = sql`${orders.totalCents} - ${orders.amountPaidCents}`

  /* A long window would produce a column per day and an unreadable axis, so
     anything over a month is bucketed by week. */
  const spanDays =
    Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
    ) + 1
  const seriesGrouping: 'day' | 'week' = spanDays > 31 ? 'week' : 'day'
  const bucket =
    seriesGrouping === 'week'
      ? sql<string>`to_char(date_trunc('week', ${orders.serviceDate}), 'YYYY-MM-DD')`
      : sql<string>`to_char(${orders.serviceDate}, 'YYYY-MM-DD')`

  const [
    headlineRows,
    repeatRows,
    unitRows,
    itemRows,
    sizeRows,
    statusRows,
    methodRows,
    weekdayRows,
    seriesRows,
    fulfillmentRows,
    channelRows,
    customerRows,
  ] = await Promise.all([
    db
      .select({
        orders: sql<number>`(COUNT(*) FILTER (WHERE ${billable}))::int`,
        bookedCents: sql<number>`(COALESCE(SUM(${orders.totalCents}) FILTER (WHERE ${billable}), 0))::int`,
        collectedCents: sql<number>`(COALESCE(SUM(${orders.amountPaidCents}) FILTER (WHERE ${billable}), 0))::int`,
        outstandingCents: sql<number>`(COALESCE(SUM(${balance}) FILTER (WHERE ${billable}), 0))::int`,
        cancelled: sql<number>`(COUNT(*) FILTER (WHERE ${orders.status} = 'cancelled'))::int`,
        customers: sql<number>`(COUNT(DISTINCT ${orders.customerId}) FILTER (WHERE ${billable}))::int`,
      })
      .from(orders)
      .where(inWindow),

    /* Customers with more than one order in the window — the retention signal
       that matters most for catering, where a repeat booking is the whole game. */
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(
        db
          .select({ customerId: orders.customerId })
          .from(orders)
          .where(and(inWindow, billable))
          .groupBy(orders.customerId)
          .having(sql`COUNT(*) > 1`)
          .as('repeat_customers'),
      ),

    db
      .select({
        units: sql<number>`(COALESCE(SUM(${orderItems.quantity}), 0))::int`,
      })
      .from(orderItems)
      .innerJoin(orders, sql`${orderItems.orderId} = ${orders.id}`)
      .where(and(inWindow, billable)),

    db
      .select({
        itemName: orderItems.itemNameSnapshot,
        units: sql<number>`(SUM(${orderItems.quantity}))::int`,
        revenueCents: sql<number>`(SUM(${orderItems.lineTotalCents}))::int`,
        orderCount: sql<number>`(COUNT(DISTINCT ${orders.id}))::int`,
      })
      .from(orderItems)
      .innerJoin(orders, sql`${orderItems.orderId} = ${orders.id}`)
      .where(and(inWindow, billable))
      .groupBy(orderItems.itemNameSnapshot)
      .orderBy(desc(sql`SUM(${orderItems.lineTotalCents})`)),

    db
      .select({
        itemName: orderItems.itemNameSnapshot,
        sizeLabel: orderItems.sizeLabelSnapshot,
        units: sql<number>`(SUM(${orderItems.quantity}))::int`,
        revenueCents: sql<number>`(SUM(${orderItems.lineTotalCents}))::int`,
        orderCount: sql<number>`(COUNT(DISTINCT ${orders.id}))::int`,
      })
      .from(orderItems)
      .innerJoin(orders, sql`${orderItems.orderId} = ${orders.id}`)
      .where(and(inWindow, billable))
      .groupBy(orderItems.itemNameSnapshot, orderItems.sizeLabelSnapshot)
      .orderBy(desc(sql`SUM(${orderItems.lineTotalCents})`)),

    db
      .select({
        status: orders.paymentStatus,
        orders: sql<number>`COUNT(*)::int`,
        bookedCents: sql<number>`(COALESCE(SUM(${orders.totalCents}), 0))::int`,
        collectedCents: sql<number>`(COALESCE(SUM(${orders.amountPaidCents}), 0))::int`,
      })
      .from(orders)
      .where(and(inWindow, billable))
      .groupBy(orders.paymentStatus),

    db
      .select({
        method: orders.paymentMethod,
        orders: sql<number>`COUNT(*)::int`,
        collectedCents: sql<number>`(COALESCE(SUM(${orders.amountPaidCents}), 0))::int`,
      })
      .from(orders)
      .where(and(inWindow, billable))
      .groupBy(orders.paymentMethod)
      .orderBy(desc(sql`COALESCE(SUM(${orders.amountPaidCents}), 0)`)),

    db
      .select({
        weekday: sql<number>`(EXTRACT(DOW FROM ${orders.serviceDate}))::int`,
        orders: sql<number>`COUNT(*)::int`,
        revenueCents: sql<number>`(COALESCE(SUM(${orders.totalCents}), 0))::int`,
      })
      .from(orders)
      .where(and(inWindow, billable))
      .groupBy(sql`EXTRACT(DOW FROM ${orders.serviceDate})`)
      .orderBy(asc(sql`EXTRACT(DOW FROM ${orders.serviceDate})`)),

    db
      .select({
        date: bucket,
        orders: sql<number>`COUNT(*)::int`,
        revenueCents: sql<number>`(COALESCE(SUM(${orders.totalCents}), 0))::int`,
      })
      .from(orders)
      .where(and(inWindow, billable))
      .groupBy(bucket)
      .orderBy(asc(bucket)),

    db
      .select({
        key: orders.fulfillmentType,
        orders: sql<number>`COUNT(*)::int`,
        revenueCents: sql<number>`(COALESCE(SUM(${orders.totalCents}), 0))::int`,
      })
      .from(orders)
      .where(and(inWindow, billable))
      .groupBy(orders.fulfillmentType)
      .orderBy(desc(sql`COUNT(*)`)),

    db
      .select({
        key: orders.channel,
        orders: sql<number>`COUNT(*)::int`,
        revenueCents: sql<number>`(COALESCE(SUM(${orders.totalCents}), 0))::int`,
      })
      .from(orders)
      .where(and(inWindow, billable))
      .groupBy(orders.channel)
      .orderBy(desc(sql`COUNT(*)`)),

    db
      .select({
        name: customers.name,
        phone: customers.phone,
        orders: sql<number>`COUNT(*)::int`,
        revenueCents: sql<number>`(COALESCE(SUM(${orders.totalCents}), 0))::int`,
        outstandingCents: sql<number>`(COALESCE(SUM(${balance}), 0))::int`,
      })
      .from(orders)
      .innerJoin(customers, sql`${orders.customerId} = ${customers.id}`)
      .where(and(inWindow, billable))
      .groupBy(customers.id, customers.name, customers.phone)
      .orderBy(desc(sql`COALESCE(SUM(${orders.totalCents}), 0)`))
      .limit(10),
  ])

  const base = headlineRows[0]
  const orderCount = base?.orders ?? 0

  return {
    from,
    to,
    headline: {
      orders: orderCount,
      bookedCents: base?.bookedCents ?? 0,
      collectedCents: base?.collectedCents ?? 0,
      outstandingCents: base?.outstandingCents ?? 0,
      avgOrderCents: orderCount > 0 ? Math.round((base?.bookedCents ?? 0) / orderCount) : 0,
      cancelled: base?.cancelled ?? 0,
      customers: base?.customers ?? 0,
      repeatCustomers: repeatRows[0]?.count ?? 0,
      units: unitRows[0]?.units ?? 0,
    },
    items: itemRows,
    sizes: sizeRows,
    paymentStatus: statusRows,
    methods: methodRows,
    weekdays: weekdayRows,
    series: seriesRows,
    seriesGrouping,
    fulfillment: fulfillmentRows,
    channels: channelRows,
    topCustomers: customerRows,
  }
}
