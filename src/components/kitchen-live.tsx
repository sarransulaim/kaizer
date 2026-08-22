'use client'

import { useEffect, type ReactNode } from 'react'

import { RealtimeProvider } from './realtime-refresh'

/**
 * Wrapper for the wall-mounted kitchen display.
 *
 * Beyond the shared realtime subscription it does two things a normal page
 * doesn't need: it holds a screen wake lock so the tablet never sleeps
 * mid-service, and it re-acquires that lock when the screen comes back, since
 * the browser drops it whenever the page is hidden.
 */
export function KitchenLive({ children }: { children: ReactNode }) {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    let disposed = false

    async function acquire() {
      if (disposed || !('wakeLock' in navigator)) return
      try {
        lock = await navigator.wakeLock.request('screen')
      } catch {
        // Denied (unsupported browser, or the tablet is on low battery).
        // The display still works, it just won't keep the screen awake.
      }
    }

    function onVisible() {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release().catch(() => {})
    }
  }, [])

  return <RealtimeProvider>{children}</RealtimeProvider>
}
