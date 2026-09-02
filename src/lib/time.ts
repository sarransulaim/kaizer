import { DateTime } from 'luxon'

import { BUSINESS, DAY_CHIP_COUNT } from './config'

const ZONE = BUSINESS.timezone

/**
 * All date/time handling funnels through this module.
 *
 * The rule: the database stores `service_date` (a local calendar date) and
 * `service_time` (a local clock time) exactly as the business thinks of them,
 * plus `service_at`, the absolute instant those two resolve to in the business
 * timezone. Nothing else in the app should be doing timezone arithmetic.
 */

/**
 * Whether a string is a real calendar date.
 *
 * Dates reach this app from query strings, which anyone signed in can type
 * by hand. `2026-02-31` matches the shape and is not a date, so the pattern
 * alone is not enough — Luxon's own validity check is the point.
 */
export function isIsoDate(value: string | undefined | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return DateTime.fromISO(value, { zone: ZONE }).isValid
}

/** Today's calendar date in the business timezone, as `YYYY-MM-DD`. */
export function today(): string {
  return DateTime.now().setZone(ZONE).toISODate()!
}

/** `YYYY-MM-DD` for N days from today in the business timezone. */
export function addDays(isoDate: string, days: number): string {
  return DateTime.fromISO(isoDate, { zone: ZONE }).plus({ days }).toISODate()!
}

/**
 * Combine a local calendar date and clock time into the exact instant they
 * represent in the business timezone. This is the DST-safe conversion — 6:00pm
 * stays 6:00pm on both sides of a clock change.
 */
export function toServiceInstant(isoDate: string, timeStr: string): Date {
  const [hour, minute] = timeStr.split(':').map(Number)
  return DateTime.fromISO(isoDate, { zone: ZONE })
    .set({ hour: hour ?? 0, minute: minute ?? 0, second: 0, millisecond: 0 })
    .toJSDate()
}

/** "6:00 PM" */
export function formatTime(timeStr: string): string {
  const [hour, minute] = timeStr.split(':').map(Number)
  return DateTime.fromObject({ hour: hour ?? 0, minute: minute ?? 0 }, { zone: ZONE })
    .toFormat('h:mm a')
}

/** "Sat, Aug 23" */
export function formatDate(isoDate: string): string {
  return DateTime.fromISO(isoDate, { zone: ZONE }).toFormat('ccc, LLL d')
}

/** "Saturday, August 23" */
export function formatDateLong(isoDate: string): string {
  return DateTime.fromISO(isoDate, { zone: ZONE }).toFormat('cccc, LLLL d')
}

/** "Today" / "Tomorrow" / "Saturday" / "Sat, Aug 30" for anything further out. */
export function dayLabel(isoDate: string): string {
  const target = DateTime.fromISO(isoDate, { zone: ZONE }).startOf('day')
  const now = DateTime.now().setZone(ZONE).startOf('day')
  const diff = Math.round(target.diff(now, 'days').days)

  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff > 1 && diff < 7) return target.toFormat('cccc')
  return target.toFormat('ccc, LLL d')
}

/** "in 2h 15m" / "25m ago" — relative to now, for the today board. */
export function relativeToNow(instant: Date): string {
  const target = DateTime.fromJSDate(instant).setZone(ZONE)
  const minutes = Math.round(target.diffNow('minutes').minutes)
  const abs = Math.abs(minutes)

  if (abs < 1) return 'now'

  const hours = Math.floor(abs / 60)
  const mins = abs % 60
  const parts = hours > 0 ? `${hours}h${mins > 0 ? ` ${mins}m` : ''}` : `${mins}m`

  return minutes > 0 ? `in ${parts}` : `${parts} ago`
}

/** Minutes until the given instant. Negative once it's passed. */
export function minutesUntil(instant: Date): number {
  return Math.round(DateTime.fromJSDate(instant).diffNow('minutes').minutes)
}

/**
 * The next `count` calendar days, starting with today. Surfaced as one-tap
 * chips on the order form and the prep sheet. The kitchen serves every day of
 * the week, so every day is offered and typing a date is the exception.
 */
