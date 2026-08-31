'use server'

import { asc, eq, sql } from 'drizzle-orm'
import { isSignedIn } from '@/lib/auth/guard'
import { revalidatePath } from 'next/cache'

import { db } from '@/lib/db'
import { menuItems, menuVariants, orderItems } from '@/lib/db/schema'
import type { ActionResult } from '@/lib/orders/actions'
import {
  menuItemInputSchema,
  newMenuItemSchema,
  variantInputSchema,
  type MenuItemInput,
  type NewMenuItemInput,
  type VariantInput,
} from './validation'

/**
 * Menu editing.
 *
 * The rule that shapes all of it: an order line holds its own snapshot of the
 * item name, size and price, so editing or retiring a menu entry never rewrites
 * history. What it must not do is break the foreign key — `order_items` points
 * at `menu_variants` with `ON DELETE RESTRICT`, deliberately, so that the
 * reporting join stays intact. Anything already ordered is therefore retired
 * (`active = false`) rather than deleted, and only genuinely unused entries can
 * be removed outright.
 */

/** The menu drives the order form, so both surfaces refresh together. */
function revalidateMenuViews() {
  revalidatePath('/settings')
  revalidatePath('/orders/new')
}

function fieldErrorsFrom(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || 'form'
    fieldErrors[key] ??= issue.message
  }
  return fieldErrors
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

  return slug || 'item'
}

/**
 * Slugs are unique, and two sizes of the same dish are a normal thing to want.
 * Rather than rejecting "Chicken Biryani" because one already exists, suffix it.
 */
async function uniqueSlug(base: string): Promise<string> {
  for (let attempt = 1; attempt <= 50; attempt++) {
    const candidate = attempt === 1 ? base : `${base}-${attempt}`
    const existing = await db.query.menuItems.findFirst({
      where: eq(menuItems.slug, candidate),
      columns: { id: true },
    })
    if (!existing) return candidate
  }

  throw new Error('Could not find a free slug for that name')
}

/** How many order lines reference a given size. */
async function variantUsage(variantId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(orderItems)
    .where(eq(orderItems.menuVariantId, variantId))

  return row?.count ?? 0
}

/** How many order lines reference any size of a given item. */
async function itemUsage(itemId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(orderItems)
    .innerJoin(menuVariants, eq(orderItems.menuVariantId, menuVariants.id))
    .where(eq(menuVariants.menuItemId, itemId))

  return row?.count ?? 0
}

/* -------------------------------------------------------------------------- */
/*                                   Items                                    */
/* -------------------------------------------------------------------------- */

export async function createMenuItem(
  input: NewMenuItemInput,
): Promise<ActionResult<{ itemId: string }>> {
  const parsed = newMenuItemSchema.safeParse(input)
  if (!parsed.success) {
  if (!(await isSignedIn())) {
    return { ok: false, error: 'Not signed in' }
  }

    return {
      ok: false,
      error: 'Please fix the highlighted fields',
      fieldErrors: fieldErrorsFrom(parsed.error),
    }
  }

  const data = parsed.data

  try {
    const slug = await uniqueSlug(slugify(data.name))

    const itemId = await db.transaction(async (tx) => {
      const [{ next }] = await tx
        .select({ next: sql<number>`COALESCE(MAX(${menuItems.sortOrder}), -1) + 1` })
        .from(menuItems)

      const [item] = await tx
        .insert(menuItems)
        .values({
          name: data.name,
          slug,
          category: data.category,
          description: data.description || null,
          recipe: data.recipe || null,
          prepLeadHours: data.prepLeadHours,
          active: data.active,
          sortOrder: Number(next),
        })
        .returning()

      await tx.insert(menuVariants).values(
        data.variants.map((variant, index) => ({
          menuItemId: item.id,
          sizeLabel: variant.sizeLabel,
          priceCents: variant.priceCents,
          servesCount: variant.servesCount,
          active: variant.active,
          sortOrder: index,
        })),
      )

      return item.id
    })

    revalidateMenuViews()
    return { ok: true, data: { itemId } }
  } catch (error) {
    console.error('[createMenuItem]', error)
    return { ok: false, error: messageFor(error, 'Could not add that item') }
  }
}

