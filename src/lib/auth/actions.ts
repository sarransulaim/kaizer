'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'

import { isSignedIn } from './guard'
import {
  checkPasscode,
  secretKeyConfigured,
  secretKeyMatches,
  setPasscode,
} from './passcode'
import {
  createSessionToken,
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
  if (!(await checkPasscode(passcode.trim()))) {
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

/**
 * Replace the office passcode from inside the app.
 *
 * Three things are required, and each is doing a job. The current passcode
 * proves the person is not simply sitting at an unlocked screen. The secret
 * key — set in the deployment environment and not shared with the office —
 * means the passcode alone cannot be used to replace itself, so nobody who
 * merely knows it can lock the owner out. And a session, so this is only
 * reachable from behind the gate at all.
 */
export async function changePasscode(input: {
  currentPasscode: string
  secretKey: string
  newPasscode: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await isSignedIn())) {
    return { ok: false, error: 'Not signed in' }
  }

  if (!secretKeyConfigured()) {
    return {
      ok: false,
      error: 'No secret key is configured on the server. Set PASSCODE_SECRET_KEY.',
    }
  }

  const next = input.newPasscode.trim()
  if (next.length < 6) {
    return { ok: false, error: 'Use at least 6 characters for the new passcode' }
  }

  /* Both checks run before either result is reported, so the reply cannot
     be used to work out which of the two was the wrong one. */
  const currentOk = await checkPasscode(input.currentPasscode.trim())
  const keyOk = secretKeyMatches(input.secretKey.trim())

  if (!currentOk || !keyOk) {
    await new Promise((resolve) => setTimeout(resolve, WRONG_PASSCODE_DELAY_MS))
    return { ok: false, error: 'The current passcode or the secret key is wrong.' }
  }

  if (next === input.currentPasscode.trim()) {
    return { ok: false, error: 'That is already the passcode' }
  }

  try {
    await setPasscode(next)
    revalidatePath('/settings')
    return { ok: true }
  } catch (error) {
    console.error('[changePasscode]', error)
    return { ok: false, error: 'Could not change the passcode' }
  }
}

export async function signOut(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}
