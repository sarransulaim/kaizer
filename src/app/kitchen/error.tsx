'use client'

import { useEffect, useState } from 'react'

/**
 * The wall display's error state.
 *
 * Different from the office one on purpose: nobody is standing at this screen
 * to read a message and tap a button. It is on a bracket above the pass, so it
 * retries on its own and says what it is doing, and the board comes back by
 * itself once the database does.
 */
const RETRY_SECONDS = 10

export default function KitchenError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [countdown, setCountdown] = useState(RETRY_SECONDS)

  useEffect(() => {
    console.error('[kitchen error]', error)
  }, [error])

  useEffect(() => {
    const tick = setInterval(() => {
      setCountdown((current) => {
        if (current <= 1) {
          reset()
          return RETRY_SECONDS
        }
        return current - 1
      })
    }, 1000)

    return () => clearInterval(tick)
  }, [reset])

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
      <h1 className="text-4xl font-bold tracking-tight">Board unavailable</h1>
      <p className="text-ink-muted mt-3 text-xl">
        Lost the connection to the order list.
      </p>
      <p className="text-ink-faint mt-8 text-lg">
        Retrying in <span className="tabular text-accent">{countdown}</span>
      </p>
      <button
        type="button"
        onClick={reset}
        className="bg-surface-raised ring-line text-ink hover:bg-line/60 mt-8 h-14 rounded-xl px-8 text-lg font-medium ring-1 transition"
      >
        Retry now
      </button>
    </div>
  )
}
