'use server'

import { and, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { getCurrentActor } from '@/lib/actor'
import { requireSession } from '@/lib/auth/guard'
import { db } from '@/lib/db'
import { payrollPayments, timeEntries, users } from '@/lib/db/schema'
import { isValidPinFormat, verifyPin } from '@/lib/staff/pin'
import {
  addDays,
  dateOf,
  formatInstantTime,
  startOfWeek,
  today,
  toServiceInstant,
  weekdayShort,
} from '@/lib/time'

import { minutesWorked } from './hours'
import { getPayrollWeek, getWeekBreakdownForUser, getWeekMinutesForUser } from './queries'

export type PunchDay = {
  date: string
  /** "Mon" — resolved here so the browser never re-derives it in another zone. */
  weekday: string
  minutes: number
  open: boolean
  isToday: boolean
}

export type PunchResult =
  | {
      ok: true
      action: 'in' | 'out'
      name: string
      at: string
      /** Length of the shift just closed, on a punch out. */
      minutes?: number
      /**
       * Hours banked so far this week. Deliberately hours only — the kitchen
       * tablet is in view of everyone standing at it, and what someone earns is
       * not the room's business.
       */
      weekMinutes: number
      /**
       * Last week's total, carried so the tablet can explain an empty week.
       * The payroll week runs Monday to Sunday, so anyone punching in early in
       * the week sees a zero that is correct but looks like lost hours — the
       * previous week is both the reassurance and the number they are about to
       * be paid for.
       */
      lastWeekMinutes: number
      /** "4:50 PM", the moment recorded. */
      atLabel: string
      /** The week day by day, so the worker can see where the hours went. */
      week: PunchDay[]
    }
  | { ok: false; error: string }

function revalidateClock() {
  revalidatePath('/kitchen')
  revalidatePath('/payroll')
}

/* -------------------------------------------------------------------------- */
/*                          Punching (kitchen, public)                        */
/* -------------------------------------------------------------------------- */

/**
 * Clock a worker in or out.
 *
 * Deliberately callable without the office passcode — the tablet by the pass
 * has no login — so the PIN is the only thing standing between a worker and
 * someone else's timesheet, and it is checked here on the server every time.
 *
 * Which direction the punch goes is decided from the database rather than from
 * anything the client says, so a stale tablet showing an out-of-date button
 * cannot open a second shift or close one twice.
 */
export async function punch(userId: string, pin: string): Promise<PunchResult> {
  if (!isValidPinFormat(pin)) {
    return { ok: false, error: 'Enter your 4-digit PIN' }
  }

  try {
    const worker = await db.query.users.findFirst({ where: eq(users.id, userId) })

    if (!worker || !worker.active) {
      return { ok: false, error: 'That person is not on the staff list' }
    }
    if (!worker.pinHash) {
      return { ok: false, error: `${worker.name} has no PIN set yet. Ask the owner.` }
    }
    if (!verifyPin(pin, worker.pinHash)) {
      /* Slow a guesser down without making an honest mistype feel broken. */
      await new Promise((resolve) => setTimeout(resolve, 400))
      return { ok: false, error: 'That PIN is not right' }
    }

    const now = new Date()

    const open = await db.query.timeEntries.findFirst({
      where: and(eq(timeEntries.userId, userId), isNull(timeEntries.clockOutAt)),
    })

    if (open) {
      const minutes = minutesWorked(open.clockInAt, now)

      await db
        .update(timeEntries)
        .set({ clockOutAt: now, updatedAt: now })
        .where(eq(timeEntries.id, open.id))

      /* Read after the write so the shift just finished is included. */
      const summary = await weekSummaryFor(userId)

      revalidateClock()
      return {
        ok: true,
        action: 'out',
        name: worker.name,
        at: now.toISOString(),
        atLabel: formatInstantTime(now),
        minutes,
        ...summary,
      }
    }

    await db.insert(timeEntries).values({
      userId,
      clockInAt: now,
      workDate: dateOf(now),
    })

    /* The shift that just opened counts nothing yet, so this is what they had
       banked walking in. */
    const summary = await weekSummaryFor(userId)

    revalidateClock()
    return {
      ok: true,
      action: 'in',
      name: worker.name,
      at: now.toISOString(),
      atLabel: formatInstantTime(now),
      ...summary,
    }
  } catch (error) {
    /* The one-open-shift-per-worker index rejects a double tap outright, which
       is the correct outcome — report it as already being on the clock rather
       than as a failure. */
    if (error instanceof Error && error.message.includes('time_entries_one_open_per_user')) {
      return { ok: false, error: 'You are already clocked in. Refresh and try again.' }
    }

    console.error('[punch]', error)
    return { ok: false, error: 'Could not record that. Try again.' }
  }
}

/**
 * This week day by day, plus last week's total.
 *
 * Last week is carried because the payroll week starts on Monday: anyone
 * punching in early in it sees a zero that is correct but looks like lost
 * hours, and the previous week is the number they are about to be paid for.
 */
async function weekSummaryFor(userId: string) {
  const monday = startOfWeek()
  const now = today()

  const [week, lastWeekMinutes] = await Promise.all([
    getWeekBreakdownForUser(userId, monday),
    getWeekMinutesForUser(userId, addDays(monday, -7)),
  ])

  return {
    weekMinutes: week.totalMinutes,
    lastWeekMinutes,
    week: week.days.map((day) => ({
      date: day.date,
      weekday: weekdayShort(day.date),
      minutes: day.minutes,
      open: day.open,
      isToday: day.date === now,
    })),
  }
}

/* -------------------------------------------------------------------------- */
/*                        Corrections (office, gated)                         */
/* -------------------------------------------------------------------------- */

export type EntryResult = { ok: true } | { ok: false; error: string }

const DENIED: EntryResult = { ok: false, error: 'Not signed in' }

/**
 * Fix a punch by hand.
 *
 * Forgotten punch-outs are certain, so this is not an edge case — it is part of
 * running the week. Every correction stamps who made it and when, because a
 * timesheet that was quietly altered is worth very little in a disagreement
 * about wages.
 */
export async function updateEntry(input: {
  entryId: string
  date: string
  clockInTime: string
  clockOutTime: string | null
  note: string | null
}): Promise<EntryResult> {
  if (!(await isAllowed())) return DENIED

  try {
    const actor = await getCurrentActor()

    const clockInAt = toServiceInstant(input.date, input.clockInTime)
    const clockOutAt = input.clockOutTime
      ? toServiceInstant(input.date, input.clockOutTime)
      : null

    if (clockOutAt && clockOutAt.getTime() <= clockInAt.getTime()) {
      /* A shift running past midnight is real; one ending before it started is
         a typo. Roll the end forward a day rather than rejecting it outright. */
      clockOutAt.setDate(clockOutAt.getDate() + 1)
    }

    await db
      .update(timeEntries)
      .set({
        clockInAt,
        clockOutAt,
        workDate: input.date,
        note: input.note?.trim() || null,
        editedById: actor.id,
        editedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(timeEntries.id, input.entryId))

    revalidateClock()
    return { ok: true }
  } catch (error) {
    console.error('[updateEntry]', error)
    return { ok: false, error: 'Could not save that change' }
  }
}

export async function addEntry(input: {
  userId: string
  date: string
  clockInTime: string
  clockOutTime: string
  note: string | null
}): Promise<EntryResult> {
  if (!(await isAllowed())) return DENIED

  try {
    const actor = await getCurrentActor()

    const clockInAt = toServiceInstant(input.date, input.clockInTime)
    const clockOutAt = toServiceInstant(input.date, input.clockOutTime)
    if (clockOutAt.getTime() <= clockInAt.getTime()) {
      clockOutAt.setDate(clockOutAt.getDate() + 1)
    }

    await db.insert(timeEntries).values({
      userId: input.userId,
      clockInAt,
      clockOutAt,
      workDate: input.date,
      note: input.note?.trim() || null,
      editedById: actor.id,
      editedAt: new Date(),
    })

    revalidateClock()
    return { ok: true }
  } catch (error) {
    console.error('[addEntry]', error)
    return { ok: false, error: 'Could not add that shift' }
  }
}

export async function deleteEntry(entryId: string): Promise<EntryResult> {
  if (!(await isAllowed())) return DENIED

  try {
    await db.delete(timeEntries).where(eq(timeEntries.id, entryId))
    revalidateClock()
    return { ok: true }
  } catch (error) {
    console.error('[deleteEntry]', error)
    return { ok: false, error: 'Could not remove that shift' }
  }
}

/** Close a shift someone left open, at a time the owner supplies. */
export async function closeOpenShift(
  entryId: string,
  clockOutTime: string,
): Promise<EntryResult> {
  if (!(await isAllowed())) return DENIED

  try {
    const entry = await db.query.timeEntries.findFirst({
      where: eq(timeEntries.id, entryId),
    })
    if (!entry) return { ok: false, error: 'That shift no longer exists' }

    const actor = await getCurrentActor()
    const clockOutAt = toServiceInstant(entry.workDate, clockOutTime)
    if (clockOutAt.getTime() <= entry.clockInAt.getTime()) {
      clockOutAt.setDate(clockOutAt.getDate() + 1)
    }

    await db
      .update(timeEntries)
      .set({
        clockOutAt,
        editedById: actor.id,
        editedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(timeEntries.id, entryId))

    revalidateClock()
    return { ok: true }
  } catch (error) {
    console.error('[closeOpenShift]', error)
    return { ok: false, error: 'Could not close that shift' }
  }
}

/* -------------------------------------------------------------------------- */
/*                              Marking paid                                  */
/* -------------------------------------------------------------------------- */

/**
 * Settle one worker for one week.
 *
 * The amount and hours are read from the sheet and stored, rather than being
 * recomputed whenever the page is opened. A shift corrected next week changes
 * what the week is worth, and the record of what was actually handed over has
 * to survive that — otherwise the page quietly rewrites a payment that already
 * happened.
 */
export async function markWeekPaid(
  userId: string,
  weekStart: string,
  note?: string,
): Promise<EntryResult> {
  if (!(await isAllowed())) return DENIED

  try {
    const actor = await getCurrentActor()
    const week = await getPayrollWeek(weekStart)
    const person = week.people.find((entry) => entry.id === userId)

    if (!person) {
      return { ok: false, error: 'That person has nothing on this week' }
    }

    await db
      .insert(payrollPayments)
      .values({
        userId,
        weekStart,
        amountCents: person.payCents,
        minutes: person.totalMinutes,
        note: note?.trim() || null,
        markedById: actor.id,
      })
      /* Marking an already-settled week again should refresh the figure
         rather than fail, since the usual reason for doing it is that the
         hours were corrected first. */
      .onConflictDoUpdate({
        target: [payrollPayments.userId, payrollPayments.weekStart],
        set: {
          amountCents: person.payCents,
          minutes: person.totalMinutes,
          note: note?.trim() || null,
          markedById: actor.id,
          paidAt: new Date(),
          updatedAt: new Date(),
        },
      })

    revalidatePath('/payroll')
    return { ok: true }
  } catch (error) {
    console.error('[markWeekPaid]', error)
    return { ok: false, error: 'Could not mark that as paid' }
  }
}

/** Undo a payment marked by mistake. */
export async function unmarkWeekPaid(
  userId: string,
  weekStart: string,
): Promise<EntryResult> {
  if (!(await isAllowed())) return DENIED

  try {
    await db
      .delete(payrollPayments)
      .where(
        and(
          eq(payrollPayments.userId, userId),
          eq(payrollPayments.weekStart, weekStart),
        ),
      )

    revalidatePath('/payroll')
    return { ok: true }
  } catch (error) {
    console.error('[unmarkWeekPaid]', error)
    return { ok: false, error: 'Could not undo that' }
  }
}

async function isAllowed(): Promise<boolean> {
  try {
    await requireSession()
    return true
  } catch {
    return false
  }
}
