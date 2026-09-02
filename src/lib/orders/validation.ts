import { z } from 'zod'

import {
  fulfillmentTypeEnum,
  orderChannelEnum,
  orderStatusEnum,
  paymentMethodEnum,
} from '@/lib/db/schema'
import { isValidPhone } from '@/lib/phone'

/**
 * One schema, used by both the client form and the server action. The client
 * gets instant feedback; the server re-validates because a server action is a
 * public HTTP endpoint and client-side validation is a convenience, not a
 * guarantee.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a service date')

const clockTime = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Pick a service time')

/** A line taken from the menu. Its price is looked up server-side. */
export const menuItemInputSchema = z.object({
  variantId: z.uuid(),
  quantity: z.number().int().min(1).max(999),
  notes: z.string().max(280).optional(),
})

/**
 * A one-off line that is not on the menu — a special request, a cake somebody
 * asked for, a delivery surcharge.
 *
 * Its price arrives from the client, which is the one place in this app that
 * happens: there is nowhere else it could come from, since the item exists
 * nowhere but this order. That is acceptable only because taking an order
 * requires the office passcode, so whoever types the price is whoever sets
 * prices. Menu lines still ignore any price the client sends.
 */
export const customItemInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the item a name').max(120),
  priceCents: z.number().int().min(0).max(1_000_000),
  quantity: z.number().int().min(1).max(999),
  notes: z.string().max(280).optional(),
})

export const orderItemInputSchema = z.union([
  menuItemInputSchema,
  customItemInputSchema,
])

export const createOrderSchema = z
  .object({
    customerName: z.string().trim().min(1, 'Name is required').max(120),
    phone: z
      .string()
      .trim()
      .refine(isValidPhone, 'Enter a 10-digit phone number'),
    email: z.union([z.email(), z.literal('')]).optional(),

    channel: z.enum(orderChannelEnum.enumValues),
    fulfillmentType: z.enum(fulfillmentTypeEnum.enumValues),

    serviceDate: isoDate,
    serviceTime: clockTime,

    deliveryAddress: z.string().trim().max(500).optional(),

    items: z.array(orderItemInputSchema).min(1, 'Add at least one item'),

    discountCents: z.number().int().min(0).default(0),

    amountPaidCents: z.number().int().min(0).default(0),
    paymentMethod: z.enum(paymentMethodEnum.enumValues).optional(),
    paymentRef: z.string().trim().max(200).optional(),

    notes: z.string().trim().max(2000).optional(),
    customerNotes: z.string().trim().max(2000).optional(),
  })
  .refine(
    (data) =>
      data.fulfillmentType !== 'delivery' ||
      (data.deliveryAddress?.trim().length ?? 0) > 0,
    {
      message: 'A delivery address is required for delivery orders',
      path: ['deliveryAddress'],
    },
  )

export type CreateOrderInput = z.input<typeof createOrderSchema>
export type ParsedOrderInput = z.output<typeof createOrderSchema>

export const updateStatusSchema = z.object({
  orderId: z.uuid(),
  status: z.enum(orderStatusEnum.enumValues),
})

export const updatePaymentSchema = z.object({
  orderId: z.uuid(),
  amountPaidCents: z.number().int().min(0),
  paymentMethod: z.enum(paymentMethodEnum.enumValues).optional(),
  paymentRef: z.string().trim().max(200).optional(),
})

/* -------------------------------------------------------------------------- */
/*                              Editing an order                              */
/* -------------------------------------------------------------------------- */

/**
 * Everything about an order that is not its items or its money.
 *
 * Orders arrive over WhatsApp and change over WhatsApp — a time moves, a pickup
 * becomes a delivery — so these have to be editable after the fact rather than
 * only at the moment the order is taken.
 */
export const updateOrderDetailsSchema = z
  .object({
    orderId: z.uuid(),
    customerName: z.string().trim().min(1, 'Name is required').max(120),
    phone: z.string().trim().refine(isValidPhone, 'Enter a 10-digit phone number'),
    channel: z.enum(orderChannelEnum.enumValues),
    fulfillmentType: z.enum(fulfillmentTypeEnum.enumValues),
    serviceDate: isoDate,
    serviceTime: clockTime,
    deliveryAddress: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(2000).optional(),
    customerNotes: z.string().trim().max(2000).optional(),
  })
  .refine(
    (data) =>
      data.fulfillmentType !== 'delivery' ||
      (data.deliveryAddress?.trim().length ?? 0) > 0,
    {
      message: 'A delivery address is required for delivery orders',
      path: ['deliveryAddress'],
    },
  )

export type UpdateOrderDetailsInput = z.input<typeof updateOrderDetailsSchema>

/**
 * The line items, replaced wholesale rather than patched.
 *
 * An edit is "here is what the order is now", which is how the operator thinks
 * about it after a phone call. Working out a diff of adds, removes and quantity
 * changes would be more code for the same result.
 */
export const updateOrderItemsSchema = z.object({
  orderId: z.uuid(),
  items: z.array(orderItemInputSchema).min(1, 'An order needs at least one item'),
  discountCents: z.number().int().min(0).default(0),
})

export type UpdateOrderItemsInput = z.input<typeof updateOrderItemsSchema>

export const deleteOrderSchema = z.object({
  orderId: z.uuid(),
})
