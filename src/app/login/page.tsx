import { Suspense } from 'react'

import { LoginForm } from '@/components/login-form'
import { BUSINESS } from '@/lib/config'

export const metadata = { title: 'Sign in' }

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-xs">
        <div className="mb-8 text-center">
          <div className="text-2xl font-semibold tracking-tight">{BUSINESS.name}</div>
          <p className="text-ink-faint mt-1 text-sm">{BUSINESS.tagline}</p>
        </div>

        {/* The form reads `?next=` to return you to whatever you were opening,
            which opts it out of prerendering unless it sits behind a boundary.
            The fallback matches the form's height so the card does not jump. */}
        <Suspense fallback={<div className="h-[8.75rem]" />}>
          <LoginForm />
        </Suspense>

        <p className="text-ink-faint mt-8 text-center text-xs leading-relaxed">
          Kitchen staff don&apos;t need this. The order board and time clock are
          at <span className="text-ink-muted">/kitchen</span>.
        </p>
      </div>
    </div>
  )
}
