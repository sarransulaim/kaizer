import 'server-only'

import { and, asc, desc, eq, gt, sql } from 'drizzle-orm'

import { db } from '@/lib/db'
import {
  ingredients,
  inventoryCountLines,
  inventoryCounts,
  purchaseLines,
  purchases,
  wasteEntries,
  type IngredientCategory,
} from '@/lib/db/schema'

import { daysOfCover, foodCostPercent, valueOf } from './units'

/**
 * Reading stock without a till feeding every plate served.
 *
 * What the restaurant used can only be inferred: opening count, plus
 * deliveries, minus what is left on the shelf. So a count is not one reading
 * among many — it is the only moment the numbers touch reality, and everything
 * here is measured from the most recent one.
 *
 * That means on-hand between counts is an *upper bound*: deliveries and logged
 * waste move it, but a hundred covers on Tuesday do not. Every caller is
 * expected to say so rather than present it as a measurement.
 */

export type StockRow = {
  id: string
  name: string
  category: IngredientCategory
  stockUnit: string
  purchaseUnit: string
  stockPerPurchaseMilli: number
  lastCostCents: number
  parLevelMilli: number
  supplier: string | null
  /** Counted at the last stocktake, before anything since. */
  countedMilli: number
  /** Arrived since that count. */
  purchasedMilli: number
  /** Thrown away since that count. */
  wastedMilli: number
  /** Counted + delivered − wasted. An upper bound, not a measurement. */
  onHandMilli: number
  onHandValueCents: number
  /** Average per day over the last closed period, if there is one. */
  usagePerDayMilli: number
  daysLeft: number | null
  belowPar: boolean
}

/** The most recent stocktake, which every other figure is measured from. */
export async function getLastCount() {
  const [row] = await db
    .select()
    .from(inventoryCounts)
    .orderBy(desc(inventoryCounts.countedOn))
    .limit(1)

  return row ?? null
}

/** The one before it, so a period can be closed between the two. */
export async function getPreviousCount(beforeDate: string) {
  const [row] = await db
    .select()
    .from(inventoryCounts)
    .where(sql`${inventoryCounts.countedOn} < ${beforeDate}`)
    .orderBy(desc(inventoryCounts.countedOn))
    .limit(1)

  return row ?? null
}

/**
 * Average daily use of each ingredient over the last closed period.
 *
 * Needs two counts to exist: one to open the period and one to close it. With
 * fewer than two there is simply no usage history, and the caller shows days of
 * cover as unknown rather than inventing a rate.
 */
async function usagePerDay(): Promise<Map<string, number>> {
  const latest = await getLastCount()
  if (!latest) return new Map()

  const previous = await getPreviousCount(latest.countedOn)
  if (!previous) return new Map()

  const days = Math.max(
    1,
    Math.round(
      (new Date(latest.countedOn).getTime() - new Date(previous.countedOn).getTime()) /
        86_400_000,
    ),
  )

  const [opening, closing, delivered] = await Promise.all([
    db
      .select({
        ingredientId: inventoryCountLines.ingredientId,
        qty: inventoryCountLines.quantityMilli,
      })
      .from(inventoryCountLines)
      .where(eq(inventoryCountLines.countId, previous.id)),

    db
      .select({
        ingredientId: inventoryCountLines.ingredientId,
        qty: inventoryCountLines.quantityMilli,
      })
      .from(inventoryCountLines)
      .where(eq(inventoryCountLines.countId, latest.id)),

    db
      .select({
        ingredientId: purchaseLines.ingredientId,
        qty: sql<number>`COALESCE(SUM(${purchaseLines.stockQuantityMilli}), 0)::int`,
      })
      .from(purchaseLines)
      .innerJoin(purchases, eq(purchaseLines.purchaseId, purchases.id))
      .where(
        and(
          gt(purchases.purchasedOn, previous.countedOn),
          sql`${purchases.purchasedOn} <= ${latest.countedOn}`,
        ),
      )
      .groupBy(purchaseLines.ingredientId),
  ])

  const openingMap = new Map(opening.map((r) => [r.ingredientId, r.qty]))
  const deliveredMap = new Map(delivered.map((r) => [r.ingredientId, r.qty]))

  const rates = new Map<string, number>()
  for (const line of closing) {
    const used =
      (openingMap.get(line.ingredientId) ?? 0) +
      (deliveredMap.get(line.ingredientId) ?? 0) -
      line.qty

    /* Negative means more was counted than could possibly be there — a
       miscount, or a delivery logged late. Treated as no usage rather than
       propagated into a nonsense rate. */
    if (used > 0) rates.set(line.ingredientId, Math.round(used / days))
  }

  return rates
}

