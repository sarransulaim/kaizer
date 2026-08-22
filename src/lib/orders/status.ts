import type { FulfillmentType, OrderStatus, PaymentStatus } from '@/lib/db/schema'

/**
 * The order lifecycle, in one place. Every status transition in the app is
 * validated against `allowedTransitions` so an order can't jump from `new`
 * straight to `completed` because of a mis-tapped button on a phone.
 */

export const ORDER_STATUSES: OrderStatus[] = [
  'new',
  'confirmed',
  'prepping',
  'ready',
  'out_for_delivery',
  'completed',
  'cancelled',
]

/** Statuses that represent an order still needing attention. */
export const ACTIVE_STATUSES: OrderStatus[] = [
  'new',
  'confirmed',
  'prepping',
  'ready',
  'out_for_delivery',
]

export const TERMINAL_STATUSES: OrderStatus[] = ['completed', 'cancelled']

export const STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'New',
  confirmed: 'Confirmed',
  prepping: 'Prepping',
  ready: 'Ready',
  out_for_delivery: 'Out for delivery',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

/**
 * Tailwind classes per status. Colours are consistent everywhere a status
 * appears — board column, badge, kitchen display — so the meaning is learned
 * once.
 */
export const STATUS_STYLES: Record<OrderStatus, string> = {
  new: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  confirmed: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  prepping: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',
  ready: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  out_for_delivery: 'bg-cyan-500/15 text-cyan-300 ring-cyan-500/30',
  completed: 'bg-zinc-500/15 text-zinc-400 ring-zinc-500/30',
  cancelled: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
}

/**
 * Valid forward transitions. Delivery orders route through `out_for_delivery`;
 * pickup and dine-in go straight from `ready` to `completed`.
 */
const BASE_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ['confirmed', 'prepping', 'cancelled'],
  confirmed: ['prepping', 'cancelled'],
  prepping: ['ready', 'cancelled'],
  ready: ['completed', 'cancelled'],
  out_for_delivery: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
}

export function allowedTransitions(
  from: OrderStatus,
  fulfillment: FulfillmentType,
): OrderStatus[] {
  if (from === 'ready' && fulfillment === 'delivery') {
    return ['out_for_delivery', 'cancelled']
  }
  return BASE_TRANSITIONS[from]
}

export function canTransition(
  from: OrderStatus,
  to: OrderStatus,
  fulfillment: FulfillmentType,
): boolean {
  return allowedTransitions(from, fulfillment).includes(to)
}

/**
 * The single most likely next step, used for the one-tap primary button on the
 * today board. Returns null for terminal statuses.
 */
export function nextStatus(
  from: OrderStatus,
  fulfillment: FulfillmentType,
): OrderStatus | null {
  const forward = allowedTransitions(from, fulfillment).filter(
    (s) => s !== 'cancelled',
  )
  return forward[0] ?? null
}

/** Verb for the button that advances to `nextStatus`. */
export const ADVANCE_LABELS: Record<OrderStatus, string> = {
  new: 'Confirm',
  confirmed: 'Start prep',
  prepping: 'Mark ready',
  ready: 'Complete',
  out_for_delivery: 'Mark delivered',
  completed: '',
  cancelled: '',
}

export function advanceLabel(
  from: OrderStatus,
  fulfillment: FulfillmentType,
): string {
  if (from === 'ready' && fulfillment === 'delivery') return 'Send out'
  return ADVANCE_LABELS[from]
}

/* -------------------------------------------------------------------------- */

export const FULFILLMENT_LABELS: Record<FulfillmentType, string> = {
  dine_in: 'Dine-in',
  pickup: 'Pickup',
  delivery: 'Delivery',
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: 'Unpaid',
  partial: 'Partial',
  paid: 'Paid',
  refunded: 'Refunded',
}

export const PAYMENT_STATUS_STYLES: Record<PaymentStatus, string> = {
  unpaid: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  partial: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  paid: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  refunded: 'bg-zinc-500/15 text-zinc-400 ring-zinc-500/30',
}

/** Derive payment status from what's been collected against the order total. */
export function derivePaymentStatus(
  amountPaidCents: number,
  totalCents: number,
): PaymentStatus {
  if (amountPaidCents <= 0) return 'unpaid'
  if (amountPaidCents >= totalCents) return 'paid'
  return 'partial'
}
