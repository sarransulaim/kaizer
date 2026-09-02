import { describe, expect, it } from 'vitest'

import {
  decimalHours,
  formatMinutes,
  minutesWorked,
  payCents,
} from '@/lib/payroll/hours'

describe('minutesWorked', () => {
  const at = (hours: number, minutes = 0) =>
    new Date(Date.UTC(2026, 8, 1, hours, minutes))

  it('counts a whole shift', () => {
    expect(minutesWorked(at(9), at(17))).toBe(480)
  })

  it('rounds to the nearest minute', () => {
    const start = new Date(Date.UTC(2026, 8, 1, 9, 0, 0))
    const end = new Date(Date.UTC(2026, 8, 1, 9, 30, 29))
    expect(minutesWorked(start, end)).toBe(30)

    const later = new Date(Date.UTC(2026, 8, 1, 9, 30, 31))
    expect(minutesWorked(start, later)).toBe(31)
  })

  it('treats a shift that ends before it starts as zero, not negative', () => {
    expect(minutesWorked(at(17), at(9))).toBe(0)
  })

  it('handles a shift crossing midnight', () => {
    const start = new Date(Date.UTC(2026, 8, 1, 22, 0))
    const end = new Date(Date.UTC(2026, 8, 2, 2, 30))
    expect(minutesWorked(start, end)).toBe(270)
  })
})

describe('payCents', () => {
  it('pays a whole hour at the rate', () => {
    expect(payCents(60, 2000)).toBe(2000)
  })

  it('pays a part hour proportionally', () => {
    expect(payCents(90, 2000)).toBe(3000)
    expect(payCents(30, 2000)).toBe(1000)
  })

  /* The case that matters: a third of an hour at an odd rate lands between
     cents, and must not silently truncate against the worker. */
  it('rounds to the nearest cent rather than truncating', () => {
    expect(payCents(20, 1750)).toBe(583)
    expect(payCents(1, 2000)).toBe(33)
  })

  it('pays nothing when there is no rate or no time', () => {
    expect(payCents(480, 0)).toBe(0)
    expect(payCents(0, 2000)).toBe(0)
    expect(payCents(-10, 2000)).toBe(0)
  })

  it('is flat — the fortieth hour pays the same as the first', () => {
    const week = payCents(45 * 60, 2000)
    expect(week).toBe(45 * 2000)
  })

  /* Summing per shift and paying once must agree with paying each shift, or
     the tablet and the payroll sheet would disagree. */
  it('agrees whether shifts are summed before or after', () => {
    const shifts = [313, 187, 62]
    const summedFirst = payCents(
      shifts.reduce((a, b) => a + b, 0),
      1850,
    )
    const eachThenSummed = shifts.reduce(
      (total, minutes) => total + payCents(minutes, 1850),
      0,
    )
    expect(Math.abs(summedFirst - eachThenSummed)).toBeLessThanOrEqual(2)
  })
})

describe('formatMinutes', () => {
  it('reads as hours and minutes', () => {
    expect(formatMinutes(390)).toBe('6h 30m')
    expect(formatMinutes(60)).toBe('1h')
    expect(formatMinutes(45)).toBe('45m')
    expect(formatMinutes(1440)).toBe('24h')
  })

  it('shows nothing worked as a dash', () => {
    expect(formatMinutes(0)).toBe('—')
    expect(formatMinutes(-5)).toBe('—')
  })
})

describe('decimalHours', () => {
  it('gives the form a payroll service expects', () => {
    expect(decimalHours(390)).toBe('6.50')
    expect(decimalHours(60)).toBe('1.00')
    expect(decimalHours(20)).toBe('0.33')
  })
})
