'use server'

import { and, eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { getCurrentActor } from '@/lib/actor'
import { isSignedIn } from '@/lib/auth/guard'
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
  deleteOrderSchema,
  updateOrderDetailsSchema,
  updateOrderItemsSchema,
  updatePaymentSchema,
  updateStatusSchema,
  type CreateOrderInput,
  type ParsedOrderInput,
  type UpdateOrderDetailsInput,
  type UpdateOrderItemsInput,
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
  revalidatePath('/analytics')
  if (orderId) revalidatePath(`/orders/${orderId}`)
}

/* -------------------------------------------------------------------------- */
/*                            Pricing order lines                             */
/* -------------------------------------------------------------------------- */

type ResolvedLine = {
  menuVariantId: string | null
  itemNameSnapshot: string
  sizeLabelSnapshot: string
  unitPriceCents: number
  quantity: number
  lineTotalCents: number
  notes: string | null
}

type SubmittedItems = ParsedOrderInput['items']

/**
 * Turn submitted lines into priced line items.
 *
 * Shared by taking an order and by editing one, deliberately. If those two
 * priced things differently an order would change value merely by being
 * edited, and nobody would notice until a week of takings failed to
 * reconcile.
 *
 * A menu line names a variant and nothing else: its price is read from the
 * database, never from the client. A custom line exists only on this order,
 * so its name and price can only have come from the operator — who needed the
 * office passcode to get here.
 */
async function resolveLines(
  tx: Pick<typeof db, 'query'>,
  items: SubmittedItems,
): Promise<ResolvedLine[]> {
  const menuLines = items.filter((line) => 'variantId' in line)
  const customLines = items.filter((line) => 'name' in line)

  const variantIds = menuLines.map((line) => line.variantId)
  const variants =
    variantIds.length > 0
      ? await tx.query.menuVariants.findMany({
          where: inArray(menuVariants.id, variantIds),
          with: { item: true },
        })
      : []

  const variantMap = new Map(variants.map((v) => [v.id, v]))
  const missing = variantIds.filter((id) => !variantMap.has(id))
  if (missing.length > 0) {
    throw new Error('One of the selected menu items is no longer available')
  }

  return [
    ...menuLines.map((line) => {
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
    }),
    ...customLines.map((line) => ({
      /* No variant to point at. Reporting left-joins the menu, so a null here
         shows up as an uncategorised line rather than dropping the row. */
      menuVariantId: null,
      itemNameSnapshot: line.name,
      sizeLabelSnapshot: 'Custom',
      unitPriceCents: line.priceCents,
      quantity: line.quantity,
      lineTotalCents: line.priceCents * line.quantity,
      notes: line.notes || null,
    })),
  ]
}

/* -------------------------------------------------------------------------- */
/*                               Create order                                 */
/* -------------------------------------------------------------------------- */

