import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/**
 * Sizes are set by touch target, not by text size — the primary consumers are
 * a phone held in one hand and a tablet operated with flour on the fingers.
 * `md` is 44px tall, the minimum comfortable iOS tap target.
 */
const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition ' +
    'disabled:pointer-events-none disabled:opacity-40 select-none active:scale-[0.98]',
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-accent-ink hover:bg-accent-strong shadow-sm shadow-black/30',
        secondary:
          'bg-surface-raised text-ink ring-1 ring-line hover:bg-line/60',
        ghost: 'text-ink-muted hover:bg-surface-raised hover:text-ink',
        danger: 'bg-rose-600/90 text-white hover:bg-rose-600',
        outline:
          'ring-1 ring-line-strong text-ink hover:bg-surface-raised',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-11 px-4 text-[0.9375rem]',
        lg: 'h-13 px-5 text-base',
        icon: 'h-11 w-11',
      },
      full: { true: 'w-full' },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

type ButtonProps = ComponentProps<'button'> & VariantProps<typeof button>

export function Button({ className, variant, size, full, ...props }: ButtonProps) {
  return (
    <button className={cn(button({ variant, size, full }), className)} {...props} />
  )
}

export { button as buttonStyles }
