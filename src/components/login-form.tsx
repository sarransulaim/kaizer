'use client'

import { Loader2, Lock } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { signIn } from '@/lib/auth/actions'

export function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  const [passcode, setPasscode] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(null)

    startTransition(async () => {
      const result = await signIn(passcode)

      if (!result.ok) {
        setError(result.error)
        setPasscode('')
        return
      }

      /* `next` comes from the middleware redirect. Only same-site paths are
         followed, so a crafted link cannot bounce someone off to another host
         after they have typed the passcode. */
      const next = params.get('next')
      const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/'

      router.replace(target)
      router.refresh()
    })
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      className="space-y-4"
    >
      <Field label="Passcode" error={error ?? undefined}>
        <Input
          type="password"
          inputMode="text"
          autoComplete="current-password"
          autoFocus
          placeholder="••••••••"
          value={passcode}
          onChange={(event) => setPasscode(event.target.value)}
        />
      </Field>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        full
        disabled={pending || passcode.length === 0}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
        Unlock
      </Button>
    </form>
  )
}
