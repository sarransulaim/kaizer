import { describe, expect, it } from 'vitest'

import {
  addDays,
  isIsoDate,
  startOfWeek,
  toServiceInstant,
  weekDates,
  weekdayShort,
} from '@/lib/time'

describe('isIsoDate', () => {
  it('accepts a real date', () => {
    expect(isIsoDate('2026-08-31')).toBe(true)
    expect(isIsoDate('2024-02-29')).toBe(true)
  })

  /* These reach the app from query strings anyone signed in can type. The
     shape check alone lets the second one through, and Postgres rejects it. */
  it('rejects nonsense and impossible dates', () => {
    expect(isIsoDate('banana')).toBe(false)
    expect(isIsoDate('2026-02-31')).toBe(false)
    expect(isIsoDate('9999-99-99')).toBe(false)
    expect(isIsoDate('2026-8-3')).toBe(false)
    expect(isIsoDate('')).toBe(false)
    expect(isIsoDate(undefined)).toBe(false)
    expect(isIsoDate(null)).toBe(false)
  })
})

describe('the payroll week', () => {
  it('starts on Monday', () => {
    /* 2026-08-31 is a Monday; 2026-09-06 the Sunday that closes it. */
    expect(startOfWeek('2026-08-31')).toBe('2026-08-31')
    expect(startOfWeek('2026-09-06')).toBe('2026-08-31')
    expect(startOfWeek('2026-09-02')).toBe('2026-08-31')
  })

  it('rolls to the next week on Monday, not on Sunday', () => {
    expect(startOfWeek('2026-09-07')).toBe('2026-09-07')
  })

  it('falls back to the current week rather than rendering nonsense', () => {
    const thisWeek = startOfWeek()
    expect(startOfWeek('banana')).toBe(thisWeek)
    expect(startOfWeek('2026-02-31')).toBe(thisWeek)
  })

  it('lists seven days, Monday to Sunday', () => {
    const dates = weekDates('2026-08-31')
    expect(dates).toHaveLength(7)
    expect(dates[0]).toBe('2026-08-31')
    expect(dates[6]).toBe('2026-09-06')
    expect(dates.map(weekdayShort)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ])
  })

  it('crosses a month boundary without gaps', () => {
    const dates = weekDates('2026-08-31')
    expect(dates).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
    ])
  })
})

describe('addDays', () => {
  it('moves forward and back across months', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31')
    expect(addDays('2026-08-31', -7)).toBe('2026-08-24')
  })

  it('handles a leap day', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01')
  })
})

describe('toServiceInstant', () => {
  /**
   * The reason service time is stored as a local date plus a clock time and
   * resolved through the business timezone: 6pm has to stay 6pm on both sides
   * of a daylight-saving change, which a fixed offset would not manage.
   */
  it('keeps 6pm at 6pm across the autumn clock change', () => {
    const before = toServiceInstant('2026-10-31', '18:00')
    const after = toServiceInstant('2026-11-07', '18:00')

    const hourIn = (instant: Date) =>
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: 'America/New_York',
      }).format(instant)

    expect(hourIn(before)).toBe('18')
    expect(hourIn(after)).toBe('18')
    /* And they are genuinely different offsets, not the same instant. */
    expect(after.getTime() - before.getTime()).toBe(7 * 24 * 3600_000 + 3600_000)
  })
})