export async function updateMenuItem(
  itemId: string,
  input: MenuItemInput,
): Promise<ActionResult> {
  if (!(await isSignedIn())) {
    return { ok: false, error: 'Not signed in' }
  }

  const parsed = menuItemInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the highlighted fields',
      fieldErrors: fieldErrorsFrom(parsed.error),
    }
  }

  const data = parsed.data

  try {
    const existing = await db.query.menuItems.findFirst({
      where: eq(menuItems.id, itemId),
    })
    if (!existing) return { ok: false, error: 'That item no longer exists' }

    /* The slug only follows the name while nothing has been ordered against it.
       Once it is in an order's history, the slug is effectively an identifier
       and quietly changing it would break any link that used it. */
    const slug =
      existing.name === data.name || (await itemUsage(itemId)) > 0
        ? existing.slug
        : await uniqueSlug(slugify(data.name))

    await db
      .update(menuItems)
      .set({
        name: data.name,
        slug,
        category: data.category,
        description: data.description || null,
        recipe: data.recipe || null,
        prepLeadHours: data.prepLeadHours,
        active: data.active,
        updatedAt: new Date(),
      })
      .where(eq(menuItems.id, itemId))

    revalidateMenuViews()
    return { ok: true }
  } catch (error) {
    console.error('[updateMenuItem]', error)
    return { ok: false, error: messageFor(error, 'Could not save that item') }
  }
}

export async function setMenuItemActive(
  itemId: string,
  active: boolean,
): Promise<ActionResult> {
  if (!(await isSignedIn())) {
    return { ok: false, error: 'Not signed in' }
  }

  try {
    await db
      .update(menuItems)
      .set({ active, updatedAt: new Date() })
      .where(eq(menuItems.id, itemId))

    revalidateMenuViews()
    return { ok: true }
  } catch (error) {
    console.error('[setMenuItemActive]', error)
    return { ok: false, error: 'Could not change that item' }
  }
}

export async function deleteMenuItem(itemId: string): Promise<ActionResult> {
  if (!(await isSignedIn())) {
    return { ok: false, error: 'Not signed in' }
  }

  try {
    const used = await itemUsage(itemId)
    if (used > 0) {
      return {
        ok: false,
        error: `This item is on ${used} order line${used === 1 ? '' : 's'}. Turn it off instead — deleting it would break those orders.`,
      }
    }

    /* Variants cascade from the item, so this clears both. */
    await db.delete(menuItems).where(eq(menuItems.id, itemId))

    revalidateMenuViews()
    return { ok: true }
  } catch (error) {
    console.error('[deleteMenuItem]', error)
    return { ok: false, error: messageFor(error, 'Could not delete that item') }
  }
}

/**
 * Move an item one place up or down the menu. Every row is rewritten with its
 * new index rather than swapping two values, so a menu seeded with duplicate or
 * gappy sort orders straightens itself out the first time anything is moved.
 */