export function upcomingDays(
  count = DAY_CHIP_COUNT,
): { date: string; label: string }[] {
  const start = DateTime.now().setZone(ZONE).startOf('day')

  return Array.from({ length: Math.max(count, 0) }, (_, offset) => {
    const iso = start.plus({ days: offset }).toISODate()!
    return { date: iso, label: dayLabel(iso) }
  })
}

/** First day of the current month in the business timezone, as `YYYY-MM-DD`. */
export function startOfMonth(): string {
  return DateTime.now().setZone(ZONE).startOf('month').toISODate()!
}

/** Last day of the current month in the business timezone, as `YYYY-MM-DD`. */
export function endOfMonth(): string {
  return DateTime.now().setZone(ZONE).endOf('month').toISODate()!
}

/** "August 2026" — the heading for month-to-date figures. */
export function monthLabel(): string {
  return DateTime.now().setZone(ZONE).toFormat('LLLL yyyy')
}

/** "23" — the day number alone, for a dense axis where the month is in the title. */
export function dayOfMonth(isoDate: string): string {
  return DateTime.fromISO(isoDate, { zone: ZONE }).toFormat('d')
}

/** "Aug 23" */
export function shortDate(isoDate: string): string {
  return DateTime.fromISO(isoDate, { zone: ZONE }).toFormat('LLL d')
}

/** Current local clock time as `HH:mm`, for defaulting form inputs. */
export function currentTimeValue(): string {
  return DateTime.now().setZone(ZONE).toFormat('HH:mm')
}

/** Normalize a `HH:mm` or `HH:mm:ss` string to `HH:mm` for form inputs. */
export function toTimeInputValue(timeStr: string): string {
  return timeStr.slice(0, 5)
}

/* -------------------------------------------------------------------------- */
/*                                   Weeks                                    */
/* -------------------------------------------------------------------------- */

/**
 * The Monday of the week containing `isoDate` (today if omitted).
 *
 * Luxon already treats Monday as the first day of the week, which happens to be
 * how the payroll week is counted here — Monday through Sunday.
 */
export function startOfWeek(isoDate?: string): string {
  /* A nonsense `?week=` should show the current week rather than render a
     sheet full of "Invalid DateTime". */
  const base = isIsoDate(isoDate)
    ? DateTime.fromISO(isoDate, { zone: ZONE })
    : DateTime.now().setZone(ZONE)
  return base.startOf('week').toISODate()!
}

/** The seven ISO dates of the week beginning on `mondayIso`. */
export function weekDates(mondayIso: string): string[] {
  const monday = isIsoDate(mondayIso)
    ? DateTime.fromISO(mondayIso, { zone: ZONE })
    : DateTime.now().setZone(ZONE).startOf('week')
  return Array.from({ length: 7 }, (_, i) => monday.plus({ days: i }).toISODate()!)
}

/** "Aug 25 – Aug 31", or "Aug 25 – Sep 1" across a month boundary. */
export function weekRangeLabel(mondayIso: string): string {
  const monday = DateTime.fromISO(mondayIso, { zone: ZONE })
  const sunday = monday.plus({ days: 6 })
  return `${monday.toFormat('LLL d')} – ${sunday.toFormat('LLL d')}`
}

/** "Mon", for the payroll column headers. */
export function weekdayShort(isoDate: string): string {
  return DateTime.fromISO(isoDate, { zone: ZONE }).toFormat('ccc')
}

/** The local calendar date an instant falls on, in the business timezone. */
export function dateOf(instant: Date): string {
  return DateTime.fromJSDate(instant).setZone(ZONE).toISODate()!
}

/** "6:04 PM" for an absolute instant, in the business timezone. */
export function formatInstantTime(instant: Date): string {
  return DateTime.fromJSDate(instant).setZone(ZONE).toFormat('h:mm a')
}

/** `HH:mm` for an instant, for pre-filling a time input. */
export function instantToTimeValue(instant: Date): string {
  return DateTime.fromJSDate(instant).setZone(ZONE).toFormat('HH:mm')
}
