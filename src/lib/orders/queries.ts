import { and, asc, desc, eq, gte, inArray, lt, lte, ne, or, sql } from 'drizzle-orm'
import { cache } from 'react'

import { UPCOMING_WINDOW_DAYS } from '@/lib/config'
import { db } from '@/lib/db'
import {
  customers,
  menuItems,
  menuVariants,
  orderItems,
  orders,
} from '@/lib/db/schema'
import { addDays, endOfMonth, startOfMonth, today } from '@/lib/time'
import { ACTIVE_STATUSES, TERMINAL_STATUSES } from './status'

/* -------------------------------------------------------------------------- */
/*                                    Menu                                    */
/* -------------------------------------------------------------------------- */

/** `cache` dedupes this within a single render pass — the menu is read by both
 *  the order form and the prep view on the same page load. */
export const getMenu = cache(async () => {
  const items = await db.query.menuItems.findMany({
    where: eq(menuItems.active, true),
    orderBy: [asc(menuItems.sortOrder)],
    with: {
      variants: {
        where: eq(menuVariants.active, true),
        orderBy: [asc(menuVariants.sortOrder)],
      },
    },
  })

  return items
})

export type MenuWithVariants = Awaited<ReturnType<typeof getMenu>>

/* -------------------------------------------------------------------------- */
/*                                   Orders                                   */
/* -------------------------------------------------------------------------- */

/**
 * Shared `with` clause for order lookups. A function rather than a shared
 * object literal: Drizzle needs a mutable `orderBy` array, so `as const` on a
 * module-level constant is rejected by the type checker.
 */
function orderWith() {
  return {
    customer: true as const,
    items: { orderBy: [asc(orderItems.createdAt)] },
  }
}

/** All orders for one local calendar date, earliest service time first. */
export async function getOrdersForDate(isoDate: string) {
  return db.query.orders.findMany({
    where: eq(orders.serviceDate, isoDate),
    orderBy: [asc(orders.serviceAt)],
    with: orderWith(),
  })
}

export async function getTodayOrders() {
  return getOrdersForDate(today())
}

/**
 * Everything still open. Includes anything from previous days that never got
 * closed out — an order stuck in `prepping` from Saturday must not silently
 * disappear when the date rolls over.
 */
export async function getOpenOrders() {
  return db.query.orders.findMany({
    where: inArray(orders.status, ACTIVE_STATUSES),
    orderBy: [asc(orders.serviceAt)],
    with: orderWith(),
  })
}

/** Orders scheduled after today, within the upcoming window. */
export async function getUpcomingOrders(days: number) {
  const from = addDays(today(), 1)
  const to = addDays(today(), days)

  return db.query.orders.findMany({
    where: and(
      gte(orders.serviceDate, from),
      lte(orders.serviceDate, to),
      ne(orders.status, 'cancelled'),
    ),
    orderBy: [asc(orders.serviceAt)],
    with: orderWith(),
  })
}

/** Open orders whose service date has already passed — surfaced as a warning. */
export async function getOverdueOrders() {
  return db.query.orders.findMany({
    where: and(
      inArray(orders.status, ACTIVE_STATUSES),
      sql`${orders.serviceDate} < ${today()}`,
    ),
    orderBy: [asc(orders.serviceAt)],
    with: orderWith(),
  })
}

export async function getOrderById(id: string) {
  return db.query.orders.findFirst({
    where: eq(orders.id, id),
    with: {
      ...orderWith(),
      events: { orderBy: (e, { desc: d }) => [d(e.createdAt)] },
    },
  })
}

export type OrderWithDetail = NonNullable<Awaited<ReturnType<typeof getOrderById>>>
export type OrderWithItems = Awaited<ReturnType<typeof getOrdersForDate>>[number]

/* -------------------------------------------------------------------------- */
/*                                 Customers                                  */
/* -------------------------------------------------------------------------- */

/** Exact match on the normalized phone number — phone is the identity key. */
export async function findCustomerByPhone(normalizedPhone: string) {
  return db.query.customers.findFirst({
    where: eq(customers.phone, normalizedPhone),
  })
}

