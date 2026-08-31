'use client'

import { Check, Clock, Delete, Loader2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { punch, type PunchDay } from '@/lib/payroll/actions'
import { formatMinutes } from '@/lib/payroll/hours'
import { cn } from '@/lib/utils'

/**
 * The time clock on the kitchen tablet.
 *
 * Like the order cards, every time-dependent value arrives already formatted
 * from the server — a shift's elapsed minutes rendered from `Date.now()` in the
 * browser would not match what the server sent a moment earlier.
 */
export type ClockPerson = {
  id: string
  name: string
  role: string
  hasPin: boolean
  /** "9:12 AM" when on shift, otherwise null. */
  onSince: string | null
  minutesOn: number | null
}

type Summary = {
  name: string
  action: 'in' | 'out'
  atLabel: string
  /** Length of the shift just closed, on a punch out. */
  minutes?: number
  weekMinutes: number
  lastWeekMinutes: number
  week: PunchDay[]
}

/**
 * How long the week card stays up before the tablet returns to the name list.
 *
 * Long enough to read properly, short enough that the next person at the pass
 * is not left looking at a colleague's hours. Done closes it at once.
 */
const CARD_SECONDS = 20

export function TimeClock({ people }: { people: ClockPerson[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<ClockPerson | null>(null)
  const [pin, setPin] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  /** The PIN already sent, so a re-render cannot submit it a second time. */
  const submitted = useRef<string | null>(null)

  const onShift = people.filter((person) => person.onSince !== null)

  /* Clear the card on its own, so nobody's week is left up on a screen in a
     busy kitchen. */
  useEffect(() => {
    if (!summary) return
    const timer = setTimeout(() => setSummary(null), CARD_SECONDS * 1000)
    return () => clearTimeout(timer)
  }, [summary])

  function reset() {
    setSelected(null)
    setPin('')
  }

  function submit(person: ClockPerson, code: string) {
    startTransition(async () => {
      const result = await punch(person.id, code)

      if (!result.ok) {
        setError(result.error)
        setPin('')
        return
      }

      setError(null)
      setSummary({
        name: result.name,
        action: result.action,
        atLabel: result.atLabel,
        minutes: result.minutes,
        weekMinutes: result.weekMinutes,
        lastWeekMinutes: result.lastWeekMinutes,
        week: result.week,
      })
      reset()
      router.refresh()
    })
  }

  /**
   * Append through the updater rather than reading `pin` from the closure.
   *
   * React batches events, so two keys pressed inside the same batch would both
   * compute their next value from the same stale `pin` and one of the digits
   * would be silently dropped.
   */
  function press(digit: string) {
    if (!selected || pending) return

    setError(null)
    setPin((current) => (current.length >= 4 ? current : current + digit))
  }

  /* Four digits is the whole PIN, so there is nothing to confirm — submit as
     soon as the fourth lands. The ref keeps a re-render from sending the same
     PIN twice, while still allowing a second try at the same wrong code. */
  useEffect(() => {
    if (!selected || pin.length < 4) {
      submitted.current = null
      return
    }
    if (submitted.current === pin) return

    submitted.current = pin
    submit(selected, pin)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, selected])

  function closeAll() {
    setOpen(false)
    setSummary(null)
    setError(null)
    reset()
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          setError(null)
        }}
        className="bg-surface ring-line/70 hover:bg-surface-raised flex items-center gap-2.5 rounded-lg px-3 py-2 ring-1 transition"
      >
        <Clock className="text-ink-muted size-5" />
        <span className="text-left">
          <span className="block text-sm leading-tight font-medium">Time clock</span>
          <span className="text-ink-faint block text-xs leading-tight">
            {onShift.length === 0 ? 'nobody on' : `${onShift.length} on shift`}
          </span>
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Time clock"
          className="bg-canvas/95 fixed inset-0 z-50 flex flex-col backdrop-blur"
        >
          <header className="border-line/60 flex shrink-0 items-center justify-between gap-4 border-b px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-2xl font-bold tracking-tight">Time clock</h2>
              <p className="text-ink-faint truncate text-sm">
                {summary
                  ? `${summary.name}'s week`
                  : selected
                    ? `Enter ${selected.name}'s PIN`
                    : 'Tap your name to punch in or out'}
              </p>
            </div>
            <button
              type="button"
              onClick={closeAll}
              aria-label="Close the time clock"
              className="text-ink-muted hover:text-ink flex size-12 shrink-0 items-center justify-center rounded-lg transition"
            >
              <X className="size-6" />
            </button>
          </header>

          {error && (
            <div className="mx-5 mt-4 flex items-center gap-2.5 rounded-lg bg-rose-500/15 px-4 py-3 text-lg font-medium text-rose-300">
              <X className="size-5 shrink-0" />
              {error}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {summary ? (
              <WeekCard summary={summary} onDone={() => setSummary(null)} />
            ) : selected ? (
              <PinPad
                pin={pin}
                pending={pending}
                onPress={press}
                onBack={() => setPin((current) => current.slice(0, -1))}
                onCancel={reset}
              />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {people.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    disabled={!person.hasPin}
                    onClick={() => {
                      setSelected(person)
                      setPin('')
                      setError(null)
                    }}
                    className={cn(
                      'rounded-card flex flex-col items-start gap-1 px-4 py-4 text-left ring-1 transition disabled:opacity-40',
                      person.onSince
                        ? 'bg-emerald-500/10 ring-emerald-500/40'
                        : 'bg-surface ring-line/70 hover:bg-surface-raised',
                    )}
                  >
                    <span className="text-lg leading-tight font-semibold">
                      {person.name}
                    </span>
                    {person.onSince ? (
                      <span className="text-sm text-emerald-400">
                        On since {person.onSince}
                        {person.minutesOn !== null && (
                          <span className="text-ink-faint">
                            {' '}
                            · {formatMinutes(person.minutesOn)}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-ink-faint text-sm">
                        {person.hasPin ? 'Off the clock' : 'No PIN set'}
                      </span>
                    )}
                  </button>
                ))}

                {people.length === 0 && (
                  <p className="text-ink-faint col-span-full py-12 text-center text-lg">
                    Nobody is on the staff list yet.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * What a worker sees once their PIN is accepted: the punch that just happened,
 * then the week day by day.
 *
 * Hours only. This is a screen in a kitchen, read by whoever is standing at it,
 * so nothing here touches pay — that stays behind the passcode on the payroll
 * page.
 */
function WeekCard({ summary, onDone }: { summary: Summary; onDone: () => void }) {
  const punchedIn = summary.action === 'in'

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div
        className={cn(
          'rounded-card flex items-start gap-3 px-5 py-4 ring-1',
          punchedIn
            ? 'bg-emerald-500/10 ring-emerald-500/40'
            : 'bg-sky-500/10 ring-sky-500/40',
        )}
      >
        <Check
          className={cn(
            'mt-1 size-6 shrink-0',
            punchedIn ? 'text-emerald-400' : 'text-sky-400',
          )}
        />
        <div className="min-w-0">
          <div className="text-2xl leading-tight font-bold">{summary.name}</div>
          <div className={cn('text-base', punchedIn ? 'text-emerald-300' : 'text-sky-300')}>
            Punched {punchedIn ? 'in' : 'out'} at {summary.atLabel}
            {!punchedIn && summary.minutes !== undefined && (
              <span className="text-ink-muted">
                {' '}
                · {formatMinutes(summary.minutes)} shift
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-card bg-surface ring-line/70 ring-1">
        <div className="border-line/60 border-b px-4 py-2.5">
          <h3 className="text-ink-muted text-xs font-semibold tracking-wider uppercase">
            This week
          </h3>
        </div>

        <ul className="divide-line/50 divide-y">
          {summary.week.map((day) => (
            <li
              key={day.date}
              className={cn(
                'flex items-center justify-between gap-3 px-4 py-2.5',
                day.isToday && 'bg-accent/5',
              )}
            >
              <span
                className={cn(
                  'text-base',
                  day.isToday ? 'text-ink font-semibold' : 'text-ink-muted',
                )}
              >
                {day.weekday}
                {day.isToday && (
                  <span className="text-ink-faint ml-1.5 text-xs font-normal">today</span>
                )}
              </span>

              <span className="flex items-center gap-2">
                {day.open && (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
                    on now
                  </span>
                )}
                <span
                  className={cn(
                    'tabular text-base',
                    day.minutes > 0 ? 'text-ink font-medium' : 'text-ink-faint/60',
                  )}
                >
                  {formatMinutes(day.minutes)}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <div className="border-line/60 space-y-1 border-t px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-semibold">Week total</span>
            <span className="tabular text-xl font-bold">
              {summary.weekMinutes > 0 ? formatMinutes(summary.weekMinutes) : '0h'}
            </span>
          </div>

          {/* The payroll week starts on Monday, so early in it a correct zero
              looks like lost time. Last week is also the one about to be paid. */}
          {summary.lastWeekMinutes > 0 && (
            <div className="text-ink-faint flex items-baseline justify-between gap-3 text-sm">
              <span>Last week</span>
              <span className="tabular">{formatMinutes(summary.lastWeekMinutes)}</span>
            </div>
          )}
        </div>
      </div>

      <Button type="button" variant="secondary" size="lg" full onClick={onDone}>
        Done
      </Button>

      <p className="text-ink-faint text-center text-xs">
        Closes on its own in {CARD_SECONDS} seconds
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/** Big keys: this is operated with flour on the fingers, often in a hurry. */
function PinPad({
  pin,
  pending,
  onPress,
  onBack,
  onCancel,
}: {
  pin: string
  pending: boolean
  onPress: (digit: string) => void
  onBack: () => void
  onCancel: () => void
}) {
  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="mb-6 flex justify-center gap-3">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={cn(
              'size-4 rounded-full transition',
              index < pin.length ? 'bg-accent' : 'bg-surface-raised ring-line ring-1',
            )}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <PadKey key={digit} onClick={() => onPress(digit)} disabled={pending}>
            {digit}
          </PadKey>
        ))}

        <PadKey onClick={onCancel} disabled={pending} muted>
          Cancel
        </PadKey>
        <PadKey onClick={() => onPress('0')} disabled={pending}>
          0
        </PadKey>
        <PadKey onClick={onBack} disabled={pending} muted>
          {pending ? (
            <Loader2 className="size-6 animate-spin" />
          ) : (
            <Delete className="size-6" />
          )}
        </PadKey>
      </div>
    </div>
  )
}

function PadKey({
  children,
  onClick,
  disabled,
  muted,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  muted?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-16 items-center justify-center rounded-xl text-2xl font-semibold ring-1 transition active:scale-[0.97] disabled:opacity-40',
        muted
          ? 'bg-surface ring-line/70 text-ink-muted text-base'
          : 'bg-surface-raised ring-line text-ink',
      )}
    >
      {children}
    </button>
  )
}