export async function getStock(): Promise<StockRow[]> {
  const latest = await getLastCount()
  const since = latest?.countedOn ?? '1970-01-01'

  const [items, counted, delivered, wasted, rates] = await Promise.all([
    db
      .select()
      .from(ingredients)
      .where(eq(ingredients.active, true))
      .orderBy(asc(ingredients.category), asc(ingredients.sortOrder), asc(ingredients.name)),

    latest
      ? db
          .select({
            ingredientId: inventoryCountLines.ingredientId,
            qty: inventoryCountLines.quantityMilli,
          })
          .from(inventoryCountLines)
          .where(eq(inventoryCountLines.countId, latest.id))
      : Promise.resolve([] as { ingredientId: string; qty: number }[]),

    db
      .select({
        ingredientId: purchaseLines.ingredientId,
        qty: sql<number>`COALESCE(SUM(${purchaseLines.stockQuantityMilli}), 0)::int`,
      })
      .from(purchaseLines)
      .innerJoin(purchases, eq(purchaseLines.purchaseId, purchases.id))
      .where(gt(purchases.purchasedOn, since))
      .groupBy(purchaseLines.ingredientId),

    db
      .select({
        ingredientId: wasteEntries.ingredientId,
        qty: sql<number>`COALESCE(SUM(${wasteEntries.quantityMilli}), 0)::int`,
      })
      .from(wasteEntries)
      .where(gt(wasteEntries.wastedOn, since))
      .groupBy(wasteEntries.ingredientId),

    usagePerDay(),
  ])

  const countedMap = new Map(counted.map((r) => [r.ingredientId, r.qty]))
  const deliveredMap = new Map(delivered.map((r) => [r.ingredientId, r.qty]))
  const wastedMap = new Map(wasted.map((r) => [r.ingredientId, r.qty]))

  return items.map((item) => {
    const countedMilli = countedMap.get(item.id) ?? 0
    const purchasedMilli = deliveredMap.get(item.id) ?? 0
    const wastedMilli = wastedMap.get(item.id) ?? 0
    const onHandMilli = Math.max(0, countedMilli + purchasedMilli - wastedMilli)
    const perDay = rates.get(item.id) ?? 0

    return {
      id: item.id,
      name: item.name,
      category: item.category,
      stockUnit: item.stockUnit,
      purchaseUnit: item.purchaseUnit,
      stockPerPurchaseMilli: item.stockPerPurchaseMilli,
      lastCostCents: item.lastCostCents,
      parLevelMilli: item.parLevelMilli,
      supplier: item.supplier,
      countedMilli,
      purchasedMilli,
      wastedMilli,
      onHandMilli,
      onHandValueCents: valueOf(onHandMilli, item.lastCostCents),
      usagePerDayMilli: perDay,
      daysLeft: daysOfCover(onHandMilli, perDay),
      belowPar: item.parLevelMilli > 0 && onHandMilli < item.parLevelMilli,
    }
  })
}

export type PeriodSummary = {
  from: string
  to: string
  days: number
  usageCostCents: number
  wasteCostCents: number
  purchaseCostCents: number
  salesCents: number | null
  foodCostPercent: number | null
}

/**
 * The last closed period: what went out of the store room, what it cost, and
 * what share of takings that was.
 *
 * Null until two counts exist, because a period needs both ends.
 */
export async function getPeriodSummary(): Promise<PeriodSummary | null> {
  const latest = await getLastCount()
  if (!latest) return null

  const previous = await getPreviousCount(latest.countedOn)
  if (!previous) return null

  const [openingRows, closingRows, purchaseRows, wasteRows] = await Promise.all([
    db
      .select({
        qty: inventoryCountLines.quantityMilli,
        cost: inventoryCountLines.costCentsSnapshot,
      })
      .from(inventoryCountLines)
      .where(eq(inventoryCountLines.countId, previous.id)),

    db
      .select({
        qty: inventoryCountLines.quantityMilli,
        cost: inventoryCountLines.costCentsSnapshot,
      })
      .from(inventoryCountLines)
      .where(eq(inventoryCountLines.countId, latest.id)),

    db
      .select({
        total: sql<number>`COALESCE(SUM(${purchaseLines.lineTotalCents}), 0)::int`,
      })
      .from(purchaseLines)
      .innerJoin(purchases, eq(purchaseLines.purchaseId, purchases.id))
      .where(
        and(
          gt(purchases.purchasedOn, previous.countedOn),
          sql`${purchases.purchasedOn} <= ${latest.countedOn}`,
        ),
      ),

    db
      .select({ total: sql<number>`COALESCE(SUM(${wasteEntries.costCents}), 0)::int` })
      .from(wasteEntries)
      .where(
        and(
          gt(wasteEntries.wastedOn, previous.countedOn),
          sql`${wasteEntries.wastedOn} <= ${latest.countedOn}`,
        ),
      ),
  ])

  const value = (rows: { qty: number; cost: number }[]) =>
    rows.reduce((sum, r) => sum + valueOf(r.qty, r.cost), 0)

  const openingValue = value(openingRows)
  const closingValue = value(closingRows)
  const purchaseCostCents = purchaseRows[0]?.total ?? 0

  /* Opening + bought − closing. What left the store room, however it left. */
  const usageCostCents = Math.max(
    0,
    openingValue + purchaseCostCents - closingValue,
  )

  const days = Math.max(
    1,
    Math.round(
      (new Date(latest.countedOn).getTime() - new Date(previous.countedOn).getTime()) /
        86_400_000,
    ),
  )

  return {
    from: previous.countedOn,
    to: latest.countedOn,
    days,
    usageCostCents,
    wasteCostCents: wasteRows[0]?.total ?? 0,
    purchaseCostCents,
    salesCents: latest.salesSinceLastCents,
    foodCostPercent: foodCostPercent(
      usageCostCents,
      latest.salesSinceLastCents ?? 0,
    ),
  }
}

export async function getRecentPurchases(limit = 20) {
  return db.query.purchases.findMany({
    orderBy: [desc(purchases.purchasedOn), desc(purchases.createdAt)],
    limit,
    with: { lines: { with: { ingredient: true } } },
  })
}

export async function getRecentCounts(limit = 12) {
  return db.query.inventoryCounts.findMany({
    orderBy: [desc(inventoryCounts.countedOn)],
    limit,
    with: { lines: true },
  })
}

export async function getRecentWaste(limit = 40) {
  return db.query.wasteEntries.findMany({
    orderBy: [desc(wasteEntries.wastedOn), desc(wasteEntries.createdAt)],
    limit,
    with: { ingredient: true },
  })
}

/** Everything, including what has been turned off, for the editor. */
export async function getAllIngredients() {
  return db
    .select()
    .from(ingredients)
    .orderBy(asc(ingredients.category), asc(ingredients.sortOrder), asc(ingredients.name))
}
