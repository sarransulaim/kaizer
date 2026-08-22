import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import * as schema from './schema'

/**
 * A single long-lived connection pool. Railway runs a persistent Node process
 * (unlike serverless), so we get to keep real pooled connections open rather
 * than reconnecting per request.
 *
 * The global cache keeps HMR in development from opening a new pool on every
 * file save and exhausting Postgres' connection limit.
 */
const globalForDb = globalThis as unknown as { pool?: Pool }

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.',
    )
  }

  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Railway's internal network doesn't present a public CA; local dev is plain.
    ssl: connectionString.includes('sslmode=require')
      ? { rejectUnauthorized: false }
      : undefined,
  })
}

export const pool = globalForDb.pool ?? createPool()

if (process.env.NODE_ENV !== 'production') {
  globalForDb.pool = pool
}

export const db = drizzle(pool, { schema })

export { schema }
