import { and, asc, desc, eq, gte, inArray, lte, ne, or, sql } from 'drizzle-orm'
import { cache } from 'react'

import { db } from '@/lib/db'
import {
  customers,
  menuItems,
  menuVariants,
  orderItems,
  orders,
} from '@/lib/db/schema'
import { addDays, today } from '@/lib/time'
import { ACTIVE_STATUSES } from './status'

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
  quantity: number
  orderCount: number
}

/**
 * What the kitchen actually needs to cook for a given day: quantities rolled up
 * across every open order, rather than a list the chef has to add up by hand.
 * Cancelled orders are excluded; completed ones are kept so the sheet still
 * reflects the full day's production.
 */
export async function getPrepSummary(isoDate: string): Promise<PrepLine[]> {
  const rows = await db
    .select({
      itemName: orderItems.itemNameSnapshot,
      sizeLabel: orderItems.sizeLabelSnapshot,
      quantity: sql<number>`SUM(${orderItems.quantity})::int`,
      orderCount: sql<number>`COUNT(DISTINCT ${orders.id})::int`,
      sortKey: sql<number>`MIN(COALESCE(${menuItems.sortOrder}, 999))`,
      variantSort: sql<number>`MIN(COALESCE(${menuVariants.sortOrder}, 999))`,
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

  return rows.map(({ itemName, sizeLabel, quantity, orderCount }) => ({
    itemName,
    sizeLabel,
    quantity,
    orderCount,
  }))
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
