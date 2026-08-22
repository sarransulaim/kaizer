import { sql } from 'drizzle-orm'

import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Railway health check. Verifies the database is actually reachable rather than
 * only that the process is up — a running app that can't reach Postgres is not
 * healthy, and rolling back is better than serving errors during a service.
 */
export async function GET() {
  try {
    await db.execute(sql`SELECT 1`)
    return Response.json({ ok: true, db: 'up' })
  } catch (error) {
    console.error('[health] database unreachable', error)
    return Response.json({ ok: false, db: 'down' }, { status: 503 })
  }
}
