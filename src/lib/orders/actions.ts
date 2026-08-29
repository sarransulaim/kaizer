'use server'

import { and, eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { getCurrentActor } from '@/lib/actor'
import { TAX_RATE } from '@/lib/config'
import { db } from '@/lib/db'
import {
  customers,
  menuVariants,
  orderEvents,
  orderItems,
  orders,
  type OrderStatus,
} from '@/lib/db/schema'
import { normalizePhone } from '@/lib/phone'
import { publishOrderChange } from '@/lib/realtime'
import { toServiceInstant } from '@/lib/time'
import { canTransition, derivePaymentStatus, STATUS_LABELS } from './status'
import {
  createOrderSchema,
  updatePaymentSchema,
  updateStatusSchema,
  type CreateOrderInput,
} from './validation'

export type ActionResult<T = void> =
  | ({ ok: true } & (T extends void ? object : { data: T }))
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

/** Refresh every surface an order can appear on. */
function revalidateOrderViews(orderId?: string) {
  /* The dashboard carries today, upcoming and all-orders on one route now, so
     revalidating '/' covers all three views. */
  revalidatePath('/')
  revalidatePath('/prep')
  revalidatePath('/kitchen')
  if (orderId) revalidatePath(`/orders/${orderId}`)
}

/* -------------------------------------------------------------------------- */
/*                               Create order                                 */
/* -------------------------------------------------------------------------- */

export async function createOrder(
  input: CreateOrderInput,
): Promise<ActionResult<{ orderId: string; orderNumber: number }>> {
  const parsed = createOrderSchema.safeParse(input)

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || 'form'
      fieldErrors[key] ??= issue.message
    }
    return { ok: false, error: 'Please fix the highlighted fields', fieldErrors }
  }

  const data = parsed.data
  const actor = await getCurrentActor()
  const phone = normalizePhone(data.phone)

  try {
    const result = await db.transaction(async (tx) => {
      /* Customer — phone is the identity key, so a repeat caller is matched
         rather than duplicated. */
      const [customer] = await tx
        .insert(customers)
        .values({
          name: data.customerName,
          phone,
          email: data.email || null,
        })
        .onConflictDoUpdate({
          target: customers.phone,
          set: {
            name: data.customerName,
            ...(data.email ? { email: data.email } : {}),
            updatedAt: new Date(),
          },
        })
        .returning()

      /* Resolve the variants in one query, then snapshot their name, size and
         price onto the line items. Prices are read from the database, never
         from the client payload. */
      const variantIds = data.items.map((i) => i.variantId)
      const variants = await tx.query.menuVariants.findMany({
        where: inArray(menuVariants.id, variantIds),
        with: { item: true },
      })

      const variantMap = new Map(variants.map((v) => [v.id, v]))
      const missing = variantIds.filter((id) => !variantMap.has(id))
      if (missing.length > 0) {
        throw new Error('One of the selected menu items is no longer available')
      }

      const lines = data.items.map((line) => {
        const variant = variantMap.get(line.variantId)!
        return {
          menuVariantId: variant.id,
          itemNameSnapshot: variant.item.name,
          sizeLabelSnapshot: variant.sizeLabel,
          unitPriceCents: variant.priceCents,
          quantity: line.quantity,
          lineTotalCents: variant.priceCents * line.quantity,
          notes: line.notes || null,
        }
      })

      const subtotalCents = lines.reduce((sum, l) => sum + l.lineTotalCents, 0)
      const discountCents = Math.min(data.discountCents, subtotalCents)
      const taxCents = Math.round((subtotalCents - discountCents) * TAX_RATE)
      const totalCents = subtotalCents - discountCents + taxCents
      const amountPaidCents = Math.min(data.amountPaidCents, totalCents)

      const [order] = await tx
        .insert(orders)
        .values({
          customerId: customer.id,
          channel: data.channel,
          fulfillmentType: data.fulfillmentType,
          serviceDate: data.serviceDate,
          serviceTime: data.serviceTime,
          serviceAt: toServiceInstant(data.serviceDate, data.serviceTime),
          subtotalCents,
          discountCents,
          taxCents,
          totalCents,
          amountPaidCents,
          paymentStatus: derivePaymentStatus(amountPaidCents, totalCents),
          paymentMethod: data.paymentMethod,
          paymentRef: data.paymentRef || null,
          deliveryAddress: data.deliveryAddress || null,
          notes: data.notes || null,
          customerNotes: data.customerNotes || null,
          createdById: actor.id,
          updatedById: actor.id,
        })
        .returning()

      await tx
        .insert(orderItems)
        .values(lines.map((line) => ({ ...line, orderId: order.id })))

      await tx.insert(orderEvents).values({
        orderId: order.id,
        type: 'created',
        toStatus: order.status,
        message: `Order taken via ${data.channel.replace('_', ' ')}`,
        actorId: actor.id,
        actorName: actor.name,
      })

      return { order, serviceDate: order.serviceDate }
    })

    await publishOrderChange({
      type: 'created',
      orderId: result.order.id,
      serviceDate: result.serviceDate,
    })

    revalidateOrderViews(result.order.id)

    return {
      ok: true,
      data: { orderId: result.order.id, orderNumber: result.order.orderNumber },
    }
  } catch (error) {
    console.error('[createOrder]', error)
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : 'Could not save the order',
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                              Update status                                 */
/* -------------------------------------------------------------------------- */

export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
): Promise<ActionResult> {
  const parsed = updateStatusSchema.safeParse({ orderId, status })
  if (!parsed.success) return { ok: false, error: 'Invalid status change' }

  const actor = await getCurrentActor()

  try {
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
    })
    if (!order) return { ok: false, error: 'Order not found' }

    if (order.status === status) return { ok: true }

    /* The status machine is enforced server-side. A mis-tapped button on a
       phone must not be able to skip an order straight to completed. */
    if (!canTransition(order.status, status, order.fulfillmentType)) {
      return {
        ok: false,
        error: `Cannot move from ${STATUS_LABELS[order.status]} to ${STATUS_LABELS[status]}`,
      }
    }

    const now = new Date()

    await db.transaction(async (tx) => {
      await tx
        .update(orders)
        .set({
          status,
          updatedById: actor.id,
          updatedAt: now,
          completedAt: status === 'completed' ? now : order.completedAt,
          cancelledAt: status === 'cancelled' ? now : order.cancelledAt,
        })
        .where(eq(orders.id, orderId))

      await tx.insert(orderEvents).values({
        orderId,
        type: status === 'cancelled' ? 'cancelled' : 'status_changed',
        fromStatus: order.status,
        toStatus: status,
        message: `${STATUS_LABELS[order.status]} → ${STATUS_LABELS[status]}`,
        actorId: actor.id,
        actorName: actor.name,
      })
    })

    await publishOrderChange({
      type: 'status',
      orderId,
      serviceDate: order.serviceDate,
    })

    revalidateOrderViews(orderId)
    return { ok: true }
  } catch (error) {
    console.error('[updateOrderStatus]', error)
    return { ok: false, error: 'Could not update the order status' }
  }
}

