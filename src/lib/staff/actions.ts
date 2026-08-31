'use server'

import { and, eq, isNull, ne } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireSession } from '@/lib/auth/guard'
import { db } from '@/lib/db'
import { timeEntries, userRoleEnum, users } from '@/lib/db/schema'

import { hashPin, isValidPinFormat } from './pin'

export type StaffResult = { ok: true } | { ok: false; error: string }

const DENIED: StaffResult = { ok: false, error: 'Not signed in' }

const staffSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  role: z.enum(userRoleEnum.enumValues),
  /** Dollars per hour, as typed. Stored in cents. */
  hourlyRateCents: z.number().int().min(0).max(100_000),
  phone: z.string().trim().max(40).optional(),
})

function revalidateStaff() {
  revalidatePath('/settings')
  revalidatePath('/payroll')
  revalidatePath('/kitchen')
}

async function allowed(): Promise<boolean> {
  try {
    await requireSession()
    return true
  } catch {
    return false
  }
}

export async function createStaff(input: {
  name: string
  role: 'owner' | 'manager' | 'kitchen' | 'driver'
  hourlyRateCents: number
  phone?: string
  pin?: string
}): Promise<StaffResult> {
  if (!(await allowed())) return DENIED

  const parsed = staffSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the fields' }
  }

  if (input.pin && !isValidPinFormat(input.pin)) {
    return { ok: false, error: 'A PIN must be exactly 4 digits' }
  }

  try {
    await db.insert(users).values({
      name: parsed.data.name,
      role: parsed.data.role,
      hourlyRateCents: parsed.data.hourlyRateCents,
      phone: parsed.data.phone || null,
      /* Kitchen staff are identified by name and PIN; an address is optional
         and stays null rather than being invented, which the unique index on
         email allows any number of. */
      email: null,
      pinHash: input.pin ? hashPin(input.pin) : null,
    })

    revalidateStaff()
    return { ok: true }
  } catch (error) {
    console.error('[createStaff]', error)
    return { ok: false, error: 'Could not add that person' }
  }
}

export async function updateStaff(input: {
  userId: string
  name: string
  role: 'owner' | 'manager' | 'kitchen' | 'driver'
  hourlyRateCents: number
  phone?: string
}): Promise<StaffResult> {
  if (!(await allowed())) return DENIED

  const parsed = staffSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the fields' }
  }

  try {
    await db
      .update(users)
      .set({
        name: parsed.data.name,
        role: parsed.data.role,
        hourlyRateCents: parsed.data.hourlyRateCents,
        phone: parsed.data.phone || null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, input.userId))

    revalidateStaff()
    return { ok: true }
  } catch (error) {
    console.error('[updateStaff]', error)
    return { ok: false, error: 'Could not save those changes' }
  }
}

export async function setStaffPin(
  userId: string,
  pin: string,
): Promise<StaffResult> {
  if (!(await allowed())) return DENIED

  if (!isValidPinFormat(pin)) {
    return { ok: false, error: 'A PIN must be exactly 4 digits' }
  }

  try {
    await db
      .update(users)
      .set({ pinHash: hashPin(pin), updatedAt: new Date() })
      .where(eq(users.id, userId))

    revalidateStaff()
    return { ok: true }
  } catch (error) {
    console.error('[setStaffPin]', error)
    return { ok: false, error: 'Could not set that PIN' }
  }
}

/**
 * Take someone off the roster without deleting them.
 *
 * Their past shifts stay on the timesheet — a week already worked is still owed
 * whether or not the person still works here — so this only removes them from
 * the clock-in list.
 */
export async function setStaffActive(
  userId: string,
  active: boolean,
): Promise<StaffResult> {
  if (!(await allowed())) return DENIED

  try {
    if (!active) {
      const open = await db.query.timeEntries.findFirst({
        where: and(eq(timeEntries.userId, userId), isNull(timeEntries.clockOutAt)),
      })
      if (open) {
        return {
          ok: false,
          error: 'They are still clocked in. Close the shift on the payroll page first.',
        }
      }

      const others = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.active, true), ne(users.id, userId)))
        .limit(1)

      if (others.length === 0) {
        return { ok: false, error: 'That is the last active person on the roster.' }
      }
    }

    await db
      .update(users)
      .set({ active, updatedAt: new Date() })
      .where(eq(users.id, userId))

    revalidateStaff()
    return { ok: true }
  } catch (error) {
    console.error('[setStaffActive]', error)
    return { ok: false, error: 'Could not change that' }
  }
}