export async function moveMenuItem(
  itemId: string,
  direction: 'up' | 'down',
): Promise<ActionResult> {
  if (!(await isSignedIn())) {
    return { ok: false, error: 'Not signed in' }
  }

  try {
    const items = await db
      .select({ id: menuItems.id })
      .from(menuItems)
      .orderBy(asc(menuItems.sortOrder), asc(menuItems.name))

    const index = items.findIndex((item) => item.id === itemId)
    if (index === -1) return { ok: false, error: 'That item no longer exists' }

    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= items.length) return { ok: true }

    const reordered = [...items]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]

    await db.transaction(async (tx) => {
      for (const [position, item] of reordered.entries()) {
        await tx
          .update(menuItems)
          .set({ sortOrder: position })
          .where(eq(menuItems.id, item.id))
      }
    })

    revalidateMenuViews()
    return { ok: true }
  } catch (error) {
    console.error('[moveMenuItem]', error)
    return { ok: false, error: 'Could not reorder the menu' }
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Variants                                  */
/* -------------------------------------------------------------------------- */

export async function addVariant(
  itemId: string,
  input: VariantInput,
): Promise<ActionResult> {
  if (!(await isSignedIn())) {
    return { ok: false, error: 'Not signed in' }
  }

  const parsed = variantInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the highlighted fields',
      fieldErrors: fieldErrorsFrom(parsed.error),
    }
  }

  const data = parsed.data

  try {
    const [{ next }] = await db
      .select({
        next: sql<number>`COALESCE(MAX(${menuVariants.sortOrder}), -1) + 1`,
      })
      .from(menuVariants)
      .where(eq(menuVariants.menuItemId, itemId))

    await db.insert(menuVariants).values({
      menuItemId: itemId,
      sizeLabel: data.sizeLabel,
      priceCents: data.priceCents,
      servesCount: data.servesCount,
      active: data.active,
      sortOrder: Number(next),
    })

    revalidateMenuViews()
    return { ok: true }
  } catch (error) {
    console.error('[addVariant]', error)
    return {
      ok: false,
      error: messageFor(error, 'Could not add that size'),
    }
  }
}

export async function updateVariant(
  variantId: string,
  input: VariantInput,
): Promise<ActionResult> {
  if (!(await isSignedIn())) {
    return { ok: false, error: 'Not signed in' }
  }

  const parsed = variantInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the highlighted fields',
      fieldErrors: fieldErrorsFrom(parsed.error),
    }
  }

  const data = parsed.data

  try {
    await db
      .update(menuVariants)
      .set({
        sizeLabel: data.sizeLabel,
        priceCents: data.priceCents,
        servesCount: data.servesCount,
        active: data.active,
        updatedAt: new Date(),
      })
      .where(eq(menuVariants.id, variantId))

    revalidateMenuViews()
    return { ok: true }
  } catch (error) {
    console.error('[updateVariant]', error)
    return { ok: false, error: messageFor(error, 'Could not save that size') }
  }
}

export async function deleteVariant(variantId: string): Promise<ActionResult> {
  if (!(await isSignedIn())) {
    return { ok: false, error: 'Not signed in' }
  }

  try {
    const used = await variantUsage(variantId)
    if (used > 0) {
      return {
        ok: false,
        error: `This size is on ${used} order line${used === 1 ? '' : 's'}. Turn it off instead — deleting it would break those orders.`,
      }
    }

    await db.delete(menuVariants).where(eq(menuVariants.id, variantId))

    revalidateMenuViews()
    return { ok: true }
  } catch (error) {
    console.error('[deleteVariant]', error)
    return { ok: false, error: messageFor(error, 'Could not delete that size') }
  }
}

/* -------------------------------------------------------------------------- */

/**
 * Postgres raises a handful of constraint violations the operator can actually
 * act on — a duplicate size, most of all. Those are worth passing through in
 * plain words; anything else gets the generic message and stays in the log.
 *
 * The code is looked for down the `cause` chain, not just on the error itself:
 * Drizzle wraps driver errors in its own `DrizzleQueryError`, so the `code` a
 * naive check reads off the top-level object is always undefined.
 */
function postgresCode(error: unknown): string | undefined {
  for (let current = error, depth = 0; current && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string') return code
    current = (current as { cause?: unknown }).cause
  }

  return undefined
}

function messageFor(error: unknown, fallback: string): string {
  const code = postgresCode(error)

  if (code === '23505') return 'That name or size already exists on this item'
  if (code === '23503') {
    return 'That entry is referenced by an existing order and cannot be removed'
  }

  return fallback
}
