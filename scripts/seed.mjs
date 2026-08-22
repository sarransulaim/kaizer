import { config } from 'dotenv'
import pg from 'pg'

config({ path: '.env.local' })

/**
 * Seeds the owner account and the live Kaizr menu, taken verbatim from the
 * Google Form (names, sizes and prices).
 *
 * Idempotent — safe to run on every deploy. Existing rows are updated rather
 * than duplicated, so a price change here propagates on the next release
 * without touching historical orders (line items snapshot their own prices).
 *
 * Plain SQL over `pg` rather than Drizzle + tsx so it can run as a Railway
 * pre-deploy step with production dependencies only.
 */

const OWNER = {
  name: 'Sulaim',
  email: 'sulaimsarran@gmail.com',
  role: 'owner',
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
      ['Individual', 1400, 1, 1],
      ['Small tray', 8000, 8, 2],
      ['Large tray', 16000, 16, 3],
    ],
  },
  {
    name: 'Hyderabadi Dum Mutton Biryani',
    slug: 'mutton-biryani',
    category: 'biryani',
    // Mutton needs a longer marination than chicken — earlier prep alert.
    prepLeadHours: 18,
    sortOrder: 2,
    variants: [
      ['Individual', 1800, 1, 1],
      ['Small tray', 10000, 8, 2],
      ['Large tray', 20000, 16, 3],
    ],
  },
  {
    name: 'Chicken 65',
    slug: 'chicken-65',
    category: 'appetizer',
    prepLeadHours: 8,
    sortOrder: 3,
    variants: [
      ['Individual', 1500, 1, 1],
      ['Small tray', 8000, 8, 2],
      ['Large tray', 16000, 16, 3],
    ],
  },
  {
    name: 'Kaddu Ki Kheer',
    slug: 'kaddu-ki-kheer',
    category: 'dessert',
    prepLeadHours: 10,
    sortOrder: 4,
    variants: [
      ['8 oz', 600, 1, 1],
      ['22 oz', 1200, 3, 2],
    ],
  },
]

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

const client = new pg.Client({
  connectionString,
  ssl: connectionString.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : undefined,
})

try {
  await client.connect()
  console.log('Seeding Kaizr…\n')

  const owner = await client.query(
    `INSERT INTO users (name, email, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name, role = EXCLUDED.role, updated_at = now()
     RETURNING email`,
    [OWNER.name, OWNER.email, OWNER.role],
  )
  console.log(`  owner   ${owner.rows[0].email}`)

  for (const item of MENU) {
    const menuItem = await client.query(
      `INSERT INTO menu_items (name, slug, category, prep_lead_hours, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (slug) DO UPDATE
         SET name = EXCLUDED.name,
             category = EXCLUDED.category,
             prep_lead_hours = EXCLUDED.prep_lead_hours,
             sort_order = EXCLUDED.sort_order,
             updated_at = now()
       RETURNING id`,
      [item.name, item.slug, item.category, item.prepLeadHours, item.sortOrder],
    )

    const itemId = menuItem.rows[0].id

    for (const [sizeLabel, priceCents, serves, sortOrder] of item.variants) {
      await client.query(
        `INSERT INTO menu_variants
           (menu_item_id, size_label, price_cents, serves_count, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT ON CONSTRAINT menu_variants_item_size_unique DO UPDATE
           SET price_cents = EXCLUDED.price_cents,
               serves_count = EXCLUDED.serves_count,
               sort_order = EXCLUDED.sort_order,
               updated_at = now()`,
        [itemId, sizeLabel, priceCents, serves, sortOrder],
      )
    }

    const prices = item.variants
      .map(([label, cents]) => `${label} $${cents / 100}`)
      .join(', ')
    console.log(`  menu    ${item.name} — ${prices}`)
  }

  /* Order numbers start at 1001 rather than 1 — "order #4" reads oddly on the
     phone to a customer. Only bumped while the table is still effectively new,
     so re-running this never disturbs a live sequence. */
  await client.query(
    `SELECT setval('orders_order_number_seq', 1000, true)
     WHERE (SELECT COALESCE(MAX(order_number), 0) FROM orders) < 1000`,
  )

  console.log('\nDone.')
} catch (error) {
  console.error('\nSeed failed:', error)
  process.exitCode = 1
} finally {
  await client.end()
}
