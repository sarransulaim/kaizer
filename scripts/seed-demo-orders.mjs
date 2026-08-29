import { config } from 'dotenv'
import pg from 'pg'

config({ path: '.env.local' })

/**
 * Test orders for local development only.
 *
 * Gives the dashboard, kitchen display and prep sheet something real to render
 * so layout and totals can be judged before any live order exists. Never run
 * this against production.
 *
 *   node scripts/seed-demo-orders.mjs        # insert
 *   node scripts/seed-demo-orders.mjs --clear # remove them again
 *
 * Every customer it creates is tagged in `notes`, and clearing deletes exactly
 * those customers and their orders — nothing else is touched.
 */

const TAG = 'demo-seed'

/** Hours from now, so the board always has something late, something imminent. */
const ORDERS = [
  {
    name: 'Ayesha Khan',
    phone: '7325550134',
    hoursFromNow: -1.5,
    status: 'prepping',
    fulfillment: 'pickup',
    channel: 'whatsapp',
    paid: 'full',
    notes: 'Extra raita on the side',
    items: [
      ['chicken-biryani', 'Large tray', 2],
      ['chicken-65', 'Small tray', 1],
    ],
  },
  {
    name: 'Imran Sheikh',
    phone: '9735550198',
    hoursFromNow: 0.75,
    status: 'confirmed',
    fulfillment: 'delivery',
    channel: 'google_form',
    paid: 'none',
    address: '18 Raritan Ave, Edison NJ 08817',
    items: [
      ['mutton-biryani', 'Large tray', 1],
      ['kaddu-ki-kheer', '22 oz', 2],
    ],
  },
  {
    name: 'Priya Nair',
    phone: '8625550117',
    hoursFromNow: 4,
    status: 'new',
    fulfillment: 'pickup',
    channel: 'phone',
    paid: 'half',
    items: [
      ['chicken-biryani', 'Small tray', 3],
      ['kaddu-ki-kheer', '8 oz', 4],
    ],
  },
  {
    name: 'Faisal Ahmed',
    phone: '7325550221',
    hoursFromNow: 27,
    status: 'confirmed',
    fulfillment: 'delivery',
    channel: 'whatsapp',
    paid: 'full',
    address: '440 Route 27, Iselin NJ 08830',
    notes: 'Office lunch — needs serving spoons',
    items: [
      ['chicken-biryani', 'Large tray', 3],
      ['mutton-biryani', 'Large tray', 2],
      ['chicken-65', 'Large tray', 2],
    ],
  },
  {
    name: 'Sana Qureshi',
    phone: '9085550163',
    hoursFromNow: 74,
    status: 'new',
    fulfillment: 'pickup',
    channel: 'google_form',
    paid: 'none',
    items: [['mutton-biryani', 'Small tray', 2]],
  },
]

/**
 * Past orders, so the analytics page has a shape to show rather than three
 * days of nothing. Spread over the last 90 days and all completed.
 *
 * Deterministic on purpose — a seeded generator rather than `Math.random`, so
 * re-running produces the same book and a number that looked wrong yesterday
 * can be chased today.
 */
const HISTORY_DAYS = 90
const HISTORY_NAMES = [
  ['Rahul Menon', '7325550301'],
  ['Zainab Ali', '9735550302'],
  ['Deepak Rao', '8625550303'],
  ['Fatima Noor', '9085550304'],
  ['Arjun Pillai', '7325550305'],
  ['Hina Siddiqui', '9735550306'],
  ['Vikram Shah', '8625550307'],
  ['Nadia Rahman', '9085550308'],
]
const HISTORY_BASKETS = [
  [['chicken-biryani', 'Large tray', 2], ['chicken-65', 'Small tray', 1]],
  [['chicken-biryani', 'Small tray', 1], ['kaddu-ki-kheer', '8 oz', 3]],
  [['mutton-biryani', 'Large tray', 1], ['chicken-65', 'Large tray', 1]],
  [['chicken-biryani', 'Individual', 6]],
  [['mutton-biryani', 'Small tray', 2], ['kaddu-ki-kheer', '22 oz', 1]],
  [['chicken-biryani', 'Large tray', 3], ['mutton-biryani', 'Large tray', 1], ['chicken-65', 'Large tray', 2]],
  [['chicken-65', 'Small tray', 2]],
  [['chicken-biryani', 'Large tray', 1], ['kaddu-ki-kheer', '22 oz', 2]],
]
const METHODS = ['zelle', 'zelle', 'cash', 'venmo', 'card']
const CHANNELS = ['whatsapp', 'whatsapp', 'google_form', 'phone', 'walk_in']

