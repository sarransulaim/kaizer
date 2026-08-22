'use client'

import { cn } from '@/lib/utils'

/**
 * Segmented picker for short, mutually exclusive choices (channel, fulfillment
 * type). Chosen over a `<select>` because every option stays visible — one tap
 * instead of tap-scroll-tap, which matters when entering a stack of orders.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      className={cn(
        'bg-surface-raised ring-line grid gap-1 rounded-lg p-1 ring-1',
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-10 rounded-md px-2 text-sm font-medium transition',
              selected
                ? 'bg-accent text-accent-ink shadow-sm'
                : 'text-ink-muted hover:text-ink hover:bg-line/50',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
