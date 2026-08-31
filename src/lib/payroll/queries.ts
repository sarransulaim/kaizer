import 'server-only'

import { and, asc, desc, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm'

import { db } from '@/lib/db'
import { timeEntries, users } from '@/lib/db/schema'
import { weekDates } from '@/lib/time'

import { minutesWorked, payCents } from './hours'

/* -------------------------------------------------------------------------- */
/*                                Time clock                                  */
/* -------------------------------------------------------------------------- */

export type ClockPerson = {
  id: string
  name: string
  role: string
  hasPin: boolean
  /** The open shift, if they are on the clock right now. */
  onSince: Date | null
  openEntryId: string | null
}

/**
 * Everyone who can clock in, with whether they currently are.
 *
 * Drives the kitchen tablet, so it deliberately carries no pay rates — that
 * screen is visible to everyone standing at it.
 */
export async function getClockBoard(): Promise<ClockPerson[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      pinHash: users.pinHash,
      entryId: timeEntries.id,
      clockInAt: timeEntries.clockInAt,
    })
    .from(users)
    .leftJoin(
      timeEntries,
      and(eq(timeEntries.userId, users.id), isNull(timeEntries.clockOutAt)),
    )
    .where(eq(users.active, true))
    .orderBy(asc(users.name))

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    hasPin: Boolean(row.pinHash),
    onSince: row.clockInAt ?? null,
    openEntryId: row.entryId ?? null,
  }))
}

/* -------------------------------------------------------------------------- */
/*                                  Payroll                                   */
/* -------------------------------------------------------------------------- */

export type PayrollShift = {
  id: string
  clockInAt: Date
  clockOutAt: Date | null
  minutes: number
  note: string | null
  edited: boolean
  /** Still on the clock — counted as zero until it is closed. */
  open: boolean
}

export type PayrollDay = {
  date: string
  minutes: number
  shifts: PayrollShift[]
}

export type PayrollPerson = {
  id: string
  name: string
  role: string
  hourlyRateCents: number
  days: PayrollDay[]
  totalMinutes: number
  payCents: number
  hasOpenShift: boolean
}

export type PayrollWeek = {
  monday: string
  dates: string[]
  people: PayrollPerson[]
  totalMinutes: number
  totalPayCents: number
  unpaidCount: number
}

/**
 * A Monday-to-Sunday timesheet for everyone on the payroll.
 *
 * An open shift contributes no minutes. Paying for a shift that has not ended
 * would mean the week's total changed every time the page was refreshed, and a
 * forgotten punch-out would quietly inflate someone's wages — so it shows as
 * open and waits to be closed or corrected.
 */
export async function getPayrollWeek(mondayIso: string): Promise<PayrollWeek> {
  const dates = weekDates(mondayIso)
  const sunday = dates[dates.length - 1]

  const [staff, entries] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        role: users.role,
        hourlyRateCents: users.hourlyRateCents,
      })
      .from(users)
      .where(eq(users.active, true))
      .orderBy(asc(users.name)),

    db
      .select({
        id: timeEntries.id,
        userId: timeEntries.userId,
        workDate: timeEntries.workDate,
        clockInAt: timeEntries.clockInAt,
        clockOutAt: timeEntries.clockOutAt,
        note: timeEntries.note,
        editedAt: timeEntries.editedAt,
      })
      .from(timeEntries)
      .where(
        and(gte(timeEntries.workDate, mondayIso), lte(timeEntries.workDate, sunday)),
      )
      .orderBy(asc(timeEntries.clockInAt)),
  ])

  /* Anyone with hours in the week is included even if they have since been
     deactivated — a week's wages do not disappear because someone left. */
  const known = new Map(staff.map((person) => [person.id, person]))
  const missingIds = [...new Set(entries.map((e) => e.userId))].filter(
    (id) => !known.has(id),
  )

  if (missingIds.length > 0) {
    const extra = await db
      .select({
        id: users.id,
        name: users.name,
        role: users.role,
        hourlyRateCents: users.hourlyRateCents,
      })
      .from(users)
      .where(eq(users.active, false))
      .orderBy(asc(users.name))

    for (const person of extra) {
      if (missingIds.includes(person.id)) known.set(person.id, person)
    }
  }

  const people: PayrollPerson[] = [...known.values()].map((person) => {
    const days: PayrollDay[] = dates.map((date) => {
      const shifts = entries
        .filter((entry) => entry.userId === person.id && entry.workDate === date)
        .map((entry) => {
          const open = entry.clockOutAt === null
          return {
            id: entry.id,
            clockInAt: entry.clockInAt,
            clockOutAt: entry.clockOutAt,
            minutes: open ? 0 : minutesWorked(entry.clockInAt, entry.clockOutAt!),
            note: entry.note,
            edited: entry.editedAt !== null,
            open,
          }
        })

      return {
        date,
        shifts,
        minutes: shifts.reduce((sum, shift) => sum + shift.minutes, 0),
      }
    })

    const totalMinutes = days.reduce((sum, day) => sum + day.minutes, 0)

    return {
      id: person.id,
      name: person.name,
      role: person.role,
      hourlyRateCents: person.hourlyRateCents,
      days,
      totalMinutes,
      payCents: payCents(totalMinutes, person.hourlyRateCents),
      hasOpenShift: days.some((day) => day.shifts.some((shift) => shift.open)),
    }
  })

  /* Someone with no hours and no rate is just noise on the sheet. */
  const visible = people.filter(
    (person) => person.totalMinutes > 0 || person.hourlyRateCents > 0 || person.hasOpenShift,
  )

  return {
    monday: mondayIso,
    dates,
    people: visible,
    totalMinutes: visible.reduce((sum, person) => sum + person.totalMinutes, 0),
    totalPayCents: visible.reduce((sum, person) => sum + person.payCents, 0),
    unpaidCount: visible.filter((person) => person.hourlyRateCents <= 0).length,
  }
}

/** Recent shifts for one person, for the correction screen. */
export async function getRecentEntries(userId: string, limit = 20) {
  return db
    .select()
    .from(timeEntries)
    .where(eq(timeEntries.userId, userId))
    .orderBy(desc(timeEntries.clockInAt))
    .limit(limit)
}

/**
 * Minutes a worker has banked in the week containing `mondayIso`.
 *
 * Shown on the kitchen tablet after a successful punch. Minutes are rounded per
 * shift and then summed — the same order the payroll sheet uses — because
 * rounding the total instead would let the tablet and the timesheet disagree by
 * a minute, and the first person to notice would be the one being paid.
 *
 * Open shifts contribute nothing, matching the payroll page: time is counted
 * once it has been finished.
 */
export async function getWeekMinutesForUser(
  userId: string,
  mondayIso: string,
): Promise<number> {
  const dates = weekDates(mondayIso)
  const sunday = dates[dates.length - 1]

  const rows = await db
    .select({
      clockInAt: timeEntries.clockInAt,
      clockOutAt: timeEntries.clockOutAt,
    })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, userId),
        gte(timeEntries.workDate, mondayIso),
        lte(timeEntries.workDate, sunday),
        isNotNull(timeEntries.clockOutAt),
      ),
    )

  return rows.reduce(
    (sum, row) => sum + minutesWorked(row.clockInAt, row.clockOutAt!),
    0,
  )
}
