import { AlertTriangle, CalendarPlus, ChefHat, PartyPopper } from 'lucide-react'
import Link from 'next/link'

import { OrderCard } from '@/components/orders/order-card'
import { StatTile } from '@/components/stat-tile'
import { buttonStyles } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { UPCOMING_WINDOW_DAYS } from '@/lib/config'
import { formatCentsCompact } from '@/lib/money'
import {
  getDashboardSnapshot,
  getOverdueOrders,
  getPrepSummary,
  getRecentOrders,
  getTodayOrders,
  getUpcomingOrders,
  type OrderWithItems,
} from '@/lib/orders/queries'
import { TERMINAL_STATUSES } from '@/lib/orders/status'
import { dayLabel, formatDate, formatDateLong, monthLabel, today } from '@/lib/time'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Dashboard' }

/**
 * The single page the business is run from.
 *
 * Today and Upcoming used to be separate routes, which meant the two numbers
 * that matter most — what is happening now, and what is coming — could never be
 * seen at once. They are one page now: headline figures at the top, and one
 * list underneath whose scope is switched by a tab rather than by navigating
 * away.
 */

const VIEWS = ['today', 'upcoming', 'all'] as const
type View = (typeof VIEWS)[number]

function parseView(value: string | string[] | undefined): View {
  return typeof value === 'string' && (VIEWS as readonly string[]).includes(value)
    ? (value as View)
    : 'today'
}

