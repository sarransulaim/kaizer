/**
 * The staff-room lock.
 *
 * One shared passcode for the owner and managers, held in a signed cookie. This
 * is deliberately not a user-account system: there is exactly one thing to keep
 * out — a worker at the kitchen tablet wandering into revenue and customer
 * phone numbers — and a passcode does that without giving four people passwords
 * to forget.
 *
 * Signing uses Web Crypto rather than `node:crypto` because the token is
 * verified in middleware, which runs on the edge runtime where `node:crypto`
 * does not exist.
 */

export const SESSION_COOKIE = 'kaizr_session'

/** Thirty days: long enough that the owner's phone is not asked twice a week. */
export const SESSION_DAYS = 30

const encoder = new TextEncoder()

function secret(): string {
  const value = process.env.AUTH_SECRET
  if (!value || value.length < 16) {
    throw new Error(
      'AUTH_SECRET is not set (or is too short). The app cannot sign sessions.',
    )
  }
  return value
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return toBase64Url(new Uint8Array(signature))
}

/**
 * A token is `<expiry>.<signature>`. The expiry is in the signed payload rather
 * than left to the cookie's own lifetime, so a copied cookie cannot outlive it.
 */
export async function createSessionToken(now = Date.now()): Promise<string> {
  const expiresAt = now + SESSION_DAYS * 24 * 60 * 60 * 1000
  const payload = String(expiresAt)
  return `${payload}.${await sign(payload)}`
}

export async function verifySessionToken(
  token: string | undefined,
  now = Date.now(),
): Promise<boolean> {
  if (!token) return false

  const separator = token.lastIndexOf('.')
  if (separator <= 0) return false

  const payload = token.slice(0, separator)
  const signature = token.slice(separator + 1)

  const expiresAt = Number(payload)
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false

  const expected = await sign(payload)

  /* Constant-time compare. Both strings are the same length whenever the
     signature is well-formed, and bailing early on length leaks nothing that
     the token's own shape doesn't already. */
  if (expected.length !== signature.length) return false

  let mismatch = 0
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return mismatch === 0
}

/**
 * Whether a submitted passcode is the right one, compared in constant time so
 * the endpoint cannot be used as an oracle for guessing it character by
 * character.
 */
export function passcodeMatches(submitted: string): boolean {
  const expected = process.env.APP_PASSCODE ?? ''
  if (expected.length === 0) return false

  const a = encoder.encode(submitted)
  const b = encoder.encode(expected)

  let mismatch = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) {
    mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return mismatch === 0
}

/**
 * Paths that stay open.
 *
 * `/kitchen` is the whole point of the exercise: the wall tablet and the
 * workers' phones reach the order board and the time clock without a passcode,
 * and nothing else. `/api/stream` is the realtime feed that board subscribes
 * to, and `/api/cron` carries its own shared secret.
 */
const PUBLIC_PREFIXES = [
  '/login',
  '/kitchen',
  '/api/stream',
  '/api/health',
  '/api/cron',
]

const PUBLIC_FILES = [
  '/manifest.webmanifest',
  '/favicon.ico',
  '/sw.js',
  '/robots.txt',
]

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_FILES.includes(pathname)) return true
  if (pathname.startsWith('/icon-') || pathname.startsWith('/badge-')) return true
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}
