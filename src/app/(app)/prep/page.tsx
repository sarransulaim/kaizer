import { Check, ChefHat, PartyPopper } from 'lucide-react'
import Link from 'next/link'

import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { getOrdersForDate, getPrepSummary } from '@/lib/orders/queries'
import { TERMINAL_STATUSES } from '@/lib/orders/status'
import { dayLabel, formatDateLong, formatTime, isIsoDate, today, upcomingDays } from '@/lib/time'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Prep' }

/**
 * The sheet the kitchen actually cooks from: every open order for a day rolled
 * up into totals per item and size, rather than a list someone has to add up by
 * hand at 6am.
 *
 * A line counts down as orders are completed and drops out of the cook list
 * entirely once nothing is waiting on it, so what remains on screen is always
 * what is still to be made. The day's original total stays visible beside it.
 */
export default async function PrepPage(props: PageProps<'/prep'>) {
  const params = await props.searchParams
  const requested = typeof params.date === 'string' ? params.date : undefined
  /* Anyone signed in can type this query string by hand, and an unparseable
     date reached Postgres as a 500. Fall back to today instead. */
  const date = isIsoDate(requested) ? requested : today()

  const [summary, orders] = await Promise.all([
    getPrepSummary(date),
    getOrdersForDate(date),
  ])

  const dates = upcomingDays()

  const remaining = summary.filter((line) => line.quantity > 0)
  const made = summary.filter((line) => line.quantity === 0)
  const remainingUnits = remaining.reduce((sum, line) => sum + line.quantity, 0)
  const totalUnits = summary.reduce((sum, line) => sum + line.totalQuantity, 0)

  const live = orders.filter((o) => !TERMINAL_STATUSES.includes(o.status))
  const closed = orders.filter((o) => o.status === 'completed')

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 lg:py-8">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Prep sheet</h1>
        <p className="text-ink-faint text-sm">{formatDateLong(date)}</p>
      </header>

      <div className="mb-5 flex flex-wrap gap-2">
        {dates.map(({ date: option, label }) => (
          <Link
            key={option}
            href={`/prep?date=${option}`}
            className={cn(
              'flex h-9 items-center rounded-lg px-3 text-sm font-medium ring-1 transition',
              option === date
                ? 'bg-accent text-accent-ink ring-accent'
                : 'bg-surface-raised text-ink-muted ring-line hover:text-ink',
            )}
          >
            {label}
          </Link>
        ))}
      </div>

      {summary.length === 0 ? (
        <div className="rounded-card bg-surface ring-line/70 px-6 py-12 text-center ring-1">
          <ChefHat className="text-ink-faint mx-auto size-8" />
          <p className="mt-3 font-medium">Nothing to prep</p>
          <p className="text-ink-faint mt-1 text-sm">
            No orders on the books for {dayLabel(date).toLowerCase()}.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>
                {remainingUnits > 0
                  ? `Cook list · ${remainingUnits} of ${totalUnits} left`
                  : `Cook list · all ${totalUnits} made`}
              </CardTitle>
            </CardHeader>
            <CardBody>
              {remaining.length > 0 ? (
                <ul className="divide-line/50 divide-y">
                  {remaining.map((line) => (
                    <li
                      key={`${line.itemName}-${line.sizeLabel}`}
                      className="flex items-center gap-3 py-3"
                    >
                      <span className="tabular text-accent w-10 shrink-0 text-xl font-bold">
                        {line.quantity}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {line.itemName}
                        </span>
                        <span className="text-ink-faint text-xs">
                          {line.sizeLabel}
                        </span>
                      </span>
                      <span className="text-ink-faint tabular shrink-0 text-right text-xs">
                        <span className="block">
                          across {line.orderCount} order
                          {line.orderCount === 1 ? '' : 's'}
                        </span>
                        {line.doneQuantity > 0 && (
                          <span className="block text-emerald-400/80">
                            {line.doneQuantity} already out
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex items-center gap-3 py-2">
                  <PartyPopper className="size-5 shrink-0 text-emerald-400" />
                  <p className="text-sm">
                    Everything for {dayLabel(date).toLowerCase()} has been made
                    and handed over.
                  </p>
                </div>
              )}

              {made.length > 0 && remaining.length > 0 && (
                <details className="group border-line/60 mt-3 border-t pt-2">
                  <summary className="text-ink-faint hover:text-ink-muted cursor-pointer list-none text-xs font-semibold transition">
                    Finished · {made.length} line{made.length === 1 ? '' : 's'}
                    <span className="ml-1 font-normal group-open:hidden">
                      (show)
                    </span>
                  </summary>
                  <ul className="mt-1.5 space-y-1">
                    {made.map((line) => (
                      <li
                        key={`${line.itemName}-${line.sizeLabel}`}
                        className="text-ink-faint flex items-center gap-2 text-xs"
                      >
                        <Check className="size-3.5 shrink-0 text-emerald-400" />
                        <span className="tabular">{line.totalQuantity}</span>
                        <span className="truncate">
                          {line.itemName} · {line.sizeLabel}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                Service times{closed.length > 0 && ` · ${closed.length} done`}
              </CardTitle>
            </CardHeader>
            <CardBody>
              {live.length === 0 ? (
                <p className="text-ink-faint py-1 text-sm">
                  Every order for this day is closed out.
                </p>
              ) : (
                <ul className="divide-line/50 divide-y">
                  {live.map((order) => (
                    <li
                      key={order.id}
                      className="flex items-center gap-3 py-2.5 text-sm"
                    >
                      <span className="tabular w-20 shrink-0 font-medium">
                        {formatTime(order.serviceTime)}
                      </span>
                      <Link
                        href={`/orders/${order.id}`}
                        className="hover:text-accent min-w-0 flex-1 truncate transition"
                      >
                        {order.customer.name}
                      </Link>
                      <span className="text-ink-faint shrink-0 text-xs capitalize">
                        {order.fulfillmentType.replace('_', '-')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {live.some((o) => o.notes) && (
            <Card>
              <CardHeader>
                <CardTitle>Kitchen notes</CardTitle>
              </CardHeader>
              <CardBody className="space-y-2">
                {live
                  .filter((o) => o.notes)
                  .map((order) => (
                    <div key={order.id} className="text-sm">
                      <span className="text-ink-faint text-xs">
                        {order.customer.name} · {formatTime(order.serviceTime)}
                      </span>
                      <p className="mt-0.5 rounded-md bg-amber-500/10 px-3 py-2 text-amber-200">
                        {order.notes}
                      </p>
                    </div>
                  ))}
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
