'use client'

import { useRouter } from 'next/navigation'
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

import { cn } from '@/lib/utils'

/**
 * Subscribes to the SSE feed and refreshes the current route whenever an order
 * changes anywhere, so the kitchen tablet and the owner's phone stay in step
 * without either of them polling.
 *
 * `router.refresh()` re-runs the server component and patches the tree in
 * place — scroll position and any open input keep their state.
 *
 * Mounted once, at the top of the tree: every instance opens an SSE connection
 * that holds its own Postgres LISTEN session, so duplicating the provider
 * would multiply database connections per open tab.
 */

const RealtimeContext = createContext(false)

export const useRealtimeConnected = () => useContext(RealtimeContext)

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    let source: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let attempts = 0
    let disposed = false

    function connect() {
      if (disposed) return

      source = new EventSource('/api/stream')

      source.addEventListener('ready', () => {
        attempts = 0
        setConnected(true)
      })

      source.addEventListener('order', () => {
        router.refresh()
      })

      source.onerror = () => {
        setConnected(false)
        source?.close()

        // Back off to 30s so a restarting server isn't hammered by every open
        // tablet and phone at once.
        attempts += 1
        retry = setTimeout(connect, Math.min(1000 * 2 ** attempts, 30_000))
      }
    }

    connect()

    /* Phones suspend background tabs and silently kill the connection. Coming
       back to the app re-syncs immediately rather than waiting for a retry. */
    function onVisible() {
      if (document.visibilityState !== 'visible') return
      router.refresh()
      if (!source || source.readyState === EventSource.CLOSED) connect()
    }

    document.addEventListener('visibilitychange', onVisible)

    return () => {
      disposed = true
      if (retry) clearTimeout(retry)
      document.removeEventListener('visibilitychange', onVisible)
      source?.close()
    }
  }, [router])

  return (
    <RealtimeContext.Provider value={connected}>{children}</RealtimeContext.Provider>
  )
}

/** Small live/reconnecting indicator. Reads state from the provider above it. */
export function ConnectionDot({ className }: { className?: string }) {
  const connected = useRealtimeConnected()

  return (
    <span
      title={connected ? 'Live' : 'Reconnecting…'}
      className={cn('flex items-center gap-1.5 text-[0.6875rem]', className)}
    >
      <span
        className={cn(
          'size-1.5 rounded-full transition',
          connected ? 'bg-emerald-400' : 'animate-pulse bg-amber-400',
        )}
      />
      <span className={connected ? 'text-ink-faint' : 'text-amber-400'}>
        {connected ? 'Live' : 'Reconnecting'}
      </span>
    </span>
  )
}
