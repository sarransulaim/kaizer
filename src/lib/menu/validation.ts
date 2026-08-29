import { z } from 'zod'

/**
 * Menu editing schemas. As with orders, one schema serves both the client form
 * and the server action — the action re-validates because a server action is a
 * public HTTP endpoint whatever the form did first.
 */

/** A week and a half of lead time is already implausible; beyond that it is a typo. */
const MAX_LEAD_HOURS = 336

/** $10,000 for a single tray. High enough never to be hit, low enough to catch a slipped decimal. */
const MAX_PRICE_CENTS = 1_000_000

export const variantInputSchema = z.object({
  sizeLabel: z.string().trim().min(1, 'Give the size a name').max(60),
  priceCents: z
    .number({ error: 'Enter a price' })
    .int()
    .min(0, 'Price cannot be negative')
    .max(MAX_PRICE_CENTS, 'That price looks like a typo'),
  servesCount: z.number().int().min(1).max(1000).nullable(),
  active: z.boolean(),
})

export const menuItemInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  category: z.string().trim().min(1).max(60),
  description: z.string().trim().max(500).nullable(),
  /* Generous: a recipe is a method, and cooks write in whole sentences. */
  recipe: z.string().trim().max(8000).nullable(),
  prepLeadHours: z
    .number({ error: 'Enter a lead time in hours' })
    .int()
    .min(0, 'Lead time cannot be negative')
    .max(MAX_LEAD_HOURS, 'That lead time looks like a typo'),
  active: z.boolean(),
})

export const newMenuItemSchema = menuItemInputSchema.extend({
  variants: z.array(variantInputSchema).min(1, 'Add at least one size'),
})

export type MenuItemInput = z.input<typeof menuItemInputSchema>
export type VariantInput = z.input<typeof variantInputSchema>
export type NewMenuItemInput = z.input<typeof newMenuItemSchema>
