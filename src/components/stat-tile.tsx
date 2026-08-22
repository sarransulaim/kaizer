import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Compact metric. Value first and largest — these are scanned at a glance
 * mid-service, not studied.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  hint?: string
  tone?: 'default' | 'warning' | 'positive'
}) {
  return (
    <div className="rounded-card bg-surface ring-line/70 px-3 py-2.5 ring-1">
      <div
        className={cn(
          'tabular text-xl leading-tight font-semibold',
          tone === 'warning' && 'text-amber-400',
          tone === 'positive' && 'text-emerald-400',
        )}
      >
        {value}
      </div>
      <div className="text-ink-faint mt-0.5 text-[0.6875rem] tracking-wide uppercase">
        {label}
      </div>
      {hint && <div className="text-ink-faint mt-0.5 text-[0.6875rem]">{hint}</div>}
    </div>
  )
}
