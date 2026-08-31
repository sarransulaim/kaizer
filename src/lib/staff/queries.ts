import 'server-only'

import { asc, eq, isNull, and, sql } from 'drizzle-orm'

import { db } from '@/lib/db'
import { timeEntries, users } from '@/lib/db/schema'

export type StaffMember = {
  id: string
  name: string
  role: string
  phone: string | null
  hourlyRateCents: number
  active: boolean
  hasPin: boolean
  onShift: boolean
  /** Shifts recorded, so the UI can warn before anything destructive. */
  shiftCount: number
}

/** The roster, for the Settings screen. Includes people who are switched off. */
export async function getStaff(): Promise<StaffMember[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      phone: users.phone,
      hourlyRateCents: users.hourlyRateCents,
      active: users.active,
      pinHash: users.pinHash,
      openEntry: timeEntries.id,
      shiftCount: sql<number>`(
        SELECT COUNT(*)::int FROM ${timeEntries} WHERE ${timeEntries.userId} = ${users.id}
      )`,
    })
    .from(users)
    .leftJoin(
      timeEntries,
      and(eq(timeEntries.userId, users.id), isNull(timeEntries.clockOutAt)),
    )
    .orderBy(asc(users.active), asc(users.name))

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    phone: row.phone,
    hourlyRateCents: row.hourlyRateCents,
    active: row.active,
    hasPin: Boolean(row.pinHash),
    onShift: row.openEntry !== null,
    shiftCount: row.shiftCount,
  }))
}
