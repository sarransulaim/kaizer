'use client'

import { ChevronDown, Loader2, Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import {
  addEntry,
  closeOpenShift,
  deleteEntry,
  updateEntry,
} from '@/lib/payroll/actions'
import { cn } from '@/lib/utils'

export type ShiftView = {
  id: string
  date: string
  /** `HH:mm`, for the time inputs. */
  inValue: string
  outValue: string
  /** "9:12 AM", for reading. */
  inLabel: string
  outLabel: string | null
  minutes: number
  label: string
  note: string | null
  edited: boolean
  open: boolean
}

export type DayView = {
  date: string
  weekday: string
  minutes: number
  label: string
  shifts: ShiftView[]
}

export type PersonView = {
  id: string
  name: string
  role: string
  hourlyRateCents: number
  totalMinutes: number
  totalLabel: string
  decimalLabel: string
  payLabel: string
  hasOpenShift: boolean
  days: DayView[]
}

/**
 * The week grid, plus the correction tools underneath it.
 *
 * The grid is deliberately a real table inside its own horizontal scroller:
 * nine columns will not fit a phone, and squeezing them into a stack loses the
 * one thing the grid is for — comparing days across a row at a glance.
 */
export function Timesheet({
  people,
  dates,
  weekdays,
}: {
  people: PersonView[]
  dates: string[]
  weekdays: string[]
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      <div className="rounded-card bg-surface ring-line/70 overflow-x-auto ring-1">
        <table className="w-full min-w-[42rem] border-collapse text-sm">
          <thead>
            <tr className="border-line/60 border-b">
              <th className="text-ink-muted px-4 py-2.5 text-left text-xs font-semibold tracking-wide uppercase">
                Person
              </th>
              {weekdays.map((day, index) => (
                <th
                  key={dates[index]}
                  className="text-ink-faint px-2 py-2.5 text-center text-xs font-medium"
                >
                  {day}
                </th>
              ))}
              <th className="text-ink-muted px-3 py-2.5 text-right text-xs font-semibold tracking-wide uppercase">
                Total
              </th>
              <th className="text-ink-muted px-4 py-2.5 text-right text-xs font-semibold tracking-wide uppercase">
                Pay
              </th>
            </tr>
          </thead>
          <tbody className="divide-line/50 divide-y">
            {people.map((person) => (
              <tr key={person.id}>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded(expanded === person.id ? null : person.id)
                    }
                    className="hover:text-accent flex items-center gap-1.5 text-left font-medium transition"
                  >
                    {person.name}
                    <ChevronDown
                      className={cn(
                        'text-ink-faint size-4 transition',
                        expanded === person.id && 'rotate-180',
                      )}
                    />
                  </button>
                  <span className="text-ink-faint block text-xs capitalize">
                    {person.role}
                    {person.hourlyRateCents > 0
                      ? ` · $${(person.hourlyRateCents / 100).toFixed(2)}/hr`
                      : ' · no rate set'}
                  </span>
                </td>

                {person.days.map((day) => (
                  <td
                    key={day.date}
                    className={cn(
                      'tabular px-2 py-3 text-center text-xs',
                      day.minutes > 0 ? 'text-ink' : 'text-ink-faint/50',
                      day.shifts.some((shift) => shift.open) && 'text-amber-400',
                    )}
                  >
                    {day.shifts.some((shift) => shift.open) ? 'on' : day.label}
                  </td>
                ))}

                <td className="tabular px-3 py-3 text-right font-semibold">
                  {person.totalLabel}
                  <span className="text-ink-faint block text-xs font-normal">
                    {person.decimalLabel} h
                  </span>
                </td>
                <td className="tabular px-4 py-3 text-right font-semibold">
                  {person.payLabel}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {people.map((person) =>
        expanded === person.id ? (
          <PersonDetail key={person.id} person={person} dates={dates} />
        ) : null,
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function PersonDetail({ person, dates }: { person: PersonView; dates: string[] }) {
  const [adding, setAdding] = useState(false)

  const shifts = person.days.flatMap((day) => day.shifts)

  return (
    <div className="rounded-card bg-surface ring-line/70 ring-1">
      <div className="border-line/60 flex items-center justify-between gap-3 border-b px-4 py-3">
        <h3 className="font-semibold">{person.name}&apos;s shifts</h3>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setAdding((value) => !value)}
        >
          <Plus className="size-4" />
          Add shift
        </Button>
      </div>

      {adding && (
        <AddShift
          userId={person.id}
          dates={dates}
          onDone={() => setAdding(false)}
        />
      )}

      {shifts.length === 0 && !adding ? (
        <p className="text-ink-faint px-4 py-6 text-center text-sm">
          No shifts recorded this week.
        </p>
      ) : (
        <ul className="divide-line/50 divide-y">
          {person.days.map((day) =>
            day.shifts.map((shift) => (
              <ShiftRow key={shift.id} shift={shift} weekday={day.weekday} />
            )),
          )}
        </ul>
      )}
    </div>
  )
}

function ShiftRow({ shift, weekday }: { shift: ShiftView; weekday: string }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [inValue, setIn] = useState(shift.inValue)
  const [outValue, setOut] = useState(shift.outValue)
  const [note, setNote] = useState(shift.note ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  function save() {
    setError(null)
    startTransition(async () => {
      const result = await updateEntry({
        entryId: shift.id,
        date: shift.date,
        clockInTime: inValue,
        clockOutTime: outValue || null,
        note: note || null,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setEditing(false)
      router.refresh()
    })
  }

  function close() {
    setError(null)
    startTransition(async () => {
      const result = await closeOpenShift(shift.id, outValue || shift.inValue)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setEditing(false)
      router.refresh()
    })
  }

  function remove() {
    setError(null)
    startTransition(async () => {
      const result = await deleteEntry(shift.id)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-ink-muted w-10 shrink-0 text-xs font-medium">
          {weekday}
        </span>

        {editing ? (
          <>
            <TimeInput value={inValue} onChange={setIn} label="Clock in" />
            <span className="text-ink-faint text-xs">to</span>
            <TimeInput value={outValue} onChange={setOut} label="Clock out" />
          </>
        ) : (
          <span className="tabular text-sm">
            {shift.inLabel}
            <span className="text-ink-faint"> → </span>
            {shift.open ? (
              <span className="text-amber-400">still on</span>
            ) : (
              shift.outLabel
            )}
          </span>
        )}

        <span className="tabular text-ink-muted ml-auto text-sm font-medium">
          {shift.open ? '—' : shift.label}
        </span>

        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-ink-faint hover:text-ink shrink-0 text-xs underline"
          >
            {shift.open ? 'Close' : 'Edit'}
          </button>
        )}
      </div>

      {shift.note && !editing && (
        <p className="text-ink-faint mt-1 pl-13 text-xs">{shift.note}</p>
      )}

      {(shift.edited || shift.open) && !editing && (
        <p className="text-ink-faint/70 mt-1 pl-13 text-[0.6875rem]">
          {shift.open ? 'Open shift — not counted yet' : 'Corrected by hand'}
        </p>
      )}

      {editing && (
        <div className="mt-2.5 space-y-2 pl-13">
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Why was this changed? (optional)"
            className="bg-surface-raised ring-line focus:ring-accent text-ink placeholder:text-ink-faint h-10 w-full rounded-lg px-3 text-sm ring-1 focus:ring-2 focus:outline-none"
          />

          {error && <p className="text-xs text-rose-400">{error}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={pending}
              onClick={shift.open && !shift.outValue ? close : save}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false)
                setIn(shift.inValue)
                setOut(shift.outValue)
                setNote(shift.note ?? '')
                setError(null)
              }}
            >
              Cancel
            </Button>

            {confirmDelete ? (
              <span className="ml-auto flex items-center gap-2">
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={pending}
                  onClick={remove}
                >
                  Delete it
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                >
                  Keep
                </Button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                aria-label="Delete this shift"
                className="text-ink-faint hover:text-rose-400 ml-auto transition"
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

function AddShift({
  userId,
  dates,
  onDone,
}: {
  userId: string
  dates: string[]
  onDone: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [date, setDate] = useState(dates[0])
  const [inValue, setIn] = useState('09:00')
  const [outValue, setOut] = useState('17:00')
  const [note, setNote] = useState('')

  function submit() {
    setError(null)
    startTransition(async () => {
      const result = await addEntry({
        userId,
        date,
        clockInTime: inValue,
        clockOutTime: outValue,
        note: note || null,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onDone()
      router.refresh()
    })
  }

  return (
    <div className="border-line/60 space-y-3 border-b px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="bg-surface-raised ring-line focus:ring-accent text-ink h-10 rounded-lg px-3 text-sm ring-1 focus:ring-2 focus:outline-none"
        >
          {dates.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <TimeInput value={inValue} onChange={setIn} label="Clock in" />
        <span className="text-ink-faint text-xs">to</span>
        <TimeInput value={outValue} onChange={setOut} label="Clock out" />
      </div>

      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Note (optional) — e.g. forgot to punch in"
        className="bg-surface-raised ring-line focus:ring-accent text-ink placeholder:text-ink-faint h-10 w-full rounded-lg px-3 text-sm ring-1 focus:ring-2 focus:outline-none"
      />

      {error && <p className="text-xs text-rose-400">{error}</p>}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={pending}
          onClick={submit}
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          Add shift
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function TimeInput({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (value: string) => void
  label: string
}) {
  return (
    <input
      type="time"
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="bg-surface-raised ring-line focus:ring-accent text-ink tabular h-10 rounded-lg px-2.5 text-sm ring-1 focus:ring-2 focus:outline-none"
    />
  )
}
