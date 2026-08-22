import { KitchenLive } from '@/components/kitchen-live'
import { StatusButton } from '@/components/orders/status-button'
import { ConnectionDot } from '@/components/realtime-refresh'
import { getOpenOrders, getPrepSummary } from '@/lib/orders/queries'
import { STATUS_LABELS, STATUS_STYLES } from '@/lib/orders/status'
import { formatDateLong, formatTime, minutesUntil, today } from '@/lib/time'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Kitchen' }

/**
 * Wall-tablet display. Deliberately outside the app shell: no navigation, no
 * money, no customer contact details — just what is being cooked and when it
 * has to be out. Type is sized to be read from across the kitchen.
 */
export default async function KitchenPage() {
  const [orders, summary] = await Promise.all([
    getOpenOrders(),
    getPrepSummary(today()),
  ])

  return (
    <KitchenLive>
      <div className="min-h-dvh px-5 py-4">
        <header className="border-line/60 mb-5 flex items-end justify-between gap-4 border-b pb-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Kitchen</h1>
            <p className="text-ink-faint text-sm">{formatDateLong(today())}</p>
          </div>
          <ConnectionDot className="text-sm" />
        </header>

        {summary.length > 0 && (
          <section className="mb-6">
            <h2 className="text-ink-faint mb-2 text-xs font-semibold tracking-wider uppercase">
              Today&apos;s totals
            </h2>
            <div className="flex flex-wrap gap-2">
              {summary.map((line) => (
                <div
                  key={`${line.itemName}-${line.sizeLabel}`}
                  className="bg-surface ring-line/70 rounded-lg px-3 py-2 ring-1"
                >
                  <span className="tabular text-accent text-2xl font-bold">
                    {line.quantity}
                  </span>
                  <span className="ml-2 text-sm">
                    {line.itemName}
                    <span className="text-ink-faint"> · {line.sizeLabel}</span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {orders.length === 0 ? (
          <div className="flex min-h-[50vh] items-center justify-center">
            <p className="text-ink-faint text-2xl">Nothing in the queue.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {orders.map((order) => {
              const minutes = minutesUntil(order.serviceAt)
              const late = minutes < 0
              const soon = !late && minutes <= 60

              return (
                <article
                  key={order.id}
                  className={cn(
                    'rounded-card bg-surface flex flex-col ring-2 transition',
                    late
                      ? 'ring-rose-500/70'
                      : soon
                        ? 'ring-amber-500/60'
                        : 'ring-line/70',
                  )}
                >
                  <div className="flex items-start justify-between gap-3 px-4 pt-3">
                    <div className="min-w-0">
                      <div className="tabular text-2xl leading-none font-bold">
                        {formatTime(order.serviceTime)}
                      </div>
                      <div className="text-ink-muted mt-1 truncate text-sm">
                        {order.customer.name}
                        <span className="text-ink-faint"> · #{order.orderNumber}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
                          STATUS_STYLES[order.status],
                        )}
                      >
                        {STATUS_LABELS[order.status]}
                      </span>
                      <span
                        className={cn(
                          'tabular text-xs font-semibold',
                          late
                            ? 'text-rose-400'
                            : soon
                              ? 'text-amber-400'
                              : 'text-ink-faint',
                        )}
                      >
                        {late ? `${Math.abs(minutes)}m late` : `in ${minutes}m`}
                      </span>
                    </div>
                  </div>

                  <ul className="mt-3 flex-1 space-y-1.5 px-4">
                    {order.items.map((item) => (
                      <li key={item.id} className="flex items-baseline gap-2.5">
                        <span className="tabular text-accent w-8 shrink-0 text-xl font-bold">
                          {item.quantity}
                        </span>
                        <span className="min-w-0 flex-1 text-base leading-tight">
                          {item.itemNameSnapshot}
                          <span className="text-ink-faint block text-sm">
                            {item.sizeLabelSnapshot}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>

                  {order.notes && (
                    <p className="mx-4 mt-3 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                      {order.notes}
                    </p>
                  )}

                  <div className="border-line/60 mt-3 border-t px-4 py-3">
                    <StatusButton
                      orderId={order.id}
                      status={order.status}
                      fulfillmentType={order.fulfillmentType}
                      size="lg"
                    />
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </KitchenLive>
  )
}
