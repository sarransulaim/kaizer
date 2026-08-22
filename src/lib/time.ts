import { DateTime } from 'luxon'

import { BUSINESS } from './config'

const ZONE = BUSINESS.timezone

/**
 * All date/time handling funnels through this module.
 *
 * The rule: the database stores `service_date` (a local calendar date) and
 * `service_time` (a local clock time) exactly as the business thinks of them,
 * plus `service_at`, the absolute instant those two resolve to in the business
 * timezone. Nothing else in the app should be doing timezone arithmetic.
 */

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

/** Weekday number, Mon=1 … Sun=7. */
export function weekdayOf(isoDate: string): number {
  return DateTime.fromISO(isoDate, { zone: ZONE }).weekday
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
 * The next few service days (Fri/Sat/Sun), starting from today. Surfaced as
 * one-tap chips on the order form — the overwhelming majority of orders are
 * for the coming weekend, so typing a date should be the exception.
 */
export function upcomingServiceDates(count = 4): { date: string; label: string }[] {
  const results: { date: string; label: string }[] = []
  let cursor = DateTime.now().setZone(ZONE).startOf('day')

  for (let i = 0; results.length < count && i < 21; i++) {
    if (BUSINESS.serviceDays.includes(cursor.weekday)) {
      const iso = cursor.toISODate()!
      results.push({ date: iso, label: dayLabel(iso) })
    }
    cursor = cursor.plus({ days: 1 })
  }

  return results
}

/** Current local clock time as `HH:mm`, for defaulting form inputs. */
export function currentTimeValue(): string {
  return DateTime.now().setZone(ZONE).toFormat('HH:mm')
}

/** Normalize a `HH:mm` or `HH:mm:ss` string to `HH:mm` for form inputs. */
export function toTimeInputValue(timeStr: string): string {
  return timeStr.slice(0, 5)
}