/* -------------------------------------------------------------------------- */
/*                              Update payment                                */
/* -------------------------------------------------------------------------- */

export async function updatePayment(input: {
  orderId: string
  amountPaidCents: number
  paymentMethod?: 'zelle' | 'cash' | 'card' | 'venmo' | 'other'
  paymentRef?: string
}): Promise<ActionResult> {
  const parsed = updatePaymentSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid payment details' }

  const data = parsed.data
  const actor = await getCurrentActor()

  try {
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, data.orderId),
    })
    if (!order) return { ok: false, error: 'Order not found' }

    const amountPaidCents = Math.min(data.amountPaidCents, order.totalCents)
    const paymentStatus = derivePaymentStatus(amountPaidCents, order.totalCents)

    await db.transaction(async (tx) => {
      await tx
        .update(orders)
        .set({
          amountPaidCents,
          paymentStatus,
          paymentMethod: data.paymentMethod ?? order.paymentMethod,
          paymentRef: data.paymentRef ?? order.paymentRef,
          updatedById: actor.id,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, data.orderId))

      await tx.insert(orderEvents).values({
        orderId: data.orderId,
        type: 'payment_updated',
        message: `Payment recorded: ${(amountPaidCents / 100).toFixed(2)} of ${(order.totalCents / 100).toFixed(2)}`,
        meta: {
          from: order.amountPaidCents,
          to: amountPaidCents,
          method: data.paymentMethod ?? order.paymentMethod,
        },
        actorId: actor.id,
        actorName: actor.name,
      })
    })

    await publishOrderChange({
      type: 'payment',
      orderId: data.orderId,
      serviceDate: order.serviceDate,
    })

    revalidateOrderViews(data.orderId)
    return { ok: true }
  } catch (error) {
    console.error('[updatePayment]', error)
    return { ok: false, error: 'Could not record the payment' }
  }
}

/* -------------------------------------------------------------------------- */
/*                             Customer lookup                                */
/* -------------------------------------------------------------------------- */

/** Called from the order form as the operator types a phone number. */
export async function lookupCustomer(phoneInput: string) {
  const phone = normalizePhone(phoneInput)
  if (phone.length < 10) return null

  const customer = await db.query.customers.findFirst({
    where: eq(customers.phone, phone),
  })
  if (!customer) return null

  const recent = await db.query.orders.findMany({
    where: and(eq(orders.customerId, customer.id)),
    orderBy: (o, { desc }) => [desc(o.serviceAt)],
    limit: 3,
    with: { items: true },
  })

  return { customer, recentOrders: recent }
}