export async function createOrder(
  input: CreateOrderInput,
): Promise<ActionResult<{ orderId: string; orderNumber: number }>> {
  const parsed = createOrderSchema.safeParse(input)

  if (!parsed.success) {
  if (!(await isSignedIn())) {
    return { ok: false, error: 'Not signed in' }
  }

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

      const lines = await resolveLines(tx, data.items)

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
  if (!(await isSignedIn())) {
    return { ok: false, error: 'Not signed in' }
  }

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
  if (!(await isSignedIn())) return null

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

/* -------------------------------------------------------------------------- */
/*                              Edit an order                                 */
/* -------------------------------------------------------------------------- */

/**
 * Change everything about an order except its items and its money.
 *
 * Orders arrive over WhatsApp and change over WhatsApp: a time moves, a pickup
 * becomes a delivery, a name was taken down wrong. Before this the only way to
 * fix any of that was to cancel and re-take the order, which threw away its
 * history and its order number.
 */
export async function updateOrderDetails(
  input: UpdateOrderDetailsInput,
): Promise<ActionResult> {
  if (!(await isSignedIn())) {
    return { ok: false, error: 'Not signed in' }
  }

  const parsed = updateOrderDetailsSchema.safeParse(input)
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
    const existing = await db.query.orders.findFirst({
      where: eq(orders.id, data.orderId),
      with: { customer: true },
    })
    if (!existing) return { ok: false, error: 'Order not found' }

    const changes: string[] = []
    if (existing.customer.name !== data.customerName) {
      changes.push(`name → ${data.customerName}`)
    }
    if (existing.customer.phone !== phone) changes.push('phone changed')
    if (existing.serviceDate !== data.serviceDate) {
      changes.push(`date → ${data.serviceDate}`)
    }
    if (existing.serviceTime.slice(0, 5) !== data.serviceTime.slice(0, 5)) {
      changes.push(`time → ${data.serviceTime}`)
    }
    if (existing.fulfillmentType !== data.fulfillmentType) {
      changes.push(`${existing.fulfillmentType} → ${data.fulfillmentType}`)
    }
    if (existing.channel !== data.channel) changes.push(`via ${data.channel}`)
    if ((existing.notes ?? '') !== (data.notes ?? '')) changes.push('kitchen note')
    if ((existing.customerNotes ?? '') !== (data.customerNotes ?? '')) {
      changes.push('customer request')
    }
    if ((existing.deliveryAddress ?? '') !== (data.deliveryAddress ?? '')) {
      changes.push('address')
    }

    if (changes.length === 0) return { ok: true }

    await db.transaction(async (tx) => {
      /* Phone is the identity key, so a corrected number moves the order to
         whichever customer owns that number — creating them if new — rather
         than quietly renaming an existing customer's record. */
      const [customer] = await tx
        .insert(customers)
        .values({ name: data.customerName, phone })
        .onConflictDoUpdate({
          target: customers.phone,
          set: { name: data.customerName, updatedAt: new Date() },
        })
        .returning()

      await tx
        .update(orders)
        .set({
          customerId: customer.id,
          channel: data.channel,
          fulfillmentType: data.fulfillmentType,
          serviceDate: data.serviceDate,
          serviceTime: data.serviceTime,
          serviceAt: toServiceInstant(data.serviceDate, data.serviceTime),
          deliveryAddress: data.deliveryAddress || null,
          notes: data.notes || null,
          customerNotes: data.customerNotes || null,
          updatedById: actor.id,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, data.orderId))

      await tx.insert(orderEvents).values({
        orderId: data.orderId,
        type: 'updated',
        message: `Edited: ${changes.join(', ')}`,
        actorId: actor.id,
        actorName: actor.name,
      })
    })

    await publishOrderChange({
      type: 'updated',
      orderId: data.orderId,
      serviceDate: data.serviceDate,
    })

    revalidateOrderViews(data.orderId)
    return { ok: true }
  } catch (error) {
    console.error('[updateOrderDetails]', error)
    return { ok: false, error: 'Could not save those changes' }
  }
}

/**
 * Replace an order's items and re-total it.
 *
 * Wholesale replacement rather than a diff of adds, removes and quantity
 * changes: an edit is "here is what the order is now", which is how it is
 * described on the phone, and computing the difference would be more code for
 * the same result.
 */
export async function updateOrderItems(
  input: UpdateOrderItemsInput,
): Promise<ActionResult> {
  if (!(await isSignedIn())) {
    return { ok: false, error: 'Not signed in' }
  }

  const parsed = updateOrderItemsSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Check the items',
    }
  }

  const data = parsed.data
  const actor = await getCurrentActor()

  try {
    const existing = await db.query.orders.findFirst({
      where: eq(orders.id, data.orderId),
    })
    if (!existing) return { ok: false, error: 'Order not found' }
    if (existing.status === 'cancelled') {
      return { ok: false, error: 'This order is cancelled. Nothing to edit.' }
    }

    const result = await db.transaction(async (tx) => {
      const lines = await resolveLines(tx, data.items)

      const subtotalCents = lines.reduce((sum, l) => sum + l.lineTotalCents, 0)
      const discountCents = Math.min(data.discountCents, subtotalCents)
      const taxCents = Math.round((subtotalCents - discountCents) * TAX_RATE)
      const totalCents = subtotalCents - discountCents + taxCents

      /**
       * What has already been paid is left exactly as it is. Clamping it down
       * to a reduced total would erase the record of money actually received —
       * if an order shrinks below what was handed over, the business owes a
       * refund, and that is a fact to surface rather than round away.
       */
      const paymentStatus = derivePaymentStatus(
        existing.amountPaidCents,
        totalCents,
      )

      await tx.delete(orderItems).where(eq(orderItems.orderId, data.orderId))
      await tx
        .insert(orderItems)
        .values(lines.map((line) => ({ ...line, orderId: data.orderId })))

      await tx
        .update(orders)
        .set({
          subtotalCents,
          discountCents,
          taxCents,
          totalCents,
          paymentStatus,
          updatedById: actor.id,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, data.orderId))

      const overpaid = existing.amountPaidCents - totalCents
      const summary = lines
        .map((l) => `${l.quantity}× ${l.itemNameSnapshot}`)
        .join(', ')

      await tx.insert(orderEvents).values({
        orderId: data.orderId,
        type: 'items_changed',
        message:
          `Items changed to ${summary}. Total ` +
          `${(existing.totalCents / 100).toFixed(2)} → ${(totalCents / 100).toFixed(2)}` +
          (overpaid > 0 ? `. Refund due ${(overpaid / 100).toFixed(2)}` : ''),
        meta: {
          from: existing.totalCents,
          to: totalCents,
          refundDueCents: overpaid > 0 ? overpaid : 0,
        },
        actorId: actor.id,
        actorName: actor.name,
      })

      return { totalCents, refundDue: overpaid > 0 ? overpaid : 0 }
    })

    await publishOrderChange({
      type: 'updated',
      orderId: data.orderId,
      serviceDate: existing.serviceDate,
    })

    revalidateOrderViews(data.orderId)

    return result.refundDue > 0
      ? {
          ok: false,
          error: `Saved. Note this order is now ${(result.refundDue / 100).toFixed(2)} overpaid — a refund is due.`,
        }
      : { ok: true }
  } catch (error) {
    console.error('[updateOrderItems]', error)
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : 'Could not save those items',
    }
  }
}

