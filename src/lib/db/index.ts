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

  const pool = new Pool({
    connectionString,
    /**
     * Ten for the app, leaving room under Postgres' 100-connection ceiling for
     * the SSE subscribers, which each hold a connection of their own outside
     * this pool, plus psql and migrations.
     */
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    /**
     * Recycle connections rather than holding them forever. A managed Postgres
     * will drop long-idle sessions on its own schedule, and a connection the
     * pool believes is alive but the server has closed surfaces as a failed
     * query on someone's order.
     */
    maxLifetimeSeconds: 30 * 60,
    // Railway's internal network doesn't present a public CA; local dev is plain.
    ssl: connectionString.includes('sslmode=require')
      ? { rejectUnauthorized: false }
      : undefined,
  })

  /**
   * This listener is not optional.
   *
   * `pg` emits `error` on the pool when an *idle* client fails — a Postgres
   * restart, a Railway maintenance window, a dropped network link. An `error`
   * event with no listener is thrown by EventEmitter as an uncaught exception,
   * which takes the whole process down: the kitchen display goes blank mid
   * service because a database connection that nobody was using broke.
   *
   * The pool discards the bad client by itself, so logging is genuinely all
   * that is required here — the next query gets a fresh connection.
   */
  pool.on('error', (error) => {
    console.error('[db] idle client error (connection discarded)', error)
  })

  return pool
}

export const pool = globalForDb.pool ?? createPool()

if (process.env.NODE_ENV !== 'production') {
  globalForDb.pool = pool
}

export const db = drizzle(pool, { schema })

export { schema }
