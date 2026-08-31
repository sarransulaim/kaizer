import 'server-only'

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * Clock-in PINs.
 *
 * A four-digit PIN has ten thousand possibilities, so this is not a secret that
 * survives an attacker with the database. That is not what it is for: it stops
 * one worker tapping a colleague's name and clocking them in for a shift they
 * did not work, at a tablet both of them can reach. Scrypt is used anyway so a
 * database leak does not hand over PINs that people reuse elsewhere.
 */

const KEY_LENGTH = 32

export function hashPin(pin: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(pin, salt, KEY_LENGTH)
  return `scrypt:${salt.toString('base64url')}:${key.toString('base64url')}`
}

export function verifyPin(pin: string, stored: string | null): boolean {
  if (!stored) return false

  const [scheme, saltPart, keyPart] = stored.split(':')
  if (scheme !== 'scrypt' || !saltPart || !keyPart) return false

  try {
    const salt = Buffer.from(saltPart, 'base64url')
    const expected = Buffer.from(keyPart, 'base64url')
    const actual = scryptSync(pin, salt, expected.length)
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

export function isValidPinFormat(pin: string): boolean {
  return /^\d{4}$/.test(pin)
}
