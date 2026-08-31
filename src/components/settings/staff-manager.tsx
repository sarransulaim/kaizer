'use client'

import { KeyRound, Loader2, Plus, UserPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { parseDollarsToCents } from '@/lib/money'
import {
  createStaff,
  setStaffActive,
  setStaffPin,
  updateStaff,
} from '@/lib/staff/actions'
import { cn } from '@/lib/utils'

export type StaffView = {
  id: string
  name: string
  role: string
  phone: string | null
  hourlyRateCents: number
  active: boolean
  hasPin: boolean
  onShift: boolean
  shiftCount: number
}

const ROLES = [
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'driver', label: 'Driver' },
  { value: 'manager', label: 'Manager' },
  { value: 'owner', label: 'Owner' },
] as const

type Role = (typeof ROLES)[number]['value']

export function StaffManager({ staff }: { staff: StaffView[] }) {
  const [adding, setAdding] = useState(false)

  return (
    <div className="space-y-3">
      <p className="text-ink-faint text-xs leading-relaxed">
        Everyone here can punch in on the kitchen tablet using their 4-digit PIN.
        The rate is what the payroll week is costed at — leave it at zero for
        anyone not on hourly pay.
      </p>

      <div className="space-y-2">
        {staff.map((person) => (
          <StaffRow key={person.id} person={person} />
        ))}
      </div>

      {adding ? (
        <AddStaff onDone={() => setAdding(false)} />
      ) : (
        <Button type="button" variant="secondary" full onClick={() => setAdding(true)}>
          <UserPlus className="size-4" />
          Add someone
        </Button>
      )}
    </div>
  )
}

function StaffRow({ person }: { person: StaffView }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState(person.name)
  const [role, setRole] = useState<Role>(person.role as Role)
  const [rate, setRate] = useState(
    person.hourlyRateCents > 0 ? (person.hourlyRateCents / 100).toFixed(2) : '',
  )
  const [phone, setPhone] = useState(person.phone ?? '')
  const [pin, setPin] = useState('')

  function save() {
    setError(null)
    const rateCents = rate.trim() ? (parseDollarsToCents(rate) ?? -1) : 0
    if (rateCents < 0) {
      setError('Enter a rate like 18 or 17.50')
      return
    }

    startTransition(async () => {
      const result = await updateStaff({
        userId: person.id,
        name,
        role,
        hourlyRateCents: rateCents,
        phone: phone || undefined,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  function savePin() {
    setError(null)
    startTransition(async () => {
      const result = await setStaffPin(person.id, pin)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setPin('')
      router.refresh()
    })
  }

  function toggleActive() {
    setError(null)
    startTransition(async () => {
      const result = await setStaffActive(person.id, !person.active)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div
      className={cn(
        'rounded-card bg-surface-raised ring-line/70 overflow-hidden ring-1',
        !person.active && 'opacity-60',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-medium">
            {person.name}
            {person.onShift && (
              <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[0.625rem] font-medium text-emerald-300">
                on shift
              </span>
            )}
            {!person.active && (
              <span className="text-ink-faint text-[0.625rem]">inactive</span>
            )}
          </span>
          <span className="text-ink-faint block text-xs capitalize">
            {person.role}
            {person.hourlyRateCents > 0
              ? ` · $${(person.hourlyRateCents / 100).toFixed(2)}/hr`
              : ' · no rate'}
            <span className={person.hasPin ? '' : 'text-amber-400'}>
              {person.hasPin ? ' · PIN set' : ' · no PIN'}
            </span>
          </span>
        </span>
      </button>

      {open && (
        <div className="border-line/60 space-y-3 border-t px-3.5 py-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="Role">
              <Select
                value={role}
                onChange={(event) => setRole(event.target.value as Role)}
              >
                {ROLES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Hourly rate" hint="dollars">
              <Input
                inputMode="decimal"
                placeholder="0.00"
                value={rate}
                onChange={(event) => setRate(event.target.value)}
              />
            </Field>
            <Field label="Phone" hint="optional">
              <Input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </Field>
          </div>

          {error && <p className="text-xs text-rose-400">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={pending}
              onClick={save}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Save changes
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending || person.onShift}
              onClick={toggleActive}
            >
              {person.active ? 'Turn off' : 'Turn on'}
            </Button>
          </div>

          <div className="border-line/60 border-t pt-3">
            <Field
              label={person.hasPin ? 'Change PIN' : 'Set PIN'}
              hint="4 digits"
            >
              <div className="flex gap-2">
                <Input
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="••••"
                  value={pin}
                  onChange={(event) =>
                    setPin(event.target.value.replace(/\D/g, '').slice(0, 4))
                  }
                  className="tabular w-28"
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending || pin.length !== 4}
                  onClick={savePin}
                >
                  <KeyRound className="size-4" />
                  Set
                </Button>
              </div>
            </Field>
            <p className="text-ink-faint mt-1.5 text-xs">
              PINs cannot be read back — if someone forgets theirs, set a new one.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function AddStaff({ onDone }: { onDone: () => void }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('kitchen')
  const [rate, setRate] = useState('')
  const [pin, setPin] = useState('')

  function submit() {
    setError(null)

    if (!name.trim()) {
      setError('Name is required')
      return
    }
    const rateCents = rate.trim() ? (parseDollarsToCents(rate) ?? -1) : 0
    if (rateCents < 0) {
      setError('Enter a rate like 18 or 17.50')
      return
    }
    if (pin && pin.length !== 4) {
      setError('A PIN must be exactly 4 digits')
      return
    }

    startTransition(async () => {
      const result = await createStaff({
        name,
        role,
        hourlyRateCents: rateCents,
        pin: pin || undefined,
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
    <div className="rounded-card bg-surface-raised ring-line/70 space-y-3 px-3.5 py-3 ring-1">
      <h4 className="text-sm font-semibold">New person</h4>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" required>
          <Input
            autoFocus
            placeholder="Full name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Role">
          <Select
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
          >
            {ROLES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Hourly rate" hint="dollars">
          <Input
            inputMode="decimal"
            placeholder="0.00"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
          />
        </Field>
        <Field label="PIN" hint="4 digits">
          <Input
            inputMode="numeric"
            maxLength={4}
            placeholder="••••"
            value={pin}
            onChange={(event) =>
              setPin(event.target.value.replace(/\D/g, '').slice(0, 4))
            }
            className="tabular"
          />
        </Field>
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={pending}
          onClick={submit}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          Add person
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
