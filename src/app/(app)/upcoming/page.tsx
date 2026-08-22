import { CalendarDays } from 'lucide-react'

import { OrderCard } from '@/components/orders/order-card'
import { UPCOMING_WINDOW_DAYS } from '@/lib/config'
import { formatCentsCompact } from '@/lib/money'
import { getUpcomingOrders } from '@/lib/orders/queries'
import { dayLabel, formatDate } from '@/lib/time'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Upcoming' }

export default async function UpcomingPage() {
  const orders = await getUpcomingOrders(UPCOMING_WINDOW_DAYS)

  /* Grouped in JS rather than with a second aggregate query — the upcoming
     window is a few dozen orders at most, and this keeps day totals and the
     order list guaranteed consistent with each other. */
  const byDate = new Map<string, typeof orders>()
  for (const order of orders) {
    const existing = byDate.get(order.serviceDate)
    if (existing) existing.push(order)
    else byDate.set(order.serviceDate, [order])
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 lg:py-8">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Upcoming</h1>
        <p className="text-ink-faint text-sm">
          Next {UPCOMING_WINDOW_DAYS} days · {orders.length} order
          {orders.length === 1 ? '' : 's'}
        </p>
      </header>

      {byDate.size === 0 ? (
        <div className="rounded-card bg-surface ring-line/70 px-6 py-12 text-center ring-1">
          <CalendarDays className="text-ink-faint mx-auto size-8" />
          <p className="mt-3 font-medium">Nothing booked yet</p>
          <p className="text-ink-faint mt-1 text-sm">
            Orders for future dates will show up here.
          </p>
        </div>
      ) : (
        <div className="space-y-7">
          {[...byDate.entries()].map(([date, dayOrders]) => {
            const revenue = dayOrders.reduce((sum, o) => sum + o.totalCents, 0)
            const trays = dayOrders.reduce(
              (sum, o) => sum + o.items.reduce((n, i) => n + i.quantity, 0),
              0,
            )

            return (
              <section key={date}>
                <div className="border-line/60 mb-2.5 flex items-baseline justify-between gap-3 border-b pb-2">
                  <div>
                    <h2 className="font-semibold">{dayLabel(date)}</h2>
                    <p className="text-ink-faint text-xs">{formatDate(date)}</p>
                  </div>
                  <div className="text-right">
                    <div className="tabular text-sm font-medium">
                      {formatCentsCompact(revenue)}
                    </div>
                    <div className="text-ink-faint tabular text-xs">
                      {dayOrders.length} order{dayOrders.length === 1 ? '' : 's'} ·{' '}
                      {trays} item{trays === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {dayOrders.map((order) => (
                    <OrderCard key={order.id} order={order} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
