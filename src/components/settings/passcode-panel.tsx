'use client'

import { Check, KeyRound, Loader2 } from 'lucide-react'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { changePasscode } from '@/lib/auth/actions'

/**
 * Changing the office passcode.
 *
 * Asks for the current passcode and a secret key, because the passcode is
 * shared with whoever helps run the office: on its own it is not enough to
 * authorise replacing itself, or anyone who knows it could lock the owner out.
 * The key lives in the deployment environment and is not shared.
 */
export function PasscodePanel({ secretKeyConfigured }: { secretKeyConfigured: boolean }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const [current, setCurrent] = useState('')
  const [secret, setSecret] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')

  function reset() {
    setCurrent('')
    setSecret('')
    setNext('')
    setConfirm('')
    setError(null)
  }

  function submit() {
    setError(null)
    setDone(false)

    if (next !== confirm) {
      setError('The two new passcodes do not match')
      return
    }

    startTransition(async () => {
      const result = await changePasscode({
        currentPasscode: current,
        secretKey: secret,
        newPasscode: next,
      })

      if (!result.ok) {
        setError(result.error)
        return
      }

      reset()
      setOpen(false)
      setDone(true)
    })
  }

  if (done && !open) {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm text-emerald-400">
          <Check className="size-4" />
          Passcode changed. Use the new one next time you sign in.
        </p>
        <p className="text-ink-faint text-xs">
          Devices already signed in stay signed in. To turn those out too, change
          AUTH_SECRET in the Railway dashboard.
        </p>
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <KeyRound className="size-4" />
          Change it again
        </Button>
      </div>
    )
  }

  if (!open) {
    return (
      <div className="space-y-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <KeyRound className="size-4" />
          Change passcode
        </Button>
        {!secretKeyConfigured && (
          <p className="text-xs text-amber-400">
            No secret key is set on the server, so the passcode cannot be changed
            here yet. Set PASSCODE_SECRET_KEY in the Railway dashboard.
          </p>
        )}
      </div>
    )
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      className="space-y-3"
    >
      <Field label="Current passcode" required>
        <Input
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
        />
      </Field>

      <Field
        label="Secret key"
        required
        hint="not the passcode"
      >
        <Input
          type="password"
          autoComplete="off"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="New passcode" required hint="6+ characters">
          <Input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
        </Field>
        <Field label="Repeat it" required>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </Field>
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      <div className="flex gap-2">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={pending || !current || !secret || !next || !confirm}
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save new passcode
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            reset()
            setOpen(false)
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
