import {
  ArrowLeft,
  Bike,
  MapPin,
  Phone,
  ShoppingBag,
  UtensilsCrossed,
} from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { CancelButton } from '@/components/orders/cancel-button'
import { PaymentPanel } from '@/components/orders/payment-panel'
import { StatusButton } from '@/components/orders/status-button'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import type { FulfillmentType } from '@/lib/db/schema'
import { formatCents, formatCentsCompact } from '@/lib/money'
import { getOrderById } from '@/lib/orders/queries'
import {
  FULFILLMENT_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_STYLES,
  STATUS_LABELS,
  STATUS_STYLES,
  TERMINAL_STATUSES,
} from '@/lib/orders/status'
import { formatPhone, toTelHref } from '@/lib/phone'
import { dayLabel, formatDateLong, formatTime } from '@/lib/time'

export const dynamic = 'force-dynamic'

const FULFILLMENT_ICONS: Record<FulfillmentType, typeof Bike> = {
  delivery: Bike,
  pickup: ShoppingBag,
  dine_in: UtensilsCrossed,
}

export async function generateMetadata(props: PageProps<'/orders/[id]'>) {
  const { id } = await props.params
  const order = await getOrderById(id)
  return { title: order ? `Order #${order.orderNumber}` : 'Order' }
}

export default async function OrderDetailPage(props: PageProps<'/orders/[id]'>) {
  const { id } = await props.params
  const order = await getOrderById(id)

  if (!order) notFound()

  const FulfillmentIcon = FULFILLMENT_ICONS[order.fulfillmentType]
  const isOpen = !TERMINAL_STATUSES.includes(order.status)
  const outstanding = order.totalCents - order.amountPaidCents

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 lg:py-8">
      <Link
        href="/"
        className="text-ink-faint hover:text-ink mb-3 inline-flex items-center gap-1 text-sm transition"
      >
        <ArrowLeft className="size-4" />
        Back
      </Link>

      <header className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {order.customer.name}
          </h1>
          <p className="text-ink-faint tabular text-sm">
            Order #{order.orderNumber} · {dayLabel(order.serviceDate)} at{' '}
            {formatTime(order.serviceTime)}
          </p>
        </div>
        <Badge className={STATUS_STYLES[order.status]}>
          {STATUS_LABELS[order.status]}
        </Badge>
      </header>

      {isOpen && (
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <StatusButton
            orderId={order.id}
            status={order.status}
            fulfillmentType={order.fulfillmentType}
            size="lg"
          />
          <CancelButton orderId={order.id} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* --------------------------- Details --------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2.5 text-sm">
            <Row label="When">
              {formatDateLong(order.serviceDate)} · {formatTime(order.serviceTime)}
            </Row>
            <Row label="Type">
              <span className="inline-flex items-center gap-1.5">
                <FulfillmentIcon className="size-4" />
                {FULFILLMENT_LABELS[order.fulfillmentType]}
              </span>
            </Row>
            <Row label="Phone">
              <a
                href={toTelHref(order.customer.phone)}
                className="hover:text-accent inline-flex items-center gap-1.5 transition"
              >
                <Phone className="size-4" />
                {formatPhone(order.customer.phone)}
              </a>
            </Row>
            {order.customer.email && <Row label="Email">{order.customer.email}</Row>}
            <Row label="Source">{order.channel.replace('_', ' ')}</Row>
            {order.deliveryAddress && (
              <Row label="Address">
                <span className="inline-flex items-start gap-1.5">
                  <MapPin className="mt-0.5 size-4 shrink-0" />
                  {order.deliveryAddress}
                </span>
              </Row>
            )}
          </CardBody>
        </Card>

        {/* --------------------------- Payment --------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>Payment</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="flex items-center justify-between">
              <Badge className={PAYMENT_STATUS_STYLES[order.paymentStatus]}>
                {PAYMENT_STATUS_LABELS[order.paymentStatus]}
              </Badge>
              <span className="tabular text-sm">
                {formatCents(order.amountPaidCents)} of{' '}
                {formatCents(order.totalCents)}
                {outstanding > 0 && (
                  <span className="ml-1.5 text-amber-400">
                    ({formatCentsCompact(outstanding)} due)
                  </span>
                )}
              </span>
            </div>

            {order.paymentRef && (
              <p className="text-ink-muted text-xs">
                Zelle from: <span className="text-ink">{order.paymentRef}</span>
              </p>
            )}

            <PaymentPanel
              orderId={order.id}
              totalCents={order.totalCents}
              amountPaidCents={order.amountPaidCents}
              paymentMethod={order.paymentMethod}
              paymentRef={order.paymentRef}
            />
          </CardBody>
        </Card>

        {/* ---------------------------- Items ---------------------------- */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Items</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="divide-line/50 divide-y">
              {order.items.map((item) => (
                <li key={item.id} className="flex items-baseline gap-3 py-2.5">
                  <span className="tabular text-accent w-8 shrink-0 font-semibold">
                    {item.quantity}×
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    {item.itemNameSnapshot}
                    <span className="text-ink-faint"> · {item.sizeLabelSnapshot}</span>
                    {item.notes && (
                      <span className="text-ink-faint block text-xs">{item.notes}</span>
                    )}
                  </span>
                  <span className="tabular text-ink-muted shrink-0 text-xs">
                    {formatCentsCompact(item.unitPriceCents)} ea
                  </span>
                  <span className="tabular w-16 shrink-0 text-right text-sm">
                    {formatCents(item.lineTotalCents)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="border-line/60 mt-3 space-y-1 border-t pt-3 text-sm">
              <Total label="Subtotal" value={order.subtotalCents} />
              {order.discountCents > 0 && (
                <Total label="Discount" value={-order.discountCents} />
              )}
              {order.taxCents > 0 && <Total label="Tax" value={order.taxCents} />}
              <div className="flex justify-between pt-1 text-base font-semibold">
                <span>Total</span>
                <span className="tabular">{formatCents(order.totalCents)}</span>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* ---------------------------- Notes ---------------------------- */}
        {(order.notes || order.customerNotes) && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              {order.customerNotes && (
                <div>
                  <div className="text-ink-faint mb-1 text-xs">Customer asked for</div>
                  <p>{order.customerNotes}</p>
                </div>
              )}
              {order.notes && (
                <div>
                  <div className="text-ink-faint mb-1 text-xs">Kitchen note</div>
                  <p className="rounded-md bg-amber-500/10 px-3 py-2 text-amber-200">
                    {order.notes}
                  </p>
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {/* --------------------------- History --------------------------- */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardBody>
            <ol className="space-y-3">
              {order.events.map((event) => (
                <li key={event.id} className="flex gap-3 text-sm">
                  <span className="bg-line mt-1.5 size-1.5 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1">
                    <div>{event.message ?? event.type}</div>
                    <div className="text-ink-faint text-xs">
                      {event.actorName ?? 'System'} ·{' '}
                      {new Intl.DateTimeFormat('en-US', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                        timeZone: 'America/New_York',
                      }).format(event.createdAt)}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-ink-faint shrink-0">{label}</span>
      <span className="text-right capitalize">{children}</span>
    </div>
  )
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-ink-muted flex justify-between">
      <span>{label}</span>
      <span className="tabular">{formatCents(value)}</span>
    </div>
  )
}