/**
 * Typeahead for order entry. Matches on a phone fragment or a name fragment so
 * the operator can start with whichever they have to hand from WhatsApp.
 */
export async function searchCustomers(query: string, limit = 8) {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const digits = trimmed.replace(/\D/g, '')
  const namePattern = `%${trimmed}%`

  return db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      email: customers.email,
      notes: customers.notes,
      orderCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${orders} WHERE ${orders.customerId} = ${customers.id}
      )`,
    })
    .from(customers)
    .where(
      digits.length >= 3
        ? or(
            sql`${customers.phone} LIKE ${`%${digits}%`}`,
            sql`${customers.name} ILIKE ${namePattern}`,
          )
        : sql`${customers.name} ILIKE ${namePattern}`,
    )
    .orderBy(desc(sql`(SELECT COUNT(*) FROM ${orders} WHERE ${orders.customerId} = ${customers.id})`))
    .limit(limit)
}

/* -------------------------------------------------------------------------- */
/*                                Prep summary                                */
/* -------------------------------------------------------------------------- */

export type PrepLine = {
  itemName: string
  sizeLabel: string
  /** Still to be made. The number the kitchen actually cooks to. */
  quantity: number
  /** Already gone out, on orders that have been completed. */
  doneQuantity: number
  /** Everything the day asked for, made or not. */
  totalQuantity: number
  /** How many still-open orders are waiting on this line. */
  orderCount: number
}

/**
 * What the kitchen still needs to cook for a given day.
 *
 * `quantity` counts only orders that are not yet completed, so a tray drops off
 * the cook list the moment its order is closed out — mid-service the sheet is
 * being asked "what is left to make", and a number that includes food already
 * handed over is worse than useless.
 *
 * The day's full production is carried alongside as `totalQuantity` so a line
 * can show "6 of 8 made" rather than appearing to shrink for no reason, and so
 * the morning prep sheet still reflects the whole day.
 */
export async function getPrepSummary(isoDate: string): Promise<PrepLine[]> {
  const pending = sql`${orders.status} NOT IN ('completed', 'cancelled')`
  const done = sql`${orders.status} = 'completed'`
  const billable = sql`${orders.status} <> 'cancelled'`

  const rows = await db
    .select({
      itemName: orderItems.itemNameSnapshot,
      sizeLabel: orderItems.sizeLabelSnapshot,
      quantity: sql<number>`(COALESCE(SUM(${orderItems.quantity}) FILTER (WHERE ${pending}), 0))::int`,
      doneQuantity: sql<number>`(COALESCE(SUM(${orderItems.quantity}) FILTER (WHERE ${done}), 0))::int`,
      totalQuantity: sql<number>`(COALESCE(SUM(${orderItems.quantity}) FILTER (WHERE ${billable}), 0))::int`,
      orderCount: sql<number>`(COUNT(DISTINCT ${orders.id}) FILTER (WHERE ${pending}))::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .leftJoin(menuVariants, eq(orderItems.menuVariantId, menuVariants.id))
    .leftJoin(menuItems, eq(menuVariants.menuItemId, menuItems.id))
    .where(and(eq(orders.serviceDate, isoDate), ne(orders.status, 'cancelled')))
    .groupBy(orderItems.itemNameSnapshot, orderItems.sizeLabelSnapshot)
    .orderBy(
      asc(sql`MIN(COALESCE(${menuItems.sortOrder}, 999))`),
      asc(sql`MIN(COALESCE(${menuVariants.sortOrder}, 999))`),
    )

  return rows
}

