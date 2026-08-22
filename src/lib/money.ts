/**
 * Money is stored and computed exclusively in integer cents. Floating point
 * dollars accumulate rounding error across line items, and an order total that
 * is off by a cent is a conversation with a customer nobody wants to have.
 */

const formatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

/** 16000 -> "$160.00" */
export function formatCents(cents: number): string {
  return formatter.format(cents / 100)
}

/** 16000 -> "$160"  |  1450 -> "$14.50"  — drops trailing ".00" for density. */
export function formatCentsCompact(cents: number): string {
  return cents % 100 === 0
    ? `$${Math.round(cents / 100).toLocaleString('en-US')}`
    : formatter.format(cents / 100)
}

/** "160", "$160", "160.50" -> 16000. Returns null on anything unparseable. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '')
  if (cleaned === '') return null

  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null

  return Math.round(value * 100)
}
