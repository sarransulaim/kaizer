import { Client } from 'pg'

import { ORDERS_CHANNEL } from '@/lib/realtime'

export const dynamic = 'force-dynamic'
// LISTEN requires a real, long-lived TCP connection — Node runtime only.
export const runtime = 'nodejs'

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

  const encoder = new TextEncoder()
  let client: Client | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false

      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          )
        } catch {
          closed = true
        }
      }

      const cleanup = async () => {
        if (closed) return
        closed = true
        if (heartbeat) clearInterval(heartbeat)
        try {
          await client?.end()
        } catch {
          /* connection already gone */
        }
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
        void cleanup()
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
        await cleanup()
        return
      }

      send('ready', { at: new Date().toISOString() })

      /* Comment-only heartbeat. Proxies and mobile networks drop idle
         connections after ~60s; this keeps the pipe warm without producing an
         event the client has to handle. */
      heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          void cleanup()
        }
      }, 25_000)

      request.signal.addEventListener('abort', () => void cleanup())
    },

    async cancel() {
      if (heartbeat) clearInterval(heartbeat)
      try {
        await client?.end()
      } catch {
        /* already closed */
      }
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
