'use client'

import { AlertTriangle, Bike, ChevronDown, ShoppingBag, UtensilsCrossed, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { StatusButton } from '@/components/orders/status-button'
import type { KitchenRecipe } from '@/lib/menu/queries'
import { STATUS_LABELS, STATUS_STYLES } from '@/lib/orders/status'
import type { FulfillmentType, OrderStatus } from '@/lib/db/schema'
import { cn } from '@/lib/utils'

/**
 * The order cards on the wall display.
 *
 * Everything the card needs is passed in already formatted. In particular the
 * countdown is computed on the server and handed over as a number: deriving it
 * from `Date.now()` during render would produce a different value on the server
 * than in the browser a moment later, and React would report the mismatch.
 */

export type KitchenLine = {
  id: string
  quantity: number
  itemName: string
  sizeLabel: string
  variantId: string | null
  notes: string | null
}

export type KitchenOrder = {
  id: string
  orderNumber: number
  customerName: string
  serviceTime: string
  serviceDate: string
  minutes: number
  status: OrderStatus
  fulfillmentType: FulfillmentType
  fulfillmentLabel: string
  notes: string | null
  customerNotes: string | null
  deliveryAddress: string | null
  items: KitchenLine[]
}

type Recipes = {
  byVariant: Record<string, KitchenRecipe>
  byName: Record<string, KitchenRecipe>
}

/** How many lines a collapsed card shows before it starts hiding them. */
const COLLAPSED_LINES = 3

const FULFILLMENT_ICONS: Record<FulfillmentType, typeof Bike> = {
  delivery: Bike,
  pickup: ShoppingBag,
  dine_in: UtensilsCrossed,
}

export function KitchenBoard({
  live,
  overdue,
  recipes,
}: {
  live: KitchenOrder[]
  overdue: KitchenOrder[]
  recipes: Recipes
}) {
  /* One dialog for the whole board rather than one per card: only ever a single
     recipe is open, and mounting dozens of hidden dialogs on a tablet is waste. */
  const [openRecipe, setOpenRecipe] = useState<{
    line: KitchenLine
    order: KitchenOrder
  } | null>(null)

  const close = useCallback(() => setOpenRecipe(null), [])

  const lookup = useCallback(
    (line: KitchenLine): KitchenRecipe | null =>
      (line.variantId ? recipes.byVariant[line.variantId] : null) ??
      recipes.byName[line.itemName.toLowerCase()] ??
      null,
    [recipes],
  )

  return (
    <>
      {overdue.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-rose-400">
            <AlertTriangle className="size-4" />
            Still open from earlier days
          </h2>
          <Grid
            orders={overdue}
            showDate
            lookup={lookup}
            onOpenRecipe={setOpenRecipe}
          />
        </section>
      )}

      {live.length > 0 && (
        <section className="mb-6">
          <h2 className="text-ink-faint mb-2 text-xs font-semibold tracking-wider uppercase">
            In progress · {live.length}
          </h2>
          <Grid orders={live} lookup={lookup} onOpenRecipe={setOpenRecipe} />
        </section>
      )}

      {openRecipe && (
        <RecipeDialog
          line={openRecipe.line}
          order={openRecipe.order}
          info={lookup(openRecipe.line)}
          onClose={close}
        />
      )}
    </>
  )
}

function Grid({
  orders,
  showDate = false,
  lookup,
  onOpenRecipe,
}: {
  orders: KitchenOrder[]
  showDate?: boolean
  lookup: (line: KitchenLine) => KitchenRecipe | null
  onOpenRecipe: (value: { line: KitchenLine; order: KitchenOrder }) => void
}) {
  return (
    <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {orders.map((order) => (
        <Card
          key={order.id}
          order={order}
          showDate={showDate}
          lookup={lookup}
          onOpenRecipe={onOpenRecipe}
        />
      ))}
    </div>
  )
}

