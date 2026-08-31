'use server'

import { cookies } from 'next/headers'

import {
  createSessionToken,
  passcodeMatches,
  SESSION_COOKIE,
  SESSION_DAYS,
} from './session'

/**
 * A deliberate pause on a wrong passcode.
 *
 * The passcode is short and shared, so the realistic attack is someone sitting
 * with the URL trying likely numbers. Half a second turns a fast automated
 * sweep into something too slow to be worth running, and is imperceptible to
 * anyone typing the right code.
 */
const WRONG_PASSCODE_DELAY_MS = 500

export async function signIn(
  passcode: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!process.env.APP_PASSCODE) {
    return {
      ok: false,
      error: 'No passcode is configured on the server. Set APP_PASSCODE.',
    }
  }

  if (!passcodeMatches(passcode.trim())) {
    await new Promise((resolve) => setTimeout(resolve, WRONG_PASSCODE_DELAY_MS))
    return { ok: false, error: 'That passcode is not right.' }
  }

  const store = await cookies()
  store.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  })

  return { ok: true }
}

export async function signOut(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}
