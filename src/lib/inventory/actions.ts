'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getCurrentActor } from '@/lib/actor'
import { isSignedIn } from '@/lib/auth/guard'
import { db } from '@/lib/db'
import {
  ingredientCategoryEnum,
  ingredients,
  inventoryCountLines,
  inventoryCounts,
  purchaseLines,
  purchases,
  wasteEntries,
  wasteReasonEnum,
} from '@/lib/db/schema'
import { today } from '@/lib/time'

import { costPerStockUnit, purchaseToStock, valueOf } from './units'

export type InventoryResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

const DENIED: InventoryResult = { ok: false, error: 'Not signed in' }

/**
 * Every action here checks the session itself.
 *
 * Middleware guards pages, but a server action is addressed by id and posted to
 * whatever route the browser happens to be on — including the open kitchen
 * display. The guard has to live with the action.
 */
async function allowed() {
  return isSignedIn()
}

function revalidate() {
  revalidatePath('/inventory')
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date')
const quantity = z.number().int().min(0).max(100_000_000)

/* -------------------------------------------------------------------------- */
/*                                Ingredients                                 */
/* -------------------------------------------------------------------------- */

const ingredientSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, 'Give it a name').max(120),
  category: z.enum(ingredientCategoryEnum.enumValues),
  stockUnit: z.string().trim().min(1, 'Pick a unit').max(20),
  purchaseUnit: z.string().trim().min(1, 'Pick a unit').max(20),
  /** How many stock units in one purchase unit, in thousandths. */
  stockPerPurchaseMilli: z.number().int().min(1, 'How much is in one?'),
  parLevelMilli: quantity.default(0),
  lastCostCents: z.number().int().min(0).default(0),
  supplier: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
})

export type IngredientInput = z.input<typeof ingredientSchema>

export async function saveIngredient(input: IngredientInput): Promise<InventoryResult> {
  if (!(await allowed())) return DENIED

  const parsed = ingredientSchema.safeParse(input)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join('.') || 'form'] ??= issue.message
    }
    return { ok: false, error: 'Please fix the highlighted fields', fieldErrors }
  }

  const data = parsed.data

  try {
    if (data.id) {
      await db
        .update(ingredients)
        .set({
          name: data.name,
          category: data.category,
          stockUnit: data.stockUnit,
          purchaseUnit: data.purchaseUnit,
          stockPerPurchaseMilli: data.stockPerPurchaseMilli,
          parLevelMilli: data.parLevelMilli,
          lastCostCents: data.lastCostCents,
          supplier: data.supplier || null,
          notes: data.notes || null,
          updatedAt: new Date(),
        })
        .where(eq(ingredients.id, data.id))
    } else {
      await db.insert(ingredients).values({
        name: data.name,
        category: data.category,
        stockUnit: data.stockUnit,
        purchaseUnit: data.purchaseUnit,
        stockPerPurchaseMilli: data.stockPerPurchaseMilli,
        parLevelMilli: data.parLevelMilli,
        lastCostCents: data.lastCostCents,
        supplier: data.supplier || null,
        notes: data.notes || null,
      })
    }

    revalidate()
    return { ok: true }
  } catch (error) {
    console.error('[saveIngredient]', error)
    const message = String(error)
    if (message.includes('ingredients_name_unique')) {
      return { ok: false, error: 'There is already an ingredient with that name' }
    }
    return { ok: false, error: 'Could not save that ingredient' }
  }
}

/**
 * Turn an ingredient off rather than delete it.
 *
 * Deliveries and counts point at it, so removing the row would take a month of
 * purchase history with it. Off means "stop offering this", not "it never
 * existed".
 */
export async function setIngredientActive(
  id: string,
  active: boolean,
): Promise<InventoryResult> {
  if (!(await allowed())) return DENIED

  try {
    await db
      .update(ingredients)
      .set({ active, updatedAt: new Date() })
      .where(eq(ingredients.id, id))
    revalidate()
    return { ok: true }
  } catch (error) {
    console.error('[setIngredientActive]', error)
    return { ok: false, error: 'Could not change that' }
  }
}

