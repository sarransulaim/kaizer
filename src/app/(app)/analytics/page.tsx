import { BarChart3 } from 'lucide-react'
import Link from 'next/link'

import { BarList, ColumnChart, StatusBar } from '@/components/analytics/charts'
import { StatTile } from '@/components/stat-tile'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import {
  getAnalytics,
  parseRange,
  RANGE_LABELS,
  RANGES,
  resolveRange,
} from '@/lib/analytics/queries'
import { formatCents, formatCentsCompact } from '@/lib/money'
import {
  FULFILLMENT_LABELS,
  PAYMENT_STATUS_LABELS,
} from '@/lib/orders/status'
import { dayOfMonth, shortDate } from '@/lib/time'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Analytics' }

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  google_form: 'Google Form',
  phone: 'Phone',
  walk_in: 'Walk-in',
  other: 'Other',
}

const METHOD_LABELS: Record<string, string> = {
  zelle: 'Zelle',
  cash: 'Cash',
  card: 'Card',
  venmo: 'Venmo',
  other: 'Other',
}

/** Monday first — the working week, not the American calendar week. */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Payment state is the one thing on this page where colour carries meaning. */
const PAYMENT_STATUS_FILLS: Record<string, string> = {
  paid: 'bg-emerald-400',
  partial: 'bg-amber-400',
  unpaid: 'bg-rose-400',
  refunded: 'bg-zinc-500',
}

