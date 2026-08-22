import { config } from 'dotenv'
import { sql } from 'drizzle-orm'

config({ path: '.env.local' })

// Imported after dotenv so DATABASE_URL is present when the pool is created.
const { db, pool } = await import('../src/lib/db/index')
const { menuItems, menuVariants, users } = await import('../src/lib/db/schema')

/**
 * Seeds the owner account and the live Kaizr menu, taken verbatim from the
 * Google Form (name, sizes and prices). Idempotent — safe to re-run after a
 * menu change; existing rows are updated rather than duplicated.
 */

const OWNER = {
  name: 'Sulaim',
  email: 'sulaimsarran@gmail.com',
  role: 'owner' as const,
}

const MENU = [
  {
    name: 'Hyderabadi Dum Chicken Biryani',
    slug: 'chicken-biryani',
    category: 'biryani',
    // Marination the night before, then dum in the morning.
    prepLeadHours: 14,
    sortOrder: 1,
    variants: [
      { sizeLabel: 'Individual', priceCents: 1400, servesCount: 1, sortOrder: 1 },
      { sizeLabel: 'Small tray', priceCents: 8000, servesCount: 8, sortOrder: 2 },
      { sizeLabel: 'Large tray', priceCents: 16000, servesCount: 16, sortOrder: 3 },
    ],
  },
  {
    name: 'Hyderabadi Dum Mutton Biryani',
    slug: 'mutton-biryani',
    category: 'biryani',
    // Mutton needs a longer marination than chicken — earlier alert.
    prepLeadHours: 18,
    sortOrder: 2,
    variants: [
      { sizeLabel: 'Individual', priceCents: 1800, servesCount: 1, sortOrder: 1 },
      { sizeLabel: 'Small tray', priceCents: 10000, servesCount: 8, sortOrder: 2 },
      { sizeLabel: 'Large tray', priceCents: 20000, servesCount: 16, sortOrder: 3 },
    ],
  },
  {
    name: 'Chicken 65',
    slug: 'chicken-65',
    category: 'appetizer',
    prepLeadHours: 8,
    sortOrder: 3,
    variants: [
      { sizeLabel: 'Individual', priceCents: 1500, servesCount: 1, sortOrder: 1 },
      { sizeLabel: 'Small tray', priceCents: 8000, servesCount: 8, sortOrder: 2 },
      { sizeLabel: 'Large tray', priceCents: 16000, servesCount: 16, sortOrder: 3 },
    ],
  },
  {
    name: 'Kaddu Ki Kheer',
    slug: 'kaddu-ki-kheer',
    category: 'dessert',
    prepLeadHours: 10,
    sortOrder: 4,
    variants: [
      { sizeLabel: '8 oz', priceCents: 600, servesCount: 1, sortOrder: 1 },
      { sizeLabel: '22 oz', priceCents: 1200, servesCount: 3, sortOrder: 2 },
    ],
  },
]

async function seed() {
  console.log('Seeding Kaizr…\n')

  const [owner] = await db
    .insert(users)
    .values(OWNER)
    .onConflictDoUpdate({
      target: users.email,
      set: { name: OWNER.name, role: OWNER.role, updatedAt: new Date() },
    })
    .returning()

  console.log(`  owner   ${owner.email}`)

  for (const item of MENU) {
    const { variants, ...itemFields } = item

    const [menuItem] = await db
      .insert(menuItems)
      .values(itemFields)
      .onConflictDoUpdate({
        target: menuItems.slug,
        set: {
          name: itemFields.name,
          category: itemFields.category,
          prepLeadHours: itemFields.prepLeadHours,
          sortOrder: itemFields.sortOrder,
          updatedAt: new Date(),
        },
      })
      .returning()

    for (const variant of variants) {
      await db
        .insert(menuVariants)
        .values({ ...variant, menuItemId: menuItem.id })
        .onConflictDoUpdate({
          target: [menuVariants.menuItemId, menuVariants.sizeLabel],
          set: {
            priceCents: variant.priceCents,
            servesCount: variant.servesCount,
            sortOrder: variant.sortOrder,
            updatedAt: new Date(),
          },
        })
    }

    const prices = variants.map((v) => `${v.sizeLabel} $${v.priceCents / 100}`)
    console.log(`  menu    ${menuItem.name} — ${prices.join(', ')}`)
  }

  // Order numbers start at 1001 rather than 1; "order #4" on the phone to a
  // customer reads oddly for a business that has been running for a while.
  await db.execute(
    sql`SELECT setval('orders_order_number_seq', 1000, true)
        WHERE (SELECT COALESCE(MAX(order_number), 0) FROM orders) < 1000`,
  )

  console.log('\nDone.')
}

try {
  await seed()
} catch (error) {
  console.error('\nSeed failed:', error)
  process.exitCode = 1
} finally {
  await pool.end()
}