/* -------------------------------------------------------------------------- */
/*                                 Deliveries                                 */
/* -------------------------------------------------------------------------- */

const purchaseSchema = z.object({
  supplier: z.string().trim().min(1, 'Who delivered it?').max(120),
  purchasedOn: isoDate,
  reference: z.string().trim().max(60).optional(),
  note: z.string().trim().max(500).optional(),
  lines: z
    .array(
      z.object({
        ingredientId: z.uuid(),
        /** Purchase units received, in thousandths. */
        quantityMilli: z.number().int().min(1, 'How many?'),
        /** What one purchase unit cost. */
        unitCostCents: z.number().int().min(0),
      }),
    )
    .min(1, 'Add at least one line'),
})

export type PurchaseInput = z.input<typeof purchaseSchema>

/**
 * Log a delivery, as it reads on the invoice.
 *
 * Each line also updates the ingredient's cost per stock unit, because that is
 * the figure every later valuation is built on and a delivery is the only place
 * it can be learnt honestly. The stock quantity is snapshotted onto the line so
 * a pack size corrected in November cannot restate what arrived in August.
 */
export async function logPurchase(input: PurchaseInput): Promise<InventoryResult> {
  if (!(await allowed())) return DENIED

  const parsed = purchaseSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the delivery' }
  }

  const data = parsed.data
  const actor = await getCurrentActor()

  try {
    await db.transaction(async (tx) => {
      const rows = await tx.select().from(ingredients)
      const byId = new Map(rows.map((r) => [r.id, r]))

      const resolved = data.lines.map((line) => {
        const ingredient = byId.get(line.ingredientId)
        if (!ingredient) throw new Error('One of those ingredients no longer exists')

        return {
          line,
          ingredient,
          stockQuantityMilli: purchaseToStock(
            line.quantityMilli,
            ingredient.stockPerPurchaseMilli,
          ),
          lineTotalCents: Math.round(
            (line.quantityMilli * line.unitCostCents) / 1000,
          ),
        }
      })

      const totalCents = resolved.reduce((sum, r) => sum + r.lineTotalCents, 0)

      const [purchase] = await tx
        .insert(purchases)
        .values({
          supplier: data.supplier,
          purchasedOn: data.purchasedOn,
          reference: data.reference || null,
          note: data.note || null,
          totalCents,
          createdById: actor.id,
        })
        .returning()

      await tx.insert(purchaseLines).values(
        resolved.map((r) => ({
          purchaseId: purchase.id,
          ingredientId: r.line.ingredientId,
          quantityMilli: r.line.quantityMilli,
          unitCostCents: r.line.unitCostCents,
          lineTotalCents: r.lineTotalCents,
          stockQuantityMilli: r.stockQuantityMilli,
        })),
      )

      /* Learn the current price from what was actually paid. */
      for (const r of resolved) {
        const perStockUnit = costPerStockUnit(
          r.line.unitCostCents,
          r.ingredient.stockPerPurchaseMilli,
        )
        if (perStockUnit > 0) {
          await tx
            .update(ingredients)
            .set({ lastCostCents: perStockUnit, updatedAt: new Date() })
            .where(eq(ingredients.id, r.line.ingredientId))
        }
      }
    })

    revalidate()
    return { ok: true }
  } catch (error) {
    console.error('[logPurchase]', error)
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not save that delivery',
    }
  }
}

export async function deletePurchase(id: string): Promise<InventoryResult> {
  if (!(await allowed())) return DENIED

  try {
    await db.delete(purchases).where(eq(purchases.id, id))
    revalidate()
    return { ok: true }
  } catch (error) {
    console.error('[deletePurchase]', error)
    return { ok: false, error: 'Could not remove that delivery' }
  }
}

/* -------------------------------------------------------------------------- */
/*                                 Stocktake                                  */
/* -------------------------------------------------------------------------- */