export default async function AnalyticsPage(props: PageProps<'/analytics'>) {
  const params = await props.searchParams
  const range = parseRange(params.range)
  const { from, to } = await resolveRange(range)
  const data = await getAnalytics(from, to)

  const { headline } = data
  const collectedShare =
    headline.bookedCents > 0
      ? Math.round((headline.collectedCents / headline.bookedCents) * 100)
      : 0

  const bestWeekday = [...data.weekdays].sort(
    (a, b) => b.revenueCents - a.revenueCents,
  )[0]

  const weekdayColumns = WEEKDAY_ORDER.map((weekday) => {
    const row = data.weekdays.find((d) => d.weekday === weekday)
    return {
      key: String(weekday),
      label: WEEKDAY_NAMES[weekday],
      value: row?.revenueCents ?? 0,
      display: formatCentsCompact(row?.revenueCents ?? 0),
    }
  })

  const seriesColumns = data.series.map((point) => ({
    key: point.date,
    label:
      data.seriesGrouping === 'week' ? shortDate(point.date) : dayOfMonth(point.date),
    value: point.revenueCents,
    display: formatCentsCompact(point.revenueCents),
  }))

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 lg:py-8">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-ink-faint text-sm">
          {shortDate(from)} – {shortDate(to)} · by service date
        </p>
      </header>

      {/* One filter row, above everything it scopes. */}
      <nav className="mb-6 flex flex-wrap gap-2">
        {RANGES.map((option) => (
          <Link
            key={option}
            href={option === '30d' ? '/analytics' : `/analytics?range=${option}`}
            aria-current={option === range ? 'page' : undefined}
            className={cn(
              'flex h-9 items-center rounded-lg px-3 text-sm font-medium ring-1 transition',
              option === range
                ? 'bg-accent text-accent-ink ring-accent'
                : 'bg-surface-raised text-ink-muted ring-line hover:text-ink',
            )}
          >
            {RANGE_LABELS[option]}
          </Link>
        ))}
      </nav>

      {headline.orders === 0 ? (
        <div className="rounded-card bg-surface ring-line/70 px-6 py-12 text-center ring-1">
          <BarChart3 className="text-ink-faint mx-auto size-8" />
          <p className="mt-3 font-medium">No orders in this period</p>
          <p className="text-ink-faint mx-auto mt-1 max-w-xs text-sm">
            Pick a wider range, or take an order and it will show up here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* ------------------------------ Hero ---------------------------- */}
          <Card>
            <CardBody className="pt-4">
              <p className="text-ink-faint text-xs tracking-wide uppercase">
                Booked revenue
              </p>
              {/* Proportional figures, not tabular — a standalone display number
                  looks loose when every digit is the width of a zero. */}
              <p className="mt-1 text-5xl leading-none font-semibold">
                {formatCents(headline.bookedCents)}
              </p>
              <p className="text-ink-muted mt-2 text-sm">
                {headline.orders} order{headline.orders === 1 ? '' : 's'} ·{' '}
                {formatCentsCompact(headline.avgOrderCents)} average ·{' '}
                {headline.units} item{headline.units === 1 ? '' : 's'} sold
              </p>
            </CardBody>
          </Card>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile
              label="Collected"
              value={formatCentsCompact(headline.collectedCents)}
              hint={`${collectedShare}% of booked`}
              tone={collectedShare >= 100 ? 'positive' : 'default'}
            />
            <StatTile
              label="Outstanding"
              value={formatCentsCompact(headline.outstandingCents)}
              tone={headline.outstandingCents > 0 ? 'warning' : 'positive'}
              hint="still to collect"
            />
            <StatTile
              label="Customers"
              value={headline.customers}
              hint={`${headline.repeatCustomers} ordered more than once`}
            />
            <StatTile
              label="Cancelled"
              value={headline.cancelled}
              tone={headline.cancelled > 0 ? 'warning' : 'positive'}
              hint="excluded from revenue"
            />
          </div>

          {/* --------------------------- Over time -------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle>
                Revenue by {data.seriesGrouping === 'week' ? 'week' : 'day'}
              </CardTitle>
            </CardHeader>
            <CardBody>
              <ColumnChart columns={seriesColumns} />
            </CardBody>
          </Card>

          {/* ---------------------------- Items ----------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle>What sells — by revenue</CardTitle>
            </CardHeader>
            <CardBody>
              <BarList
                rows={data.items.map((item) => ({
                  key: item.itemName,
                  label: item.itemName,
                  value: item.revenueCents,
                  display: formatCentsCompact(item.revenueCents),
                  meta: `${item.units} sold across ${item.orderCount} order${item.orderCount === 1 ? '' : 's'}`,
                }))}
              />
              <p className="text-ink-faint mt-3 text-xs">
                Item revenue is the sum of line totals, before any order-level
                discount.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Which size sells — by units</CardTitle>
            </CardHeader>
            <CardBody>
              <BarList
                rows={data.sizes.map((size) => ({
                  key: `${size.itemName}-${size.sizeLabel}`,
                  label: size.itemName,
                  sublabel: size.sizeLabel,
                  value: size.units,
                  display: `${size.units}`,
                  meta: formatCentsCompact(size.revenueCents),
                }))}
              />
            </CardBody>
          </Card>

          {/* ---------------------------- Days ------------------------------ */}
          <Card>
            <CardHeader>
              <CardTitle>
                Best days
                {bestWeekday && bestWeekday.revenueCents > 0 && (
                  <span className="text-ink-faint font-normal normal-case">
                    {' '}
                    — {WEEKDAY_NAMES[bestWeekday.weekday]} leads with{' '}
                    {formatCentsCompact(bestWeekday.revenueCents)}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardBody>
              <ColumnChart columns={weekdayColumns} height={88} />
              <ul className="divide-line/50 mt-3 divide-y">
                {WEEKDAY_ORDER.map((weekday) => {
                  const row = data.weekdays.find((d) => d.weekday === weekday)
                  if (!row || row.orders === 0) return null
                  return (
                    <li
                      key={weekday}
                      className="flex items-baseline justify-between gap-3 py-1.5 text-sm"
                    >
                      <span>{WEEKDAY_NAMES[weekday]}</span>
                      <span className="text-ink-faint tabular text-xs">
                        {row.orders} order{row.orders === 1 ? '' : 's'}
                      </span>
                      <span className="tabular w-20 shrink-0 text-right font-medium">
                        {formatCentsCompact(row.revenueCents)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </CardBody>
          </Card>

          {/* --------------------------- Payments --------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle>Payment status</CardTitle>
            </CardHeader>
            <CardBody>
              <StatusBar
                segments={data.paymentStatus.map((row) => ({
                  key: row.status,
                  label: `${PAYMENT_STATUS_LABELS[row.status]} · ${row.orders} order${row.orders === 1 ? '' : 's'}`,
                  value: row.bookedCents,
                  display: formatCentsCompact(row.bookedCents),
                  className: PAYMENT_STATUS_FILLS[row.status] ?? 'bg-zinc-500',
                }))}
              />
              <p className="text-ink-muted mt-3 text-sm">
                {formatCents(headline.collectedCents)} collected of{' '}
                {formatCents(headline.bookedCents)} booked.
                {headline.outstandingCents > 0 && (
                  <span className="text-amber-400">
                    {' '}
                    {formatCents(headline.outstandingCents)} still owed.
                  </span>
                )}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>How people pay</CardTitle>
            </CardHeader>
            <CardBody>
              <BarList
                rows={data.methods.map((row) => ({
                  key: row.method ?? 'none',
                  label: row.method
                    ? (METHOD_LABELS[row.method] ?? row.method)
                    : 'Not recorded',
                  value: row.collectedCents,
                  display: formatCentsCompact(row.collectedCents),
                  meta: `${row.orders} order${row.orders === 1 ? '' : 's'}`,
                }))}
              />
            </CardBody>
          </Card>

          {/* ---------------------------- Mix ------------------------------- */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Pickup or delivery</CardTitle>
              </CardHeader>
              <CardBody>
                <BarList
                  rows={data.fulfillment.map((row) => ({
                    key: row.key,
                    label: FULFILLMENT_LABELS[row.key],
                    value: row.orders,
                    display: `${row.orders}`,
                    meta: formatCentsCompact(row.revenueCents),
                  }))}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Where orders come from</CardTitle>
              </CardHeader>
              <CardBody>
                <BarList
                  rows={data.channels.map((row) => ({
                    key: row.key,
                    label: CHANNEL_LABELS[row.key] ?? row.key,
                    value: row.orders,
                    display: `${row.orders}`,
                    meta: formatCentsCompact(row.revenueCents),
                  }))}
                />
              </CardBody>
            </Card>
          </div>

          {/* -------------------------- Customers --------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle>Best customers</CardTitle>
            </CardHeader>
            <CardBody>
              <BarList
                rows={data.topCustomers.map((row) => ({
                  key: row.phone,
                  label: row.name,
                  value: row.revenueCents,
                  display: formatCentsCompact(row.revenueCents),
                  meta:
                    row.outstandingCents > 0
                      ? `${row.orders} order${row.orders === 1 ? '' : 's'} · ${formatCentsCompact(row.outstandingCents)} owed`
                      : `${row.orders} order${row.orders === 1 ? '' : 's'}`,
                }))}
              />
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  )
}
