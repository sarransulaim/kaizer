import { Bike, MapPin, Phone, ShoppingBag, UtensilsCrossed } from 'lucide-react'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import type { FulfillmentType } from '@/lib/db/schema'
import { formatCentsCompact } from '@/lib/money'
import type { OrderWithItems } from '@/lib/orders/queries'
import {
  FULFILLMENT_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_STYLES,
  STATUS_LABELS,
  STATUS_STYLES,
} from '@/lib/orders/status'
import { formatPhone, toTelHref } from '@/lib/phone'
import { formatTime, minutesUntil } from '@/lib/time'
import { cn } from '@/lib/utils'

import { StatusButton } from './status-button'

const FULFILLMENT_ICONS: Record<FulfillmentType, typeof Bike> = {
  delivery: Bike,
  pickup: ShoppingBag,
  dine_in: UtensilsCrossed,
}

export function OrderCard({
  order,
  showDate = false,
}: {
  order: OrderWithItems
  showDate?: boolean
}) {
  const FulfillmentIcon = FULFILLMENT_ICONS[order.fulfillmentType]
  const minutes = minutesUntil(order.serviceAt)
  const isOpen = !['completed', 'cancelled'].includes(order.status)

  /* Visual urgency: within the hour the card is outlined amber, past due it
     turns rose. On a busy Saturday the eye should find the next thing without
     reading a single timestamp. */
  const urgency =
    !isOpen || minutes > 60
      ? null
      : minutes < 0
        ? 'overdue'
        : 'soon'

  return (
    <article
      className={cn(
        'rounded-card bg-surface ring-1 transition',
        urgency === 'overdue'
          ? 'ring-rose-500/50'
          : urgency === 'soon'
            ? 'ring-amber-500/40'
            : 'ring-line/70',
        order.status === 'cancelled' && 'opacity-55',
      )}
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link
              href={`/orders/${order.id}`}
              className="hover:text-accent truncate text-[0.9375rem] font-semibold transition"
            >
              {order.customer.name}
            </Link>
            <span className="text-ink-faint tabular shrink-0 text-xs">
              #{order.orderNumber}
            </span>
          </div>

          <div className="text-ink-muted mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
            <span className="tabular text-ink font-medium">
              {formatTime(order.serviceTime)}
            </span>
            {showDate && <span className="tabular">{order.serviceDate}</span>}
            <span className="flex items-center gap-1">
              <FulfillmentIcon className="size-3.5" />
              {FULFILLMENT_LABELS[order.fulfillmentType]}
            </span>
            <a
              href={toTelHref(order.customer.phone)}
              className="hover:text-ink flex items-center gap-1 transition"
            >
              <Phone className="size-3.5" />
              {formatPhone(order.customer.phone)}
            </a>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge className={STATUS_STYLES[order.status]}>
            {STATUS_LABELS[order.status]}
          </Badge>
          {isOpen && urgency && (
            <span
              className={cn(
                'tabular text-[0.6875rem] font-medium',
                urgency === 'overdue' ? 'text-rose-400' : 'text-amber-400',
              )}
            >
              {minutes < 0 ? `${Math.abs(minutes)}m late` : `in ${minutes}m`}
            </span>
          )}
        </div>
      </div>

      <ul className="mt-3 space-y-1 px-4">
        {order.items.map((item) => (
          <li key={item.id} className="flex items-baseline gap-2 text-sm">
            <span className="tabular text-accent w-7 shrink-0 font-semibold">
              {item.quantity}×
            </span>
            <span className="text-ink min-w-0 flex-1">
              {item.itemNameSnapshot}
              <span className="text-ink-faint"> · {item.sizeLabelSnapshot}</span>
            </span>
            <span className="tabular text-ink-muted shrink-0 text-xs">
              {formatCentsCompact(item.lineTotalCents)}
            </span>
          </li>
        ))}
      </ul>

      {order.deliveryAddress && (
        <p className="text-ink-muted mt-2.5 flex items-start gap-1.5 px-4 text-xs">
          <MapPin className="mt-0.5 size-3.5 shrink-0" />
          {order.deliveryAddress}
        </p>
      )}

      {order.notes && (
        <p className="mt-2.5 rounded-md bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
          {order.notes}
        </p>
      )}

      <div className="border-line/60 mt-3 flex items-center justify-between gap-3 border-t px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="tabular text-[0.9375rem] font-semibold">
            {formatCentsCompact(order.totalCents)}
          </span>
          <Badge className={cn('text-[0.6875rem]', PAYMENT_STATUS_STYLES[order.paymentStatus])}>
            {PAYMENT_STATUS_LABELS[order.paymentStatus]}
          </Badge>
        </div>

        <StatusButton
          orderId={order.id}
          status={order.status}
          fulfillmentType={order.fulfillmentType}
          size="sm"
        />
      </div>
    </article>
  )
}
