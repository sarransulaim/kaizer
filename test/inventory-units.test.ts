import { describe, expect, it } from 'vitest'

import {
  costPerStockUnit,
  daysOfCover,
  foodCostPercent,
  formatQuantity,
  formatWithUnit,
  parseQuantity,
  purchaseToStock,
  stockToPurchase,
  valueOf,
} from '@/lib/inventory/units'

describe('parseQuantity', () => {
  it('reads what someone types on a count sheet', () => {
    expect(parseQuantity('2.5')).toBe(2500)
    expect(parseQuantity('40')).toBe(40_000)
    expect(parseQuantity(' 12 ')).toBe(12_000)
    expect(parseQuantity('1,250')).toBe(1_250_000)
    expect(parseQuantity('0')).toBe(0)
  })

  it('rejects anything that is not a quantity', () => {
    expect(parseQuantity('')).toBeNull()
    expect(parseQuantity('abc')).toBeNull()
    expect(parseQuantity('-5')).toBeNull()
    expect(parseQuantity('2.1.3')).toBeNull()
  })

  /* A shelf count of 0.1kg three times must come to 0.3kg, not 0.30000000000000004. */
  it('does not accumulate binary error across repeated counts', () => {
    const tenth = parseQuantity('0.1')!
    expect(tenth * 3).toBe(300)
    expect(formatQuantity(tenth * 3)).toBe('0.3')
  })
})

describe('formatQuantity', () => {
  it('drops trailing zeros but keeps real decimals', () => {
    expect(formatQuantity(2000)).toBe('2')
    expect(formatQuantity(2500)).toBe('2.5')
    expect(formatQuantity(2050)).toBe('2.05')
    expect(formatQuantity(0)).toBe('0')
  })

  it('writes the unit alongside', () => {
    expect(formatWithUnit(40_000, 'lb')).toBe('40 lb')
    expect(formatWithUnit(2500, 'kg')).toBe('2.5 kg')
  })
})

describe('purchase units against stock units', () => {
  /* The case this whole two-unit design exists for. */
  it('turns two 40lb cases into 80lb of stock', () => {
    const twoCases = 2 * 1000
    const fortyLbPerCase = 40 * 1000
    expect(purchaseToStock(twoCases, fortyLbPerCase)).toBe(80_000)
  })

  it('handles a fractional pack size', () => {
    /* A 2.5kg tin, bought three at a time. */
    expect(purchaseToStock(3000, 2500)).toBe(7500)
  })

  it('handles half a case', () => {
    expect(purchaseToStock(500, 40_000)).toBe(20_000)
  })

  it('round-trips back to purchase units', () => {
    const perCase = 40_000
    const stock = purchaseToStock(2000, perCase)
    expect(stockToPurchase(stock, perCase)).toBe(2000)
  })

  it('treats a missing pack size as zero rather than dividing by it', () => {
    expect(stockToPurchase(10_000, 0)).toBe(0)
    expect(costPerStockUnit(5000, 0)).toBe(0)
  })
})

describe('costPerStockUnit', () => {
  /* A $52 case of 40lb chicken is $1.30/lb — the basis of every later figure. */
  it('divides a case price by what is in the case', () => {
    expect(costPerStockUnit(5200, 40_000)).toBe(130)
  })

  it('handles a 20kg bag of basmati at $38', () => {
    expect(costPerStockUnit(3800, 20_000)).toBe(190)
  })

  it('rounds to the nearest cent rather than truncating', () => {
    /* $10 over 3 units is 333.33 cents. */
    expect(costPerStockUnit(1000, 3000)).toBe(333)
  })
})

describe('valueOf', () => {
  it('values stock on hand at its cost', () => {
    expect(valueOf(40_000, 130)).toBe(5200)
    expect(valueOf(2500, 190)).toBe(475)
  })

  it('values nothing as nothing', () => {
    expect(valueOf(0, 130)).toBe(0)
  })
})

describe('foodCostPercent', () => {
  it('reports cost as a share of takings', () => {
    expect(foodCostPercent(30_000, 100_000)).toBe(30)
    expect(foodCostPercent(28_500, 100_000)).toBe(28.5)
  })

  /* Zero would read as excellent; the truth is that it is not known. */
  it('is unknown rather than zero when there were no sales', () => {
    expect(foodCostPercent(30_000, 0)).toBeNull()
    expect(foodCostPercent(0, 0)).toBeNull()
  })
})

describe('daysOfCover', () => {
  it('says how long the shelf lasts at the current rate', () => {
    expect(daysOfCover(47_000, 12_000)).toBe(3.9)
    expect(daysOfCover(100_000, 10_000)).toBe(10)
  })

  it('is unknown when nothing has been used', () => {
    expect(daysOfCover(47_000, 0)).toBeNull()
  })
})
