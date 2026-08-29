import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { config } from 'dotenv'
import pg from 'pg'

config({ path: '.env.local' })

/**
 * Deletes every order, keeping the menu, the owner account and the customer
 * book intact.
 *
 *   node scripts/clear-orders.mjs                    # dry run — counts only
 *   node scripts/clear-orders.mjs --yes              # actually delete
 *   node scripts/clear-orders.mjs --yes --customers  # drop customers too
 *   node scripts/clear-orders.mjs --yes --reset-numbers   # restart at #1001
 *
 * Order history is the one thing in this system that cannot be recreated from
 * anywhere else, so this always writes a JSON export to `backups/` first, even
 * when what it is about to delete is obviously test data. The export is enough
 * to reconstruct every order, line item and status change by hand.
 *
 * Runs against whatever DATABASE_URL points at, so it prints the host it is
 * connected to and refuses to act without --yes.
 */

const DELETE = process.argv.includes('--yes')
const DROP_CUSTOMERS = process.argv.includes('--customers')
const RESET_NUMBERS = process.argv.includes('--reset-numbers')

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

const host = (() => {
  try {
    return new URL(url).host
  } catch {
    return 'unknown host'
  }
})()

const client = new pg.Client({
  connectionString: url,
  ssl: url.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
})

const count = async (table) =>
  Number((await client.query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n)

async function main() {
  await client.connect()
  console.log(`Connected to ${host}\n`)

  const before = {
    orders: await count('orders'),
    items: await count('order_items'),
    events: await count('order_events'),
    customers: await count('customers'),
    notifications: await count('notifications'),
  }

  console.log('  orders        ', before.orders)
  console.log('  order items   ', before.items)
  console.log('  order events  ', before.events)
  console.log('  customers     ', before.customers)
  console.log('  notifications ', before.notifications)

  if (before.orders === 0 && before.customers === 0) {
    console.log('\nNothing to clear.')
    return
  }

  if (!DELETE) {
    console.log('\nDry run. Nothing was deleted. Re-run with --yes to proceed.')
    return
  }

  /* Export first. Everything needed to rebuild an order by hand. */
  const { rows: snapshot } = await client.query(`
    SELECT
      o.*,
      row_to_json(c.*) AS customer,
      COALESCE(
        (SELECT json_agg(row_to_json(i.*)) FROM order_items i WHERE i.order_id = o.id),
        '[]'::json
      ) AS items,
      COALESCE(
        (SELECT json_agg(row_to_json(e.*)) FROM order_events e WHERE e.order_id = o.id),
        '[]'::json
      ) AS events
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    ORDER BY o.order_number
  `)

  const dir = join(process.cwd(), 'backups')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const file = join(dir, `orders-before-clear-${stamp}.json`)
  writeFileSync(file, JSON.stringify({ host, exportedAt: new Date(), orders: snapshot }, null, 2))
  console.log(`\nExported ${snapshot.length} order(s) to ${file}`)

  /* order_items and order_events cascade from orders; notifications reference
     orders with ON DELETE CASCADE too. Customers are restricted, so they can
     only go once the orders referencing them have. */
  await client.query('BEGIN')
  try {
    const { rowCount: deleted } = await client.query('DELETE FROM orders')

    if (RESET_NUMBERS) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence('orders', 'order_number'), 1000, true)`,
      )
    }

    let customersRemoved = 0
    if (DROP_CUSTOMERS) {
      const { rowCount } = await client.query('DELETE FROM customers')
      customersRemoved = rowCount
    }

    await client.query('COMMIT')

    console.log(`\nDeleted ${deleted} order(s).`)
    if (DROP_CUSTOMERS) console.log(`Deleted ${customersRemoved} customer(s).`)
    if (RESET_NUMBERS) console.log('Order numbering restarts at #1001.')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }

  console.log('\nRemaining:')
  console.log('  orders    ', await count('orders'))
  console.log('  customers ', await count('customers'))
  console.log('  menu items', await count('menu_items'))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => client.end())
