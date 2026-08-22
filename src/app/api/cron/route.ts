import { runScheduler } from '@/lib/scheduler'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Notification tick. Railway invokes this on a schedule; it is also safe to hit
 * by hand while testing, because every alert it sends is deduplicated by key.
 *
 * Guarded by a shared secret so the endpoint can't be triggered by anyone who
 * finds the URL — the app itself has no auth yet.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET

  if (!secret) {
    return Response.json(
      { error: 'CRON_SECRET is not configured' },
      { status: 500 },
    )
  }

  const header = request.headers.get('authorization')
  const provided =
    header?.replace(/^Bearer\s+/i, '') ??
    new URL(request.url).searchParams.get('secret')

  if (provided !== secret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runScheduler()
    return Response.json({ ok: true, ...result })
  } catch (error) {
    console.error('[cron] scheduler failed', error)
    return Response.json({ error: 'Scheduler failed' }, { status: 500 })
  }
}