/** Per-day order count and revenue, for the upcoming view's day headers. */
export async function getDayTotals(fromDate: string, toDate: string) {
  return db
    .select({
      serviceDate: orders.serviceDate,
      orderCount: sql<number>`COUNT(*)::int`,
      totalCents: sql<number>`COALESCE(SUM(${orders.totalCents}), 0)::int`,
      unpaidCents: sql<number>`COALESCE(SUM(${orders.totalCents} - ${orders.amountPaidCents}), 0)::int`,
    })
    .from(orders)
    .where(
      and(
        gte(orders.serviceDate, fromDate),
        lte(orders.serviceDate, toDate),
        ne(orders.status, 'cancelled'),
      ),
    )
    .groupBy(orders.serviceDate)
    .orderBy(asc(orders.serviceDate))
}

/* -------------------------------------------------------------------------- */
/*                               Kitchen board                                */
/* -------------------------------------------------------------------------- */

export type ItemTotal = {
  itemName: string
  sizeLabel: string
  /** Still to be made — completed orders have dropped off. */
  quantity: number
  doneQuantity: number
  totalQuantity: number
  /** Still-open orders waiting on this line. */
  orderCount: number
}

/**
 * Roll a set of orders up into per-item, per-size totals.
 *
 * Deliberately computed in JS from the very array the cards are rendered from,
 * rather than by a second aggregate query. The kitchen display prints these
 * totals directly above the orders they came from, and an independent query
 * could disagree with the list underneath it the moment a status changed
 * between the two round trips.
 */
export function rollUpItems(list: OrderWithItems[]): ItemTotal[] {
  const totals = new Map<string, ItemTotal>()

  for (const order of list) {
    if (order.status === 'cancelled') continue

    /* Completed orders stop counting toward what is left to cook, but stay in
       the day's total so the board can show "6 of 8 made". */
    const outstanding = order.status !== 'completed'

    /* An order carrying two lines of the same item and size still counts once
       toward `orderCount` - it means "how many orders want this", not "how many
       lines mention it". */
    const counted = new Set<string>()

    for (const item of order.items) {
      const key = `${item.itemNameSnapshot} / ${item.sizeLabelSnapshot}`
      const existing = totals.get(key)

      if (existing) {
        existing.totalQuantity += item.quantity
        if (outstanding) {
          existing.quantity += item.quantity
          if (!counted.has(key)) existing.orderCount += 1
        } else {
          existing.doneQuantity += item.quantity
        }
      } else {
        totals.set(key, {
          itemName: item.itemNameSnapshot,
          sizeLabel: item.sizeLabelSnapshot,
          quantity: outstanding ? item.quantity : 0,
          doneQuantity: outstanding ? 0 : item.quantity,
          totalQuantity: item.quantity,
          orderCount: outstanding ? 1 : 0,
        })
      }

      counted.add(key)
    }
  }

  return [...totals.values()].sort(
    (a, b) =>
      b.quantity - a.quantity ||
      b.totalQuantity - a.totalQuantity ||
      a.itemName.localeCompare(b.itemName),
  )
}

/**
 * Everything the wall display should show, in one pass: today's orders, plus
 * anything still open from an earlier day so a forgotten order cannot quietly
 * scroll off the board when the date rolls over.
 */
export async function getKitchenBoard() {
  const date = today()

  const scoped = await db.query.orders.findMany({
    where: or(
      eq(orders.serviceDate, date),
      and(inArray(orders.status, ACTIVE_STATUSES), lt(orders.serviceDate, date)),
    ),
    orderBy: [asc(orders.serviceAt)],
    with: orderWith(),
  })

  const todays = scoped.filter((o) => o.serviceDate === date)

  return {
    date,
    overdue: scoped.filter((o) => o.serviceDate < date),
    live: todays.filter((o) => !TERMINAL_STATUSES.includes(o.status)),
    done: todays.filter((o) => o.status === 'completed'),
    cancelled: todays.filter((o) => o.status === 'cancelled'),
    /* Totals cover the whole day's production - completed included, cancelled
       excluded - so the board shows what has to be made in total, not merely
       what is left to start. */
    totals: rollUpItems(todays),
  }
}

/* -------------------------------------------------------------------------- */
/*                             Dashboard snapshot                             */
/* -------------------------------------------------------------------------- */

