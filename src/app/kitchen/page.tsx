import { KitchenBoard, type KitchenOrder } from '@/components/kitchen/board'
import { KitchenLive } from '@/components/kitchen-live'
import { ConnectionDot } from '@/components/realtime-refresh'
import { getRecipeLookup } from '@/lib/menu/queries'
import { getKitchenBoard, type ItemTotal } from '@/lib/orders/queries'
import { FULFILLMENT_LABELS } from '@/lib/orders/status'
import type { OrderWithItems } from '@/lib/orders/queries'
import { formatDate, formatDateLong, formatTime, minutesUntil } from '@/lib/time'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Kitchen' }

/**
 * Wall-tablet display. Deliberately outside the app shell: no navigation, no
 * money, no customer contact details — just what is being cooked and when it
 * has to be out. Type is sized to be read from across the kitchen.
 *
 * The board is scoped to today plus anything still open from an earlier day.
 * It previously listed every open order on the books, which meant a tray booked
 * three weeks out sat on the wall next to tonight's service, and the totals
 * strip (which was always today-only) disagreed with the cards underneath it.
 * Both now come from one query, so the numbers and the cards cannot drift.
 */
export default async function KitchenPage() {
  const [board, recipes] = await Promise.all([getKitchenBoard(), getRecipeLookup()])
  const remaining = board.live.length + board.overdue.length

  return (
    <KitchenLive>
      <div className="min-h-dvh px-5 py-4">
        <header className="border-line/60 mb-5 flex items-end justify-between gap-4 border-b pb-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Kitchen</h1>
            <p className="text-ink-faint text-sm">{formatDateLong(board.date)}</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="tabular text-2xl leading-none font-bold">
                {remaining}
              </div>
              <div className="text-ink-faint text-xs tracking-wide uppercase">
                to go
              </div>
            </div>
            <ConnectionDot className="text-sm" />
          </div>
        </header>

        {board.totals.length > 0 && <Totals totals={board.totals} />}

        <KitchenBoard
          live={board.live.map(toKitchenOrder)}
          overdue={board.overdue.map(toKitchenOrder)}
          recipes={recipes}
        />

        {board.live.length === 0 && board.overdue.length === 0 && (
          <div className="flex min-h-[40vh] items-center justify-center">
            <p className="text-ink-faint text-2xl">
              {board.done.length > 0 ? "Everything's out." : 'Nothing in the queue.'}
            </p>
          </div>
        )}

        {board.done.length > 0 && <Done orders={board.done} />}
      </div>
    </KitchenLive>
  )
}

/**
 * Flatten an order into the plain, already-formatted shape the client board
 * renders. Formatting and the countdown are resolved here so the browser is
 * never asked to recompute a clock-dependent value that the server already
 * rendered — that is the classic source of a hydration mismatch.
 */
function toKitchenOrder(order: OrderWithItems): KitchenOrder {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customer.name,
    serviceTime: formatTime(order.serviceTime),
    serviceDate: formatDate(order.serviceDate),
    minutes: minutesUntil(order.serviceAt),
    status: order.status,
    fulfillmentType: order.fulfillmentType,
    fulfillmentLabel: FULFILLMENT_LABELS[order.fulfillmentType],
    notes: order.notes,
    customerNotes: order.customerNotes,
    deliveryAddress: order.deliveryAddress,
    items: order.items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      itemName: item.itemNameSnapshot,
      sizeLabel: item.sizeLabelSnapshot,
      variantId: item.menuVariantId,
      notes: item.notes,
    })),
  }
}

/* -------------------------------------------------------------------------- */
/*                                Item totals                                 */
/* -------------------------------------------------------------------------- */

/**
 * How much of each thing is still to be made today, across every order on the
 * board. This is the number the kitchen cooks to; the cards below are how it
 * gets split up once it is made.
 *
 * A line counts down as orders are completed and disappears once nothing is
 * waiting on it, so the wall never shows work that has already gone out. The
 * day's original total stays in the heading.
 */
function Totals({ totals }: { totals: ItemTotal[] }) {
  const outstanding = totals.filter((line) => line.quantity > 0)
  const left = outstanding.reduce((sum, line) => sum + line.quantity, 0)
  const total = totals.reduce((sum, line) => sum + line.totalQuantity, 0)

  if (outstanding.length === 0) {
    return (
      <section className="mb-6">
        <h2 className="text-ink-faint mb-2 text-xs font-semibold tracking-wider uppercase">
          Today&apos;s totals
        </h2>
        <p className="rounded-card bg-surface ring-line/70 px-4 py-3 text-lg ring-1">
          <span className="font-semibold text-emerald-400">All {total} made.</span>{' '}
          <span className="text-ink-faint text-base">Nothing left to cook.</span>
        </p>
      </section>
    )
  }

  return (
    <section className="mb-6">
      <h2 className="text-ink-faint mb-2 text-xs font-semibold tracking-wider uppercase">
        Still to make · {left} of {total} unit{total === 1 ? '' : 's'}
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {outstanding.map((line) => (
          <div
            key={`${line.itemName}-${line.sizeLabel}`}
            className="rounded-card bg-surface ring-line/70 flex items-center gap-3 px-3 py-2.5 ring-1"
          >
            <span className="tabular text-accent w-10 shrink-0 text-3xl leading-none font-bold">
              {line.quantity}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm leading-tight font-medium">
                {line.itemName}
              </span>
              <span className="text-ink-faint block truncate text-xs">
                {line.sizeLabel} · {line.orderCount} order
                {line.orderCount === 1 ? '' : 's'}
                {line.doneQuantity > 0 && (
                  <span className="text-emerald-400/80"> · {line.doneQuantity} out</span>
                )}
              </span>
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * Finished orders stay on the board, but as one compact line each: the kitchen
 * needs to see that a name has already gone out without it competing for space
 * with what still has to be cooked.
 */
function Done({ orders }: { orders: OrderWithItems[] }) {
  return (
    <section>
      <h2 className="text-ink-faint mb-2 text-xs font-semibold tracking-wider uppercase">
        Done · {orders.length}
      </h2>
      <div className="flex flex-wrap gap-2">
        {orders.map((order) => (
          <span
            key={order.id}
            className="bg-surface ring-line/70 text-ink-faint rounded-lg px-3 py-1.5 text-sm ring-1"
          >
            <span className="tabular">{formatTime(order.serviceTime)}</span>{' '}
            {order.customer.name}
          </span>
        ))}
      </div>
    </section>
  )
}
