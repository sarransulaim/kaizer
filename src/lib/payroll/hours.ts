/**
 * Payroll arithmetic, kept pure and in one place.
 *
 * Everything here works in whole minutes and integer cents. Hours are only ever
 * a display format — computing pay from a floating-point hour count is how a
 * timesheet ends up a cent short of what the worker calculated on their phone.
 */

/** Minutes worked between two instants, rounded to the nearest whole minute. */
export function minutesWorked(clockInAt: Date, clockOutAt: Date): number {
  const ms = clockOutAt.getTime() - clockInAt.getTime()
  return ms <= 0 ? 0 : Math.round(ms / 60_000)
}

/**
 * What a stretch of minutes is worth.
 *
 * Every hour is paid at the same rate — the flat-rate rule the owner chose. If
 * overtime is ever switched on, this is the only function that has to change:
 * nothing else in the app multiplies a rate by an hour count.
 */
export function payCents(minutes: number, hourlyRateCents: number): number {
  if (minutes <= 0 || hourlyRateCents <= 0) return 0
  return Math.round((minutes / 60) * hourlyRateCents)
}

/** 390 -> "6h 30m", 60 -> "1h", 0 -> "—" */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '—'

  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60

  if (hours === 0) return `${rest}m`
  if (rest === 0) return `${hours}h`
  return `${hours}h ${rest}m`
}

/** 390 -> "6.50" — the decimal form payroll services and accountants expect. */
export function decimalHours(minutes: number): string {
  return (minutes / 60).toFixed(2)
}
