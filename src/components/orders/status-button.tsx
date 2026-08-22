'use client'

import { Check, Loader2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import type { FulfillmentType, OrderStatus } from '@/lib/db/schema'
import { updateOrderStatus } from '@/lib/orders/actions'
import { advanceLabel, nextStatus } from '@/lib/orders/status'

/**
 * The one-tap control on every order card. Deliberately the largest target on
 * the card — advancing an order is the action performed dozens of times a
 * service, usually one-handed.
 */
export function StatusButton({
  orderId,
  status,
  fulfillmentType,
  size = 'md',
}: {
  orderId: string
  status: OrderStatus
  fulfillmentType: FulfillmentType
  size?: 'sm' | 'md' | 'lg'
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const next = nextStatus(status, fulfillmentType)
  if (!next) return null

  function advance() {
    setError(null)
    startTransition(async () => {
      const result = await updateOrderStatus(orderId, next!)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col items-stretch gap-1">
      <Button
        variant="primary"
        size={size}
        onClick={advance}
        disabled={pending}
        className="min-w-28"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Check className="size-4" />
        )}
        {advanceLabel(status, fulfillmentType)}
      </Button>
      {error && (
        <span className="flex items-center gap-1 text-xs text-rose-400">
          <X className="size-3" />
          {error}
        </span>
      )}
    </div>
  )
}
