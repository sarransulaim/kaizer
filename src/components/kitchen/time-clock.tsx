'use client'

import { Check, Clock, Delete, Loader2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'

import { punch } from '@/lib/payroll/actions'
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

type Outcome = {
  tone: 'in' | 'out' | 'error'
  message: string
  /** The week's hours, shown under the confirmation. Never pay. */
  detail?: string
}

export function TimeClock({ people }: { people: ClockPerson[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<ClockPerson | null>(null)
  const [pin, setPin] = useState('')
  const [pending, startTransition] = useTransition()
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  /** The PIN already sent, so a re-render cannot submit it a second time. */
  const submitted = useRef<string | null>(null)

  const onShift = people.filter((person) => person.onSince !== null)

  /* A confirmation is worth reading but not worth dismissing by hand — the next
     person is usually already reaching for the tablet. */
  useEffect(() => {
    if (!outcome || outcome.tone === 'error') return
    const timer = setTimeout(() => setOutcome(null), 4000)
    return () => clearTimeout(timer)
  }, [outcome])

  function reset() {
    setSelected(null)
    setPin('')
  }

  function submit(person: ClockPerson, code: string) {
    startTransition(async () => {
      const result = await punch(person.id, code)

      if (!result.ok) {
        setOutcome({ tone: 'error', message: result.error })
        setPin('')
        return
      }

      setOutcome({
        tone: result.action,
        message:
          result.action === 'in'
            ? `${result.name} punched in`
            : `${result.name} punched out · ${formatMinutes(result.minutes ?? 0)}`,
        detail:
          result.weekMinutes > 0
            ? `${formatMinutes(result.weekMinutes)} this week${result.action === 'in' ? ' so far' : ''}`
            : result.action === 'in'
              ? 'First shift of the week'
              : undefined,
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

    setOutcome(null)
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

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          setOutcome(null)
        }}
        className="bg-surface ring-line/70 hover:bg-surface-raised flex items-center gap-2.5 rounded-lg px-3 py-2 ring-1 transition"
      >
        <Clock className="text-ink-muted size-5" />
        <span className="text-left">
          <span className="block text-sm leading-tight font-medium">Time clock</span>
          <span className="text-ink-faint block text-xs leading-tight">
            {onShift.length === 0
              ? 'nobody on'
              : `${onShift.length} on shift`}
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
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Time clock</h2>
              <p className="text-ink-faint text-sm">
                {selected
                  ? `Enter ${selected.name}'s PIN`
                  : 'Tap your name to punch in or out'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                reset()
              }}
              aria-label="Close the time clock"
              className="text-ink-muted hover:text-ink flex size-12 items-center justify-center rounded-lg transition"
            >
              <X className="size-6" />
            </button>
          </header>

          {outcome && (
            <div
              className={cn(
                'mx-5 mt-4 flex items-start gap-2.5 rounded-lg px-4 py-3 text-lg font-medium',
                outcome.tone === 'error'
                  ? 'bg-rose-500/15 text-rose-300'
                  : outcome.tone === 'in'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-sky-500/15 text-sky-300',
              )}
            >
              {outcome.tone === 'error' ? (
                <X className="size-5 shrink-0" />
              ) : (
                <Check className="size-5 shrink-0" />
              )}
              <span className="min-w-0">
                {outcome.message}
                {outcome.detail && (
                  <span className="block text-sm font-normal opacity-80">
                    {outcome.detail}
                  </span>
                )}
              </span>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {selected ? (
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
                      setOutcome(null)
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