function Card({
  order,
  showDate,
  lookup,
  onOpenRecipe,
}: {
  order: KitchenOrder
  showDate: boolean
  lookup: (line: KitchenLine) => KitchenRecipe | null
  onOpenRecipe: (value: { line: KitchenLine; order: KitchenOrder }) => void
}) {
  const [open, setOpen] = useState(false)

  const late = order.minutes < 0
  const soon = !late && order.minutes <= 60
  const units = order.items.reduce((sum, item) => sum + item.quantity, 0)

  const shown = open ? order.items : order.items.slice(0, COLLAPSED_LINES)
  const hidden = order.items.length - shown.length

  const FulfillmentIcon = FULFILLMENT_ICONS[order.fulfillmentType]
  const hasDetail = Boolean(
    order.notes || order.customerNotes || order.deliveryAddress,
  )

  return (
    <article
      className={cn(
        'rounded-card bg-surface flex flex-col ring-2 transition',
        late ? 'ring-rose-500/70' : soon ? 'ring-amber-500/60' : 'ring-line/70',
      )}
    >
      {/* Header is the expand control. The item rows below are their own
          buttons, so tapping a line opens its recipe rather than collapsing
          the card underneath the finger. */}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="hover:bg-surface-raised/40 flex w-full items-start justify-between gap-3 rounded-t-[calc(var(--radius-card)-2px)] px-4 pt-3 pb-2 text-left transition"
      >
        <div className="min-w-0">
          <div className="tabular text-2xl leading-none font-bold">
            {order.serviceTime}
          </div>
          <div className="text-ink-muted mt-1 truncate text-sm">
            {order.customerName}
            <span className="text-ink-faint"> · #{order.orderNumber}</span>
          </div>
          {showDate && (
            <div className="text-ink-faint tabular text-xs">{order.serviceDate}</div>
          )}
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
              late ? 'text-rose-400' : soon ? 'text-amber-400' : 'text-ink-faint',
            )}
          >
            {late ? `${Math.abs(order.minutes)}m late` : `in ${order.minutes}m`}
          </span>
          <ChevronDown
            className={cn(
              'text-ink-faint size-4 transition',
              open && 'rotate-180',
            )}
          />
        </div>
      </button>

      <div className="text-ink-faint flex items-baseline justify-between px-4 text-[0.6875rem] tracking-wider uppercase">
        <span className="flex items-center gap-1.5">
          <FulfillmentIcon className="size-3.5" />
          {order.fulfillmentLabel}
        </span>
        <span>
          {units} unit{units === 1 ? '' : 's'}
        </span>
      </div>

      <ul className="divide-line/40 mt-1 flex-1 divide-y px-2">
        {shown.map((line) => {
          const info = lookup(line)
          return (
            <li key={line.id}>
              <button
                type="button"
                onClick={() => onOpenRecipe({ line, order })}
                className="hover:bg-surface-raised/50 flex w-full items-baseline gap-2.5 rounded-lg px-2 py-1.5 text-left transition"
              >
                <span className="tabular text-accent w-8 shrink-0 text-xl font-bold">
                  {line.quantity}
                </span>
                <span className="min-w-0 flex-1 text-base leading-tight">
                  {line.itemName}
                  <span className="text-ink-faint block text-sm">
                    {line.sizeLabel}
                  </span>
                </span>
                <span
                  className={cn(
                    'shrink-0 text-[0.6875rem] tracking-wide uppercase',
                    info?.recipe ? 'text-accent/80' : 'text-ink-faint/50',
                  )}
                >
                  {info?.recipe ? 'Recipe' : ''}
                </span>
              </button>
            </li>
          )
        })}

        {hidden > 0 && (
          <li>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-ink-faint hover:text-ink w-full px-2 py-2 text-left text-sm transition"
            >
              + {hidden} more line{hidden === 1 ? '' : 's'}
            </button>
          </li>
        )}
      </ul>

      {open && hasDetail && (
        <div className="mt-2 space-y-2 px-4">
          {order.deliveryAddress && (
            <p className="text-ink-muted text-sm">{order.deliveryAddress}</p>
          )}
          {order.notes && (
            <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              {order.notes}
            </p>
          )}
          {order.customerNotes && (
            <p className="text-ink-muted rounded-md bg-sky-500/10 px-3 py-2 text-sm">
              <span className="text-ink-faint block text-[0.6875rem] tracking-wide uppercase">
                Customer asked
              </span>
              {order.customerNotes}
            </p>
          )}
        </div>
      )}

      {/* Collapsed cards still surface a kitchen note — it is the one thing that
          must not be missed, and hiding it behind a tap would be a trap. */}
      {!open && order.notes && (
        <p className="mx-4 mt-2 truncate rounded-md bg-amber-500/10 px-3 py-1.5 text-sm text-amber-200">
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
}

/* -------------------------------------------------------------------------- */
/*                                  Recipe                                    */
/* -------------------------------------------------------------------------- */

function RecipeDialog({
  line,
  order,
  info,
  onClose,
}: {
  line: KitchenLine
  order: KitchenOrder
  info: KitchenRecipe | null
  onClose: () => void
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Recipe for ${line.itemName}`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="rounded-card bg-surface ring-line flex max-h-[92dvh] w-full max-w-2xl flex-col ring-1"
      >
        <header className="border-line/60 flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-2xl leading-tight font-bold">{line.itemName}</h2>
            <p className="text-ink-muted mt-1 text-sm">
              {line.sizeLabel}
              <span className="text-ink-faint">
                {' · '}
                {line.quantity} for {order.customerName} at {order.serviceTime}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close recipe"
            className="bg-surface-raised ring-line text-ink-muted hover:text-ink flex size-11 shrink-0 items-center justify-center rounded-lg ring-1 transition"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {info && (
            <div className="text-ink-faint mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs tracking-wide uppercase">
              <span>{info.prepLeadHours}h lead</span>
              {info.servesCount && <span>Serves ~{info.servesCount} each</span>}
              {line.quantity > 1 && (
                <span className="text-accent">
                  Making {line.quantity} × this size
                </span>
              )}
            </div>
          )}

          {info?.recipe ? (
            /* Preserved verbatim: the line breaks and indentation a cook typed
               are the structure of the method. */
            <pre className="text-ink font-mono text-base leading-relaxed whitespace-pre-wrap">
              {info.recipe}
            </pre>
          ) : (
            <div className="py-8 text-center">
              <p className="text-ink-muted">No recipe saved for this item yet.</p>
              <p className="text-ink-faint mt-1 text-sm">
                Add one in Settings → Menu → {line.itemName} → Recipe.
              </p>
            </div>
          )}

          {line.notes && (
            <p className="mt-4 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              This line: {line.notes}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
