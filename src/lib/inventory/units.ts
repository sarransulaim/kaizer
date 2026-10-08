/**
 * Quantities, units and the arithmetic between them.
 *
 * Everything is held in thousandths of a stock unit — "milli" throughout — for
 * the same reason money is held in cents: 0.1kg three times is not 0.3kg in
 * floating point, and a store room reconciled daily would drift by grams a week
 * until the count stopped agreeing with the shelf for no visible reason.
 *
 * Two units exist for every ingredient and the difference matters. A *stock
 * unit* is what the kitchen counts and cooks in — a kilo, a pound, a litre. A
 * *purchase unit* is what the supplier sells — a 40lb case, a 20kg bag. Nothing
 * outside this module should multiply one by the other.
 */

export const MILLI = 1000

/** "2.5" -> 2500. Returns null for anything that is not a quantity. */
export function parseQuantity(input: string): number | null {
  const cleaned = input.replace(/[\s,]/g, '')
  if (cleaned === '') return null

  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null

  return Math.round(value * MILLI)
}

/** 2500 -> "2.5", 2000 -> "2", 2050 -> "2.05" — trailing zeros dropped. */
export function formatQuantity(milli: number): string {
  const value = milli / MILLI
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toFixed(3)))
}

/** 2500 with "kg" -> "2.5 kg" */
export function formatWithUnit(milli: number, unit: string): string {
  return `${formatQuantity(milli)} ${unit}`
}

/**
 * Stock units received from a delivery.
 *
 * Two cases of a 40lb item is 80lb. Both sides arrive in thousandths, so the
 * product has to come back down by one factor of a thousand.
 */
export function purchaseToStock(
  quantityMilli: number,
  stockPerPurchaseMilli: number,
): number {
  return Math.round((quantityMilli * stockPerPurchaseMilli) / MILLI)
}

/** The reverse: how many purchase units a quantity of stock represents. */
export function stockToPurchase(
  stockMilli: number,
  stockPerPurchaseMilli: number,
): number {
  if (stockPerPurchaseMilli <= 0) return 0
  return Math.round((stockMilli * MILLI) / stockPerPurchaseMilli)
}

/**
 * What a delivery line costs per stock unit.
 *
 * This is the number every later cost figure is built on: a case price divided
 * by what is in the case. Getting it from the invoice rather than asking anyone
 * to work it out is the whole reason both units are stored.
 */
export function costPerStockUnit(
  unitCostCents: number,
  stockPerPurchaseMilli: number,
): number {
  if (stockPerPurchaseMilli <= 0) return 0
  return Math.round((unitCostCents * MILLI) / stockPerPurchaseMilli)
}

/** What a quantity of stock is worth, at a cost per stock unit. */
export function valueOf(stockMilli: number, costPerStockUnitCents: number): number {
  return Math.round((stockMilli * costPerStockUnitCents) / MILLI)
}

/**
 * Food cost as a percentage of takings.
 *
 * The number a restaurant lives or dies by. Returns null rather than zero when
 * there are no sales to divide by — a period with no takings has no food cost
 * percentage, and showing 0% would read as excellent when it means unknown.
 */
export function foodCostPercent(
  costCents: number,
  salesCents: number,
): number | null {
  if (salesCents <= 0) return null
  return Math.round((costCents / salesCents) * 1000) / 10
}

/**
 * How long the stock on hand lasts at the rate it has been going.
 *
 * Null when nothing was used over the period measured: dividing by zero would
 * say "infinite days of cover", which is true and useless. The caller shows
 * "no usage yet" instead.
 */
export function daysOfCover(
  onHandMilli: number,
  usageMilliPerDay: number,
): number | null {
  if (usageMilliPerDay <= 0) return null
  return Math.round((onHandMilli / usageMilliPerDay) * 10) / 10
}

/** Units offered when adding an ingredient, grouped by what they measure. */
export const STOCK_UNITS = [
  'kg',
  'g',
  'lb',
  'oz',
  'L',
  'mL',
  'each',
  'dozen',
] as const

export const PURCHASE_UNITS = [
  'case',
  'bag',
  'box',
  'sack',
  'tin',
  'jar',
  'bottle',
  'tray',
  'each',
  'kg',
  'lb',
] as const

export const CATEGORY_LABELS: Record<string, string> = {
  produce: 'Produce',
  meat: 'Meat',
  dairy: 'Dairy',
  dry_goods: 'Dry goods',
  spices: 'Spices',
  packaging: 'Packaging',
  other: 'Other',
}

export const WASTE_REASON_LABELS: Record<string, string> = {
  spoiled: 'Spoiled',
  overproduced: 'Over-produced',
  burnt: 'Burnt',
  dropped: 'Dropped',
  returned: 'Returned',
  other: 'Other',
}
