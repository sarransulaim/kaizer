import { eq } from 'drizzle-orm'

import { db } from './db'
import { users, type User } from './db/schema'

/**
 * The single seam between "no auth" and "auth".
 *
 * Authentication is deliberately switched off for now, but every write in the
 * app still resolves an actor through this function and stamps it onto
 * `created_by` / `updated_by` / `order_events`. That means the audit trail is
 * complete from the first order rather than starting blank — history can't be
 * reconstructed later, so it's recorded from the beginning.
 *
 * To turn auth on: read the session here and return the matching user. Nothing
 * else in the app changes, and no migration or backfill is needed.
 */

const OWNER_EMAIL = 'sulaimsarran@gmail.com'

let cached: User | null = null

export async function getCurrentActor(): Promise<User> {
  if (cached) return cached

  const [owner] = await db
    .select()
    .from(users)
    .where(eq(users.email, OWNER_EMAIL))
    .limit(1)

  if (!owner) {
    throw new Error(
      `No owner user found (${OWNER_EMAIL}). Run \`npm run db:seed\` to create it.`,
    )
  }

  cached = owner
  return owner
}

/** Placeholder for role checks once auth is live. Everything is permitted now. */
export async function requireRole(
  ..._roles: User['role'][]
): Promise<User> {
  return getCurrentActor()
}
