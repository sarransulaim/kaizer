import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Form controls are deliberately large. `text-base` (16px) on inputs is not a
 * style choice — iOS Safari zooms the viewport when focusing any field below
 * 16px, which is disorienting mid-order.
 */

const controlBase =
  'w-full rounded-lg bg-surface-raised px-3 text-base text-ink placeholder:text-ink-faint ' +
  'ring-1 ring-line focus:ring-2 focus:ring-accent focus:outline-none transition ' +
  'disabled:opacity-50'

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink-muted">
          {label}
          {required && <span className="text-accent"> *</span>}
        </span>
        {hint && <span className="text-xs text-ink-faint">{hint}</span>}
      </span>
      {children}
      {error && <span className="block text-xs text-rose-400">{error}</span>}
    </label>
  )
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(controlBase, 'h-12', className)} {...props} />
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(controlBase, 'h-12 appearance-none pr-9', className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23999'%3E%3Cpath d='M6 8l4 4 4-4'/%3E%3C/svg%3E\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 0.6rem center',
        backgroundSize: '1.25rem',
      }}
      {...props}
    />
  )
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(controlBase, 'py-3 min-h-24', className)} {...props} />
}
