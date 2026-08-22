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

export const orderItemInputSchema = z.object({
  variantId: z.uuid(),
  quantity: z.number().int().min(1).max(999),
  notes: z.string().max(280).optional(),
})

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
