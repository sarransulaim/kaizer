import { NextResponse, type NextRequest } from 'next/server'

import { isPublicPath, SESSION_COOKIE, verifySessionToken } from '@/lib/auth/session'

/**
 * Keeps the office side of the app behind the passcode.
 *
 * The split this enforces is the whole reason the lock exists: kitchen staff
 * use `/kitchen` for the order board and the time clock, and everything
 * else — orders, customer phone numbers, revenue, payroll — needs the passcode.
 *
 * Running as middleware rather than as a check inside each page means a new
 * page is protected by default. Forgetting to add a guard is the ordinary way
 * this kind of thing springs a leak.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  if (isPublicPath(pathname)) return NextResponse.next()

  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (await verifySessionToken(token)) return NextResponse.next()

  const login = request.nextUrl.clone()
  login.pathname = '/login'
  /* Come back to whatever was being opened once the passcode is in. */
  login.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`

  return NextResponse.redirect(login)
}

export const config = {
  /*
   * Everything except Next's own build output and image optimizer. Static files
   * that must stay reachable (the manifest, PWA icons, the service worker) are
   * allowed through by `isPublicPath` instead, so the list lives in one place
   * next to the paths it belongs with.
   */
  matcher: ['/((?!_next/static|_next/image).*)'],
}