export default async function DashboardPage(props: PageProps<'/'>) {
  const params = await props.searchParams
  const view = parseView(params.view)

  /* The list query is chosen up front so it runs alongside the figures rather
     than after them — one round of waiting, not two. */
  const listQuery =
    view === 'upcoming'
      ? getUpcomingOrders(UPCOMING_WINDOW_DAYS)
      : view === 'all'
        ? getRecentOrders(40)
        : getTodayOrders()

  const [snapshot, overdue, prep, list] = await Promise.all([
    getDashboardSnapshot(),
    getOverdueOrders(),
    getPrepSummary(today()),
    listQuery,
  ])

  /* Completed orders drop off the cook list, so this counts what is still to
     be made rather than everything the day asked for. */
  const prepRemaining = prep.filter((line) => line.quantity > 0)
  const prepUnits = prepRemaining.reduce((sum, line) => sum + line.quantity, 0)
  const prepTotal = prep.reduce((sum, line) => sum + line.totalQuantity, 0)

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 lg:py-8">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-ink-faint text-sm">{formatDateLong(today())}</p>
      </header>

      {/* ------------------------------- Today ------------------------------ */}
      <SectionLabel>Today</SectionLabel>
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          label="Orders"
          value={snapshot.todayOrders}
          hint={
            snapshot.todayOrders > 0
              ? `${snapshot.todayOpen} still open`
              : undefined
          }
        />
        <StatTile
          label="Remaining"
          value={snapshot.todayOpen}
          tone={snapshot.todayOpen > 0 ? 'warning' : 'positive'}
        />
        <StatTile
          label="Revenue"
          value={formatCentsCompact(snapshot.todayRevenueCents)}
        />
        <StatTile
          label="Unpaid"
          value={formatCentsCompact(snapshot.todayUnpaidCents)}
          tone={snapshot.todayUnpaidCents > 0 ? 'warning' : 'positive'}
        />
      </div>

      {/* ------------------------------ Overall ----------------------------- */}
      <SectionLabel>Overall</SectionLabel>
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          label={monthLabel()}
          value={formatCentsCompact(snapshot.monthRevenueCents)}
          hint={`${snapshot.monthOrders} order${snapshot.monthOrders === 1 ? '' : 's'}`}
        />
        <StatTile
          label={`Next ${UPCOMING_WINDOW_DAYS} days`}
          value={snapshot.upcomingOrders}
          hint={formatCentsCompact(snapshot.upcomingRevenueCents)}
        />
        <StatTile
          label="Outstanding"
          value={formatCentsCompact(snapshot.outstandingCents)}
          tone={snapshot.outstandingCents > 0 ? 'warning' : 'positive'}
          hint="all unpaid balances"
        />
        <StatTile
          label="All orders"
          value={snapshot.totalOrders}
          hint={`${snapshot.openOrders} open`}
        />
      </div>

      {/* ---------------------------- Prep peek ----------------------------- */}
      {prep.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="flex items-baseline justify-between gap-3">
            <CardTitle>
              {prepUnits > 0
                ? `Still to cook · ${prepUnits} of ${prepTotal}`
                : `Cook list today · all ${prepTotal} made`}
            </CardTitle>
            <Link
              href="/prep"
              className="text-accent shrink-0 text-xs font-medium hover:underline"
            >
              Full prep sheet
            </Link>
          </CardHeader>
          <CardBody>
            {prepRemaining.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {prepRemaining.map((line) => (
                  <div
                    key={`${line.itemName}-${line.sizeLabel}`}
                    className="bg-surface-raised ring-line/70 flex items-baseline gap-2 rounded-lg px-2.5 py-1.5 ring-1"
                  >
                    <span className="tabular text-accent text-base font-bold">
                      {line.quantity}
                    </span>
                    <span className="text-xs">
                      {line.itemName}
                      <span className="text-ink-faint"> · {line.sizeLabel}</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-emerald-400">
                Everything for today has been made and handed over.
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {/* ----------------------------- Overdue ------------------------------ */}
      {overdue.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-rose-400">
            <AlertTriangle className="size-4" />
            Still open from earlier days · {overdue.length}
          </h2>
          <div className="space-y-2.5">
            {overdue.map((order) => (
              <OrderCard key={order.id} order={order} showDate />
            ))}
          </div>
        </section>
      )}

      {/* ------------------------------ Tabs -------------------------------- */}
      <nav className="bg-surface-raised ring-line mb-4 grid grid-cols-3 gap-1 rounded-lg p-1 ring-1">
        <Tab view="today" active={view} label="Today" count={snapshot.todayOrders} />
        <Tab
          view="upcoming"
          active={view}
          label="Upcoming"
          count={snapshot.upcomingOrders}
        />
        <Tab view="all" active={view} label="All" count={snapshot.totalOrders} />
      </nav>

      {view === 'today' && <TodayList orders={list} />}
      {view === 'upcoming' && <UpcomingList orders={list} />}
      {view === 'all' && <AllList orders={list} />}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                                   Views                                    */
/* -------------------------------------------------------------------------- */

function TodayList({ orders }: { orders: OrderWithItems[] }) {
  const live = orders.filter((o) => !TERMINAL_STATUSES.includes(o.status))
  const done = orders.filter((o) => o.status === 'completed')
  const cancelled = orders.filter((o) => o.status === 'cancelled')
  const billable = orders.filter((o) => o.status !== 'cancelled')

  if (orders.length === 0) return <EmptyToday />

  return (
    <>
      {live.length > 0 ? (
        <section className="mb-6">
          <h2 className="text-ink-muted mb-2 text-sm font-semibold">
            In progress · {live.length}
          </h2>
          <div className="space-y-2.5">
            {live.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        </section>
      ) : (
        <div className="rounded-card bg-surface ring-line/70 mb-6 flex items-center gap-3 px-4 py-5 ring-1">
          <PartyPopper className="size-5 shrink-0 text-emerald-400" />
          <div>
            <p className="font-medium">Everything&apos;s out.</p>
            <p className="text-ink-faint text-sm">
              All {billable.length} order{billable.length === 1 ? '' : 's'} for
              today are closed.
            </p>
          </div>
        </div>
      )}

      {done.length > 0 && (
        <Collapsed label="Completed" count={done.length} orders={done} />
      )}
      {cancelled.length > 0 && (
        <Collapsed label="Cancelled" count={cancelled.length} orders={cancelled} muted />
      )}
    </>
  )
}

function UpcomingList({ orders }: { orders: OrderWithItems[] }) {
  if (orders.length === 0) {
    return (
      <Empty
        icon={<CalendarPlus className="text-ink-faint mx-auto size-8" />}
        title="Nothing booked yet"
        body="Orders for future dates will show up here."
      />
    )
  }

  /* Grouped in JS rather than with a second aggregate query — the upcoming
     window is a few dozen orders at most, and this keeps the day totals and the
     order list guaranteed consistent with each other. */
  const byDate = new Map<string, OrderWithItems[]>()
  for (const order of orders) {
    const existing = byDate.get(order.serviceDate)
    if (existing) existing.push(order)
    else byDate.set(order.serviceDate, [order])
  }

  return (
    <div className="space-y-7">
      {[...byDate.entries()].map(([date, dayOrders]) => {
        const revenue = dayOrders.reduce((sum, o) => sum + o.totalCents, 0)
        const units = dayOrders.reduce(
          (sum, o) => sum + o.items.reduce((n, i) => n + i.quantity, 0),
          0,
        )

        return (
          <section key={date}>
            <div className="border-line/60 mb-2.5 flex items-baseline justify-between gap-3 border-b pb-2">
              <div>
                <h2 className="font-semibold">{dayLabel(date)}</h2>
                <p className="text-ink-faint text-xs">{formatDate(date)}</p>
              </div>
              <div className="text-right">
                <div className="tabular text-sm font-medium">
                  {formatCentsCompact(revenue)}
                </div>
                <div className="text-ink-faint tabular text-xs">
                  {dayOrders.length} order{dayOrders.length === 1 ? '' : 's'} ·{' '}
                  {units} item{units === 1 ? '' : 's'}
                </div>
              </div>
            </div>

            <div className="space-y-2.5">
              {dayOrders.map((order) => (
                <OrderCard key={order.id} order={order} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function AllList({ orders }: { orders: OrderWithItems[] }) {
  if (orders.length === 0) return <EmptyToday />

  return (
    <div className="space-y-2.5">
      {orders.map((order) => (
        <OrderCard key={order.id} order={order} showDate />
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                                   Pieces                                   */
/* -------------------------------------------------------------------------- */

function Tab({
  view,
  active,
  label,
  count,
}: {
  view: View
  active: View
  label: string
  count: number
}) {
  const selected = view === active

  return (
    <Link
      href={view === 'today' ? '/' : `/?view=${view}`}
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'flex h-10 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium transition',
        selected
          ? 'bg-accent text-accent-ink shadow-sm'
          : 'text-ink-muted hover:text-ink hover:bg-line/50',
      )}
    >
      {label}
      <span className={cn('tabular text-xs', !selected && 'text-ink-faint')}>
        {count}
      </span>
    </Link>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-ink-faint mb-2 text-xs font-semibold tracking-wider uppercase">
      {children}
    </h2>
  )
}

function Collapsed({
  label,
  count,
  orders,
  muted = false,
}: {
  label: string
  count: number
  orders: OrderWithItems[]
  muted?: boolean
}) {
  return (
    <details className="group mb-4">
      <summary
        className={cn(
          'cursor-pointer list-none text-sm font-semibold transition',
          muted ? 'text-ink-faint hover:text-ink-muted' : 'text-ink-muted hover:text-ink',
        )}
      >
        {label} · {count}
        <span className="text-ink-faint ml-1 font-normal group-open:hidden">
          (show)
        </span>
      </summary>
      <div className="mt-2 space-y-2.5">
        {orders.map((order) => (
          <OrderCard key={order.id} order={order} />
        ))}
      </div>
    </details>
  )
}

function Empty({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <div className="rounded-card bg-surface ring-line/70 px-6 py-12 text-center ring-1">
      {icon}
      <p className="mt-3 font-medium">{title}</p>
      <p className="text-ink-faint mx-auto mt-1 max-w-xs text-sm">{body}</p>
    </div>
  )
}

function EmptyToday() {
  return (
    <div className="rounded-card bg-surface ring-line/70 px-6 py-12 text-center ring-1">
      <ChefHat className="text-ink-faint mx-auto size-8" />
      <p className="mt-3 font-medium">No orders yet</p>
      <p className="text-ink-faint mx-auto mt-1 max-w-xs text-sm">
        Orders taken over WhatsApp or the Google Form go in here.
      </p>
      <Link
        href="/orders/new"
        className={buttonStyles({ variant: 'primary', className: 'mt-5' })}
      >
        Add an order
      </Link>
    </div>
  )
}
