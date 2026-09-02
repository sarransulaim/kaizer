import { describe, expect, it } from 'vitest'

import {
  formatCents,
  formatCentsCompact,
  parseDollarsToCents,
} from '@/lib/money'

describe('formatCents', () => {
  it('always shows cents', () => {
    expect(formatCents(16000)).toBe('$160.00')
    expect(formatCents(1450)).toBe('$14.50')
    expect(formatCents(0)).toBe('$0.00')
  })

  it('groups thousands', () => {
    expect(formatCents(123456)).toBe('$1,234.56')
  })
})

describe('formatCentsCompact', () => {
  it('drops a trailing .00 for density', () => {
    expect(formatCentsCompact(16000)).toBe('$160')
    expect(formatCentsCompact(0)).toBe('$0')
  })

  it('keeps the cents when there are any', () => {
    expect(formatCentsCompact(1450)).toBe('$14.50')
  })

  it('groups thousands', () => {
    expect(formatCentsCompact(1_234_500)).toBe('$12,345')
  })
})

describe('parseDollarsToCents', () => {
  it('reads what an operator actually types', () => {
    expect(parseDollarsToCents('160')).toBe(16000)
    expect(parseDollarsToCents('$160')).toBe(16000)
    expect(parseDollarsToCents('160.50')).toBe(16050)
    expect(parseDollarsToCents('1,234.50')).toBe(123450)
    expect(parseDollarsToCents(' 80 ')).toBe(8000)
  })

  /* Floating point makes 19.99 * 100 land at 1998.9999…; truncating there
     would quietly undercharge every order with an odd price. */
  it('rounds rather than truncating a binary fraction', () => {
    expect(parseDollarsToCents('19.99')).toBe(1999)
    expect(parseDollarsToCents('0.07')).toBe(7)
    expect(parseDollarsToCents('0.29')).toBe(29)
  })

  /**
   * The guarantee that actually matters: every price anyone can type survives
   * the round trip through cents and back.
   *
   * The binary error on a two-decimal value is around 1e-13, nowhere near the
   * half-cent that would change the rounding, so this holds for the whole
   * range. Fractions of a cent are a different matter and are not a price.
   */
  it('round-trips every two-decimal price up to $1,000', () => {
    for (let cents = 0; cents <= 100_000; cents += 1) {
      const typed = (cents / 100).toFixed(2)
      if (parseDollarsToCents(typed) !== cents) {
        throw new Error(`${typed} parsed to ${parseDollarsToCents(typed)}, not ${cents}`)
      }
    }
    expect(true).toBe(true)
  })

  it('rejects anything that is not a price', () => {
    expect(parseDollarsToCents('')).toBeNull()
    expect(parseDollarsToCents('abc')).toBeNull()
    expect(parseDollarsToCents('-5')).toBeNull()
    expect(parseDollarsToCents('1.2.3')).toBeNull()
  })

  it('treats zero as a real price, not as absent', () => {
    expect(parseDollarsToCents('0')).toBe(0)
  })
})
