import 'server-only'

import { cookies } from 'next/headers'

import { SESSION_COOKIE, verifySessionToken } from './session'

/**
 * The passcode check that middleware cannot do on its own.
 *
 * A server action is addressed by its own id and posted to whatever route the
 * browser happens to be on. Middleware guards *pages*, so an action called from
 * a public page — `/kitchen`, say — never passes through a protected path, and
 * a worker at the tablet could invoke an office-only action if the action did
 * not check for itself.
 *
 * So every mutation that is not meant for the kitchen calls this first. The two
 * that are deliberately left open are punching the clock (guarded by the
 * worker's PIN) and advancing an order's status, which is the entire purpose of
 * the kitchen display.
 */
export async function isSignedIn(): Promise<boolean> {
  const store = await cookies()
  return verifySessionToken(store.get(SESSION_COOKIE)?.value)
}

export async function requireSession(): Promise<void> {
  if (!(await isSignedIn())) {
    throw new Error('Not signed in')
  }
}

/** For actions that return a result object rather than throwing. */
export async function guard<T extends { ok: boolean }>(
  denied: T,
  run: () => Promise<T>,
): Promise<T> {
  if (!(await isSignedIn())) return denied
  return run()
}
