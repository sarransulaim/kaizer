import Link from 'next/link'

export const metadata = { title: 'Not found' }

/**
 * Reached by a mistyped URL, or by an order id that no longer exists — the
 * order page calls `notFound()` rather than rendering a blank shell.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="text-accent tabular text-sm font-semibold">404</p>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">
        Nothing here
      </h1>
      <p className="text-ink-muted mt-2 text-sm">
        That page doesn&apos;t exist, or the order has been removed.
      </p>

      <div className="mt-6 flex gap-2">
        <Link
          href="/"
          className="bg-accent text-accent-ink hover:bg-accent-strong inline-flex h-11 items-center rounded-lg px-4 text-[0.9375rem] font-medium transition"
        >
          Dashboard
        </Link>
        <Link
          href="/kitchen"
          className="bg-surface-raised text-ink ring-line hover:bg-line/60 inline-flex h-11 items-center rounded-lg px-4 text-[0.9375rem] font-medium ring-1 transition"
        >
          Kitchen
        </Link>
      </div>
    </div>
  )
}
