'use client'

import { RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useEffect } from 'react'

import { Button } from '@/components/ui/button'

/**
 * Catches a render or data error on the office side of the app.
 *
 * Without this, a failed query — Postgres restarting, a connection dropped mid
 * request — replaces the page with a bare error and no way out but the browser
 * reload button. `reset()` re-runs the segment, which is usually all a
 * transient database blip needs.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[app error]', error)
  }, [error])

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-6 py-20 text-center">
      <h1 className="text-xl font-semibold tracking-tight">
        That page didn&apos;t load
      </h1>
      <p className="text-ink-muted mt-2 text-sm">
        Something went wrong reading the data. It is usually momentary — trying
        again is worth doing before anything else.
      </p>

      <div className="mt-6 flex gap-2">
        <Button type="button" variant="primary" onClick={reset}>
          <RefreshCw className="size-4" />
          Try again
        </Button>
        <Link
          href="/"
          className="bg-surface-raised text-ink ring-line hover:bg-line/60 inline-flex h-11 items-center rounded-lg px-4 text-[0.9375rem] font-medium ring-1 transition"
        >
          Dashboard
        </Link>
      </div>

      {error.digest && (
        <p className="text-ink-faint mt-8 text-xs">
          Reference <span className="tabular">{error.digest}</span>
        </p>
      )}
    </div>
  )
}
