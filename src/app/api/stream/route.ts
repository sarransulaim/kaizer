import { Client } from 'pg'

import { ORDERS_CHANNEL } from '@/lib/realtime'

export const dynamic = 'force-dynamic'
// LISTEN requires a real, long-lived TCP connection — Node runtime only.
export const runtime = 'nodejs'

/**
 * How many live subscribers this process will carry.
 *
 * Each one holds a Postgres connection of its own, outside the query pool,
 * because LISTEN claims a session for as long as it is open. Postgres allows
 * 100 connections in total, so an unbounded feed is a way to lock the app out
 * of its own database — every page would begin failing because a few phones
 * left tabs open.
 *
 * Refusing the surplus is the mild failure: the realtime layer is a
 * convenience, and a client that cannot subscribe still refreshes on its own.
 */
const MAX_SUBSCRIBERS = 40

let subscribers = 0

/**
 * Server-Sent Events feed of order changes.
 *
 * Each connected client gets its own Postgres connection parked on
 * `LISTEN orders_changed`. That's deliberate: `LISTEN` claims a session, so it
 * cannot share the request pool — a pooled connection handed to another query
 * mid-listen would silently stop delivering notifications.
 *
 * This is only viable because Railway runs a persistent Node process. On a
 * serverless host the function would be killed long before a service ever ends.
 */
export async function GET(request: Request) {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    return new Response('DATABASE_URL not configured', { status: 500 })
  }

  if (subscribers >= MAX_SUBSCRIBERS) {
    console.warn(`[stream] refusing subscriber, ${subscribers} already open`)
    return new Response('Too many live connections', {
      status: 503,
      headers: { 'Retry-After': '30' },
    })
  }

  const encoder = new TextEncoder()
  let client: Client | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null

  /**
   * Teardown state lives out here rather than inside `start`, because a stream
   * can end two ways — the request aborting, or the runtime calling `cancel` —
   * and both have to release the same connection and the same slot. Counting a
   * subscriber down in only one of those paths leaks a slot every time the
   * other one fires, and the feed would eventually refuse everybody.
   */
  let released = false

  const release = async () => {
    if (released) return
    released = true

    subscribers = Math.max(0, subscribers - 1)

    if (heartbeat) clearInterval(heartbeat)
    try {
      await client?.end()
    } catch {
      /* connection already gone */
    }
  }

  subscribers += 1

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (released) return
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          )
        } catch {
          void close()
        }
      }

      const close = async () => {
        const alreadyReleased = released
        await release()
        if (alreadyReleased) return
        try {
          controller.close()
        } catch {
          /* stream already closed */
        }
      }

      client = new Client({
        connectionString,
        ssl: connectionString.includes('sslmode=require')
          ? { rejectUnauthorized: false }
          : undefined,
      })

      client.on('error', (error) => {
        console.error('[stream] postgres client error', error)
        void close()
      })

      client.on('notification', (message) => {
        if (message.channel !== ORDERS_CHANNEL) return
        try {
          send('order', JSON.parse(message.payload ?? '{}'))
        } catch {
          send('order', {})
        }
      })

      try {
        await client.connect()
        await client.query(`LISTEN ${ORDERS_CHANNEL}`)
      } catch (error) {
        console.error('[stream] failed to subscribe', error)
        await close()
        return
      }

      send('ready', { at: new Date().toISOString() })

      /* Comment-only heartbeat. Proxies and mobile networks drop idle
         connections after ~60s; this keeps the pipe warm without producing an
         event the client has to handle. */
      heartbeat = setInterval(() => {
        if (released) return
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          void close()
        }
      }, 25_000)

      request.signal.addEventListener('abort', () => void close())
    },

    async cancel() {
      await release()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disables buffering in reverse proxies that would otherwise hold events.
      'X-Accel-Buffering': 'no',
    },
  })
}
