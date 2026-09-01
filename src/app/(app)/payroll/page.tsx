import { AlertTriangle, ChevronLeft, ChevronRight, Users } from 'lucide-react'
import Link from 'next/link'

import { Timesheet, type PersonView } from '@/components/payroll/timesheet'
import { StatTile } from '@/components/stat-tile'
import { formatCentsCompact } from '@/lib/money'
import { decimalHours, formatMinutes } from '@/lib/payroll/hours'
import { getPayrollWeek } from '@/lib/payroll/queries'
import {
  addDays,
  dateOf,
  formatDate,
  formatInstantTime,
  instantToTimeValue,
  startOfWeek,
  today,
  weekdayShort,
  weekRangeLabel,
} from '@/lib/time'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Payroll' }

/**
 * The week's timesheet: who worked, when, and what they are owed.
 *
 * Monday to Sunday, because that is the week the business counts in. Hours are
 * shown both as h/m and as decimal hours — the first is what the owner reads,
 * the second is what gets typed into a payroll service.
 */
export default async function PayrollPage(props: PageProps<'/payroll'>) {
  const params = await props.searchParams
  const requested = typeof params.week === 'string' ? params.week : undefined
  const monday = startOfWeek(requested)

  const week = await getPayrollWeek(monday)
  const thisWeek = startOfWeek()

  const people: PersonView[] = week.people.map((person) => ({
    id: person.id,
    name: person.name,
    role: person.role,
    hourlyRateCents: person.hourlyRateCents,
    totalMinutes: person.totalMinutes,
    totalLabel: formatMinutes(person.totalMinutes),
    decimalLabel: decimalHours(person.totalMinutes),
    payLabel: formatCentsCompact(person.payCents),
    hasOpenShift: person.hasOpenShift,
    paid: person.paid
      ? {
          amountLabel: formatCentsCompact(person.paid.amountCents),
          atLabel: formatDate(dateOf(person.paid.paidAt)),
          /* The hours were corrected after the money changed hands, so the
             sheet and the payment no longer agree. Say so rather than
             showing one of the two numbers as if it were the truth. */
          differs: person.paid.amountCents !== person.payCents,
          currentLabel: formatCentsCompact(person.payCents),
        }
      : null,
    days: person.days.map((day) => ({
      date: day.date,
      weekday: weekdayShort(day.date),
      minutes: day.minutes,
      label: formatMinutes(day.minutes),
      shifts: day.shifts.map((shift) => ({
        id: shift.id,
        date: day.date,
        inValue: instantToTimeValue(shift.clockInAt),
        outValue: shift.clockOutAt ? instantToTimeValue(shift.clockOutAt) : '',
        inLabel: formatInstantTime(shift.clockInAt),
        outLabel: shift.clockOutAt ? formatInstantTime(shift.clockOutAt) : null,
        minutes: shift.minutes,
        label: formatMinutes(shift.minutes),
        note: shift.note,
        edited: shift.edited,
        open: shift.open,
      })),
    })),
  }))

  const openShifts = people.filter((person) => person.hasOpenShift).length

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 lg:py-8">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Payroll</h1>
        <p className="text-ink-faint text-sm">
          {weekRangeLabel(monday)} · Monday to Sunday
        </p>
      </header>

      <div className="mb-5 flex items-center gap-2">
        <WeekLink week={addDays(monday, -7)} label="Previous week">
          <ChevronLeft className="size-4" />
        </WeekLink>
        <WeekLink week={addDays(monday, 7)} label="Next week">
          <ChevronRight className="size-4" />
        </WeekLink>
        {monday !== thisWeek && (
          <Link
            href="/payroll"
            className="bg-surface-raised text-ink-muted ring-line hover:text-ink flex h-10 items-center rounded-lg px-3 text-sm font-medium ring-1 transition"
          >
            This week
          </Link>
        )}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Hours" value={formatMinutes(week.totalMinutes)} />
        <StatTile
          label="Payout"
          value={formatCentsCompact(week.totalPayCents)}
        />
        <StatTile
          label="Still to pay"
          value={formatCentsCompact(week.owedCents)}
          tone={week.owedCents > 0 ? 'warning' : 'positive'}
          hint={
            week.paidCount > 0
              ? `${week.paidCount} of ${week.people.length} settled`
              : undefined
          }
        />
        <StatTile
          label="Open shifts"
          value={openShifts}
          tone={openShifts > 0 ? 'warning' : 'positive'}
          hint={openShifts > 0 ? 'not counted yet' : undefined}
        />
      </div>

      {openShifts > 0 && (
        <p className="mb-5 flex items-start gap-2 rounded-lg bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            Someone is still on the clock. An open shift counts as zero hours
            until it is closed, so this week&apos;s payout is not final. Close it
            below, or on the kitchen tablet.
          </span>
        </p>
      )}

      {week.unpaidCount > 0 && (
        <p className="text-ink-faint mb-5 text-xs">
          {week.unpaidCount} {week.unpaidCount === 1 ? 'person has' : 'people have'} no
          hourly rate set, so their pay shows as nothing. Set rates in{' '}
          <Link href="/settings" className="text-ink-muted underline">
            Settings
          </Link>
          .
        </p>
      )}

      {people.length === 0 ? (
        <div className="rounded-card bg-surface ring-line/70 px-6 py-12 text-center ring-1">
          <Users className="text-ink-faint mx-auto size-8" />
          <p className="mt-3 font-medium">Nobody on the payroll yet</p>
          <p className="text-ink-faint mx-auto mt-1 max-w-sm text-sm">
            Add your staff in Settings, give each of them a 4-digit PIN, and
            they can start punching in on the kitchen tablet.
          </p>
          <Link
            href="/settings"
            className="bg-accent text-accent-ink hover:bg-accent-strong mt-5 inline-flex h-11 items-center rounded-lg px-4 text-sm font-medium transition"
          >
            Add staff
          </Link>
        </div>
      ) : (
        <Timesheet
          people={people}
          dates={week.dates}
          weekdays={week.dates.map(weekdayShort)}
          today={today()}
          monday={monday}
        />
      )}
    </div>
  )
}

function WeekLink({
  week,
  label,
  children,
}: {
  week: string
  label: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={`/payroll?week=${week}`}
      aria-label={label}
      className={cn(
        'bg-surface-raised text-ink-muted ring-line hover:text-ink flex size-10 items-center justify-center rounded-lg ring-1 transition',
      )}
    >
      {children}
    </Link>
  )
}
