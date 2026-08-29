import { asc, eq, sql } from 'drizzle-orm'

import { db } from '@/lib/db'
import { menuItems, menuVariants, orderItems } from '@/lib/db/schema'

/**
 * The menu as the settings screen needs to see it: inactive items included, and
 * every size annotated with how many order lines already reference it.
 *
 * That usage count is what decides whether a size can be deleted outright or
 * only retired. Order lines snapshot their own name and price, so history stays
 * readable either way — but the foreign key is `ON DELETE RESTRICT`, and it is
 * far better to explain that in the interface than to let the database raise it.
 */

export type AdminVariant = {
  id: string
  sizeLabel: string
  priceCents: number
  servesCount: number | null
  active: boolean
  sortOrder: number
  usageCount: number
}

export type AdminMenuItem = {
  id: string
  name: string
  slug: string
  category: string
  description: string | null
  recipe: string | null
  prepLeadHours: number
  active: boolean
  sortOrder: number
  variants: AdminVariant[]
  usageCount: number
}

export async function getMenuForAdmin(): Promise<AdminMenuItem[]> {
  const [items, usage] = await Promise.all([
    db.query.menuItems.findMany({
      orderBy: [asc(menuItems.sortOrder), asc(menuItems.name)],
      with: {
        variants: {
          orderBy: [asc(menuVariants.sortOrder), asc(menuVariants.sizeLabel)],
        },
      },
    }),
    db
      .select({
        variantId: orderItems.menuVariantId,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(orderItems)
      .groupBy(orderItems.menuVariantId),
  ])

  const byVariant = new Map<string, number>()
  for (const row of usage) {
    if (row.variantId) byVariant.set(row.variantId, row.count)
  }

  return items.map((item) => {
    const variants = item.variants.map((variant) => ({
      id: variant.id,
      sizeLabel: variant.sizeLabel,
      priceCents: variant.priceCents,
      servesCount: variant.servesCount,
      active: variant.active,
      sortOrder: variant.sortOrder,
      usageCount: byVariant.get(variant.id) ?? 0,
    }))

    return {
      id: item.id,
      name: item.name,
      slug: item.slug,
      category: item.category,
      description: item.description,
      recipe: item.recipe,
      prepLeadHours: item.prepLeadHours,
      active: item.active,
      sortOrder: item.sortOrder,
      variants,
      usageCount: variants.reduce((sum, v) => sum + v.usageCount, 0),
    }
  })
}

/* -------------------------------------------------------------------------- */
/*                            Recipes for the kitchen                         */
/* -------------------------------------------------------------------------- */

export type KitchenRecipe = {
  itemName: string
  recipe: string | null
  prepLeadHours: number
  servesCount: number | null
}

/**
 * Recipes keyed for lookup from an order line.
 *
 * Two indexes, because an order line may not resolve by variant: `menu_variant_id`
 * is nullable and a size that has since been deleted leaves it null, while the
 * line itself still carries the name it was sold under. Falling back to the
 * snapshotted name means an old order can still show its recipe.
 */
export async function getRecipeLookup(): Promise<{
  byVariant: Record<string, KitchenRecipe>
  byName: Record<string, KitchenRecipe>
}> {
  const rows = await db
    .select({
      variantId: menuVariants.id,
      servesCount: menuVariants.servesCount,
      itemName: menuItems.name,
      recipe: menuItems.recipe,
      prepLeadHours: menuItems.prepLeadHours,
    })
    .from(menuVariants)
    .innerJoin(menuItems, eq(menuVariants.menuItemId, menuItems.id))

  const byVariant: Record<string, KitchenRecipe> = {}
  const byName: Record<string, KitchenRecipe> = {}

  for (const row of rows) {
    const entry: KitchenRecipe = {
      itemName: row.itemName,
      recipe: row.recipe,
      prepLeadHours: row.prepLeadHours,
      servesCount: row.servesCount,
    }

    byVariant[row.variantId] = entry
    /* Every size of an item shares one recipe, so the name index keeps whichever
       it saw first — they differ only in `servesCount`, which the variant index
       already resolves precisely when it can. */
    byName[row.itemName.toLowerCase()] ??= entry
  }

  return { byVariant, byName }
}