export type DashboardSnapshot = {
  todayOrders: number
  todayOpen: number
  todayRevenueCents: number
  todayUnpaidCents: number
  upcomingOrders: number
  upcomingRevenueCents: number
  monthOrders: number
  monthRevenueCents: number
  totalOrders: number
  openOrders: number
  overdueOrders: number
  outstandingCents: number
}

const EMPTY_SNAPSHOT: DashboardSnapshot = {
  todayOrders: 0,
  todayOpen: 0,
  todayRevenueCents: 0,
  todayUnpaidCents: 0,
  upcomingOrders: 0,
  upcomingRevenueCents: 0,
  monthOrders: 0,
  monthRevenueCents: 0,
  totalOrders: 0,
  openOrders: 0,
  overdueOrders: 0,
  outstandingCents: 0,
}

/**
 * Every headline figure on the dashboard in a single round trip.
 *
 * Aggregate `FILTER` clauses rather than a dozen separate counts: one scan of
 * `orders` answers all of it, and because every figure comes from the same
 * snapshot they cannot contradict each other the way independent queries run
 * milliseconds apart can.
 */
export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const date = today()
  const upcomingFrom = addDays(date, 1)
  const upcomingTo = addDays(date, UPCOMING_WINDOW_DAYS)
  const monthFrom = startOfMonth()
  const monthTo = endOfMonth()

  const active = sql.join(
    ACTIVE_STATUSES.map((status) => sql`${status}`),
    sql`, `,
  )
  const billable = sql`${orders.status} <> 'cancelled'`
  const balance = sql`${orders.totalCents} - ${orders.amountPaidCents}`
  const isToday = sql`${orders.serviceDate} = ${date}`
  const inMonth = sql`${orders.serviceDate} BETWEEN ${monthFrom} AND ${monthTo}`
  const isUpcoming = sql`${orders.serviceDate} BETWEEN ${upcomingFrom} AND ${upcomingTo}`
  const isActive = sql`${orders.status} IN (${active})`

  const [row] = await db
    .select({
      todayOrders: sql<number>`(COUNT(*) FILTER (WHERE ${isToday} AND ${billable}))::int`,
      todayOpen: sql<number>`(COUNT(*) FILTER (WHERE ${isToday} AND ${isActive}))::int`,
      todayRevenueCents: sql<number>`(COALESCE(SUM(${orders.totalCents}) FILTER (WHERE ${isToday} AND ${billable}), 0))::int`,
      todayUnpaidCents: sql<number>`(COALESCE(SUM(${balance}) FILTER (WHERE ${isToday} AND ${billable}), 0))::int`,
      upcomingOrders: sql<number>`(COUNT(*) FILTER (WHERE ${isUpcoming} AND ${billable}))::int`,
      upcomingRevenueCents: sql<number>`(COALESCE(SUM(${orders.totalCents}) FILTER (WHERE ${isUpcoming} AND ${billable}), 0))::int`,
      monthOrders: sql<number>`(COUNT(*) FILTER (WHERE ${inMonth} AND ${billable}))::int`,
      monthRevenueCents: sql<number>`(COALESCE(SUM(${orders.totalCents}) FILTER (WHERE ${inMonth} AND ${billable}), 0))::int`,
      totalOrders: sql<number>`(COUNT(*) FILTER (WHERE ${billable}))::int`,
      openOrders: sql<number>`(COUNT(*) FILTER (WHERE ${isActive}))::int`,
      overdueOrders: sql<number>`(COUNT(*) FILTER (WHERE ${isActive} AND ${orders.serviceDate} < ${date}))::int`,
      outstandingCents: sql<number>`(COALESCE(SUM(${balance}) FILTER (WHERE ${billable}), 0))::int`,
    })
    .from(orders)

  return row ?? EMPTY_SNAPSHOT
}

/** Most recent orders across every date, for the dashboard's "All" view. */
export async function getRecentOrders(limit = 40, offset = 0) {
  return db.query.orders.findMany({
    orderBy: [desc(orders.serviceAt)],
    limit,
    offset,
    with: orderWith(),
  })
}
