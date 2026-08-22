import { AlertTriangle, CalendarPlus, PartyPopper } from 'lucide-react'
import Link from 'next/link'

import { OrderCard } from '@/components/orders/order-card'
import { StatTile } from '@/components/stat-tile'
import { buttonStyles } from '@/components/ui/button'
import { formatCentsCompact } from '@/lib/money'
import { getOverdueOrders, getTodayOrders } from '@/lib/orders/queries'
import { TERMINAL_STATUSES } from '@/lib/orders/status'
import { formatDateLong, today } from '@/lib/time'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Today' }

export default async function TodayPage() {
  const [orders, overdue] = await Promise.all([
    getTodayOrders(),
    getOverdueOrders(),
  ])

  const live = orders.filter((o) => !TERMINAL_STATUSES.includes(o.status))
  const done = orders.filter((o) => o.status === 'completed')
  const cancelled = orders.filter((o) => o.status === 'cancelled')

  const billable = orders.filter((o) => o.status !== 'cancelled')
  const revenueCents = billable.reduce((sum, o) => sum + o.totalCents, 0)
  const outstandingCents = billable.reduce(
    (sum, o) => sum + (o.totalCents - o.amountPaidCents),
    0,
  )

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 lg:py-8">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <p className="text-ink-faint text-sm">{formatDateLong(today())}</p>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Orders" value={billable.length} />
        <StatTile
          label="Remaining"
          value={live.length}
          tone={live.length > 0 ? 'warning' : 'positive'}
        />
        <StatTile label="Revenue" value={formatCentsCompact(revenueCents)} />
        <StatTile
          label="Unpaid"
          value={formatCentsCompact(outstandingCents)}
          tone={outstandingCents > 0 ? 'warning' : 'positive'}
        />
      </div>

      {overdue.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-rose-400">
            <AlertTriangle className="size-4" />
            Still open from earlier days
          </h2>
          <div className="space-y-2.5">
            {overdue.map((order) => (
              <OrderCard key={order.id} order={order} showDate />
            ))}
          </div>
        </section>
      )}

      {live.length > 0 ? (
        <section className="mb-6">
          <h2 className="text-ink-muted mb-2 text-sm font-semibold">
            In progress · {live.length}
          </h2>
          <div className="space-y-2.5">
            {live.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        </section>
      ) : (
        orders.length === 0 && <EmptyToday />
      )}

      {live.length === 0 && orders.length > 0 && (
        <div className="rounded-card bg-surface ring-line/70 mb-6 flex items-center gap-3 px-4 py-5 ring-1">
          <PartyPopper className="size-5 shrink-0 text-emerald-400" />
          <div>
            <p className="font-medium">Everything&apos;s out.</p>
            <p className="text-ink-faint text-sm">
              All {billable.length} orders for today are closed.
            </p>
          </div>
        </div>
      )}

      {done.length > 0 && (
        <details className="group mb-4">
          <summary className="text-ink-muted hover:text-ink cursor-pointer list-none text-sm font-semibold transition">
            Completed · {done.length}
            <span className="text-ink-faint ml-1 font-normal group-open:hidden">
              (show)
            </span>
          </summary>
          <div className="mt-2 space-y-2.5">
            {done.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        </details>
      )}

      {cancelled.length > 0 && (
        <details className="group">
          <summary className="text-ink-faint hover:text-ink-muted cursor-pointer list-none text-sm font-semibold transition">
            Cancelled · {cancelled.length}
          </summary>
          <div className="mt-2 space-y-2.5">
            {cancelled.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function EmptyToday() {
  return (
    <div className="rounded-card bg-surface ring-line/70 px-6 py-12 text-center ring-1">
      <CalendarPlus className="text-ink-faint mx-auto size-8" />
      <p className="mt-3 font-medium">No orders for today</p>
      <p className="text-ink-faint mx-auto mt-1 max-w-xs text-sm">
        Orders taken over WhatsApp or the Google Form go in here.
      </p>
      <Link
        href="/orders/new"
        className={buttonStyles({ variant: 'primary', className: 'mt-5' })}
      >
        Add an order
      </Link>
    </div>
  )
}