/**
 * Remove an order permanently.
 *
 * Distinct from cancelling, which keeps the order, its history and its place in
 * the day's record. This is for orders that should never have existed — a
 * duplicate, a test, a mis-tap — and it takes the line items and the audit
 * trail with it. There is no undo, which is why the screen offering it says so
 * and points at cancelling instead.
 */
export async function deleteOrder(orderId: string): Promise<ActionResult> {
  if (!(await isSignedIn())) {
    return { ok: false, error: 'Not signed in' }
  }

  const parsed = deleteOrderSchema.safeParse({ orderId })
  if (!parsed.success) return { ok: false, error: 'Invalid order' }

  try {
    const existing = await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
      with: { customer: true },
    })
    if (!existing) return { ok: false, error: 'Order not found' }

    /* Logged before the row goes, because afterwards there is nothing left to
       say what was removed — the items and events cascade with it. */
    console.warn(
      `[deleteOrder] #${existing.orderNumber} ${existing.customer.name} ` +
        `${existing.serviceDate} total=${existing.totalCents} ` +
        `paid=${existing.amountPaidCents}`,
    )

    await db.delete(orders).where(eq(orders.id, orderId))

    await publishOrderChange({
      type: 'deleted',
      orderId,
      serviceDate: existing.serviceDate,
    })

    revalidateOrderViews()
    return { ok: true }
  } catch (error) {
    console.error('[deleteOrder]', error)
    return { ok: false, error: 'Could not delete that order' }
  }
}
