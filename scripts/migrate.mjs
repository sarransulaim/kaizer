import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { config } from 'dotenv'
import pg from 'pg'

config({ path: '.env.local' })

/**
 * Applies pending migrations from ./drizzle.
 *
 * Deliberately plain JavaScript using only production dependencies —
 * `drizzle-orm` and `pg`. Railway runs this as a pre-deploy step, and a
 * pre-deploy that reached for `drizzle-kit` or `tsx` would break the moment
 * dev dependencies were pruned from the runtime image.
 */

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

const pool = new pg.Pool({
  connectionString,
  max: 1,
  ssl: connectionString.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : undefined,
})

try {
  console.log('Applying migrations…')
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' })
  console.log('Migrations up to date.')
} catch (error) {
  console.error('Migration failed:', error)
  process.exitCode = 1
} finally {
  await pool.end()
}