const countSchema = z.object({
  countedOn: isoDate,
  salesSinceLastCents: z.number().int().min(0).nullable().optional(),
  note: z.string().trim().max(500).optional(),
  lines: z
    .array(z.object({ ingredientId: z.uuid(), quantityMilli: quantity }))
    .min(1, 'Count at least one thing'),
})

export type CountInput = z.input<typeof countSchema>

/**
 * Record a stocktake.
 *
 * Each line keeps the cost per stock unit as it stood that day, so the count
 * can still be valued correctly after prices move — the same reason an order
 * line keeps its price.
 *
 * Re-counting a date replaces that count rather than adding a second one: two
 * counts for one day would make the period arithmetic ambiguous, and the usual
 * reason to do it is that the first one was wrong.
 */
export async function saveCount(input: CountInput): Promise<InventoryResult> {
  if (!(await allowed())) return DENIED

  const parsed = countSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the count' }
  }

  const data = parsed.data
  const actor = await getCurrentActor()

  try {
    await db.transaction(async (tx) => {
      const rows = await tx.select().from(ingredients)
      const costById = new Map(rows.map((r) => [r.id, r.lastCostCents]))

      const [existing] = await tx
        .select({ id: inventoryCounts.id })
        .from(inventoryCounts)
        .where(eq(inventoryCounts.countedOn, data.countedOn))
        .limit(1)

      if (existing) {
        await tx.delete(inventoryCounts).where(eq(inventoryCounts.id, existing.id))
      }

      const [count] = await tx
        .insert(inventoryCounts)
        .values({
          countedOn: data.countedOn,
          salesSinceLastCents: data.salesSinceLastCents ?? null,
          note: data.note || null,
          countedById: actor.id,
        })
        .returning()

      await tx.insert(inventoryCountLines).values(
        data.lines.map((line) => ({
          countId: count.id,
          ingredientId: line.ingredientId,
          quantityMilli: line.quantityMilli,
          costCentsSnapshot: costById.get(line.ingredientId) ?? 0,
        })),
      )
    })

    revalidate()
    return { ok: true }
  } catch (error) {
    console.error('[saveCount]', error)
    return { ok: false, error: 'Could not save that count' }
  }
}

/* -------------------------------------------------------------------------- */
/*                                   Waste                                    */
/* -------------------------------------------------------------------------- */

const wasteSchema = z.object({
  ingredientId: z.uuid(),
  quantityMilli: z.number().int().min(1, 'How much?'),
  reason: z.enum(wasteReasonEnum.enumValues),
  note: z.string().trim().max(500).optional(),
  wastedOn: isoDate.optional(),
})

export type WasteInput = z.input<typeof wasteSchema>

/** Log something thrown away, valued at what it cost when it was logged. */
export async function logWaste(input: WasteInput): Promise<InventoryResult> {
  if (!(await allowed())) return DENIED

  const parsed = wasteSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check that entry' }
  }

  const data = parsed.data
  const actor = await getCurrentActor()

  try {
    const [ingredient] = await db
      .select()
      .from(ingredients)
      .where(eq(ingredients.id, data.ingredientId))
      .limit(1)

    if (!ingredient) return { ok: false, error: 'That ingredient no longer exists' }

    await db.insert(wasteEntries).values({
      ingredientId: data.ingredientId,
      quantityMilli: data.quantityMilli,
      costCents: valueOf(data.quantityMilli, ingredient.lastCostCents),
      reason: data.reason,
      note: data.note || null,
      wastedOn: data.wastedOn ?? today(),
      recordedById: actor.id,
    })

    revalidate()
    return { ok: true }
  } catch (error) {
    console.error('[logWaste]', error)
    return { ok: false, error: 'Could not log that' }
  }
}

export async function deleteWaste(id: string): Promise<InventoryResult> {
  if (!(await allowed())) return DENIED

  try {
    await db.delete(wasteEntries).where(eq(wasteEntries.id, id))
    revalidate()
    return { ok: true }
  } catch (error) {
    console.error('[deleteWaste]', error)
    return { ok: false, error: 'Could not remove that' }
  }
}
