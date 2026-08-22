import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/**
 * Status pill. The colour comes from the caller (see `lib/orders/status.ts`)
 * so a given status looks identical everywhere it appears.
 */
export function Badge({
  className,
  ...props
}: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset whitespace-nowrap',
        className,
      )}
      {...props}
    />
  )
}