/** Mulberry32 — small, seeded, and good enough for shaping fake orders. */
function makeRandom(seed) {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const { Client } = pg
const client = new Client({ connectionString: process.env.DATABASE_URL })

async function clear() {
  /* Orders first: `customer_id` is ON DELETE RESTRICT, so a customer with
     orders cannot be removed until they are. Items and events cascade off the
     orders themselves. */
  const { rowCount: orderCount } = await client.query(
    `DELETE FROM orders WHERE customer_id IN (SELECT id FROM customers WHERE notes = $1)`,
    [TAG],
  )
  const { rowCount } = await client.query(
    `DELETE FROM customers WHERE notes = $1`,
    [TAG],
  )
  console.log(`Removed ${rowCount} demo customer(s) and ${orderCount} order(s).`)
}

async function main() {
  await client.connect()

  if (process.argv.includes('--clear')) {
    await clear()
    return
  }

  const { rows: owners } = await client.query(
    `SELECT id, name FROM users ORDER BY created_at LIMIT 1`,
  )
  if (owners.length === 0) throw new Error('No owner user. Run npm run db:seed first.')
  const owner = owners[0]

  const { rows: variants } = await client.query(
    `SELECT v.id, v.size_label, v.price_cents, i.slug, i.name
     FROM menu_variants v JOIN menu_items i ON i.id = v.menu_item_id`,
  )

  const findVariant = (slug, size) => {
    const match = variants.find((v) => v.slug === slug && v.size_label === size)
    if (!match) throw new Error(`No variant ${slug} / ${size}`)
    return match
  }

  /* Cleared first so the script is re-runnable without piling up duplicates. */
  await clear()

  async function insertOrder(spec, serviceAt, quiet = false) {
    /* The app stores the local calendar date and clock time the business thinks
       in, alongside the absolute instant. Formatting in the business timezone
       keeps this consistent with what the app itself would have written. */
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(serviceAt)

    const get = (type) => parts.find((p) => p.type === type).value
    const serviceDate = `${get('year')}-${get('month')}-${get('day')}`
    const serviceTime = `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`

    const { rows: customerRows } = await client.query(
      `INSERT INTO customers (name, phone, notes)
       VALUES ($1, $2, $3)
       ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, notes = EXCLUDED.notes
       RETURNING id`,
      [spec.name, spec.phone, TAG],
    )
    const customerId = customerRows[0].id

    const lines = spec.items.map(([slug, size, quantity]) => {
      const variant = findVariant(slug, size)
      return {
        variantId: variant.id,
        itemName: variant.name,
        sizeLabel: variant.size_label,
        unitPrice: variant.price_cents,
        quantity,
        lineTotal: variant.price_cents * quantity,
      }
    })

    const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0)
    const amountPaid =
      spec.paid === 'full' ? subtotal : spec.paid === 'half' ? Math.round(subtotal / 2) : 0
    const paymentStatus =
      amountPaid <= 0 ? 'unpaid' : amountPaid >= subtotal ? 'paid' : 'partial'

    const { rows: orderRows } = await client.query(
      `INSERT INTO orders (
         customer_id, channel, fulfillment_type, service_date, service_time, service_at,
         status, subtotal_cents, total_cents, amount_paid_cents, payment_status,
         payment_method, delivery_address, notes, created_by_id, updated_by_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14,$14)
       RETURNING id, order_number`,
      [
        customerId,
        spec.channel,
        spec.fulfillment,
        serviceDate,
        serviceTime,
        serviceAt.toISOString(),
        spec.status,
        subtotal,
        amountPaid,
        paymentStatus,
        amountPaid > 0 ? (spec.method ?? 'zelle') : null,
        spec.address ?? null,
        spec.notes ?? null,
        owner.id,
      ],
    )
    const order = orderRows[0]

    for (const line of lines) {
      await client.query(
        `INSERT INTO order_items (
           order_id, menu_variant_id, item_name_snapshot, size_label_snapshot,
           unit_price_cents, quantity, line_total_cents
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          order.id,
          line.variantId,
          line.itemName,
          line.sizeLabel,
          line.unitPrice,
          line.quantity,
          line.lineTotal,
        ],
      )
    }

    await client.query(
      `INSERT INTO order_events (order_id, type, to_status, message, actor_id, actor_name)
       VALUES ($1, 'created', $2, $3, $4, $5)`,
      [order.id, spec.status, 'Demo order', owner.id, owner.name],
    )

    if (!quiet) {
      console.log(
        `  #${order.order_number}  ${spec.name.padEnd(14)} ${serviceDate} ${serviceTime}  ${spec.status}`,
      )
    }
  }

  console.log('Current book:')
  for (const spec of ORDERS) {
    await insertOrder(spec, new Date(Date.now() + spec.hoursFromNow * 3600_000))
  }

  /* Past orders, all completed, so the analytics page has real shape. */
  const random = makeRandom(20260822)
  let history = 0

  for (let daysAgo = HISTORY_DAYS; daysAgo >= 1; daysAgo--) {
    /* Weekends carry roughly twice the volume of a weekday — the pattern the
       "best days" chart exists to show. */
    const when = new Date(Date.now() - daysAgo * 86_400_000)
    const weekend = [0, 5, 6].includes(when.getDay())
    const count = Math.floor(random() * (weekend ? 3 : 2)) + (weekend ? 1 : 0)

    for (let i = 0; i < count; i++) {
      const [name, phone] = HISTORY_NAMES[Math.floor(random() * HISTORY_NAMES.length)]
      const basket = HISTORY_BASKETS[Math.floor(random() * HISTORY_BASKETS.length)]
      const serviceAt = new Date(when)
      serviceAt.setHours(12 + Math.floor(random() * 8), random() < 0.5 ? 0 : 30, 0, 0)

      await insertOrder(
        {
          name,
          phone,
          status: 'completed',
          fulfillment: random() < 0.65 ? 'pickup' : 'delivery',
          channel: CHANNELS[Math.floor(random() * CHANNELS.length)],
          /* A few go out on a deposit and are never chased — that gap is
             exactly what the outstanding figure is for. */
          paid: random() < 0.85 ? 'full' : 'half',
          method: METHODS[Math.floor(random() * METHODS.length)],
          address: 'Edison NJ',
          items: basket,
        },
        serviceAt,
        true,
      )
      history++
    }
  }

  console.log(`\n${history} past orders across the last ${HISTORY_DAYS} days.`)
  console.log('Demo data inserted. Remove it with --clear.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => client.end())
