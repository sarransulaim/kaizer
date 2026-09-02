import 'server-only'

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'

import { db } from '@/lib/db'
import { appSettings } from '@/lib/db/schema'

import { passcodeMatches } from './session'

/**
 * The office passcode, once it can be changed from inside the app.
 *
 * It starts life as `APP_PASSCODE` in the environment, which is what gets a new
 * deployment running. The moment the owner changes it, the new one is stored
 * here as a scrypt hash and takes precedence — so a passcode chosen in the app
 * is not sitting in a dashboard in plain text, and changing it never needs a
 * redeploy.
 *
 * Deliberately separate from `session.ts`: that module is imported by
 * middleware, which runs on the edge runtime where `node:crypto` and the
 * database driver do not exist. Everything here runs only in server actions.
 */

const STORE_KEY = 'auth.passcode'
const KEY_LENGTH = 32

function hash(passcode: string): string {
  const salt = randomBytes(16)
  const derived = scryptSync(passcode, salt, KEY_LENGTH)
  return `scrypt:${salt.toString('base64url')}:${derived.toString('base64url')}`
}

function verify(passcode: string, stored: string): boolean {
  const [scheme, saltPart, keyPart] = stored.split(':')
  if (scheme !== 'scrypt' || !saltPart || !keyPart) return false

  try {
    const salt = Buffer.from(saltPart, 'base64url')
    const expected = Buffer.from(keyPart, 'base64url')
    const actual = scryptSync(passcode, salt, expected.length)
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

async function storedHash(): Promise<string | null> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, STORE_KEY))
    .limit(1)

  return typeof row?.value === 'string' ? row.value : null
}

/** Whether a passcode chosen in the app has replaced the environment one. */
export async function passcodeIsManaged(): Promise<boolean> {
  return (await storedHash()) !== null
}

/**
 * Check a submitted passcode against whichever is in force.
 *
 * A stored passcode wins outright: once the owner has set one, the value left
 * in the environment must stop working, or changing it would achieve nothing.
 */
export async function checkPasscode(submitted: string): Promise<boolean> {
  const stored = await storedHash()
  if (stored) return verify(submitted, stored)

  return passcodeMatches(submitted)
}

export async function setPasscode(passcode: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: STORE_KEY, value: hash(passcode) })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: hash(passcode), updatedAt: new Date() },
    })
}

/**
 * The second thing a passcode change needs.
 *
 * The passcode is shared with whoever helps run the office, so on its own it is
 * not enough to authorise replacing itself — anyone who has it could lock the
 * owner out. This key is set in the deployment environment and is not shared,
 * so a change requires both something the office knows and something only the
 * owner has.
 */
export function secretKeyMatches(submitted: string): boolean {
  const expected = process.env.PASSCODE_SECRET_KEY ?? ''
  if (expected.length === 0) return false

  const encoder = new TextEncoder()
  const a = encoder.encode(submitted)
  const b = encoder.encode(expected)

  let mismatch = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) {
    mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return mismatch === 0
}

export function secretKeyConfigured(): boolean {
  return (process.env.PASSCODE_SECRET_KEY ?? '').length > 0
}
