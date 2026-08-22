'use client'

import { Loader2, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { updateOrderStatus } from '@/lib/orders/actions'

/**
 * Two-step by design. Cancelling is the one destructive action on the order
 * screen, and it sits next to the buttons used constantly during service.
 */
export function CancelButton({ orderId }: { orderId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function cancel() {
    setError(null)
    startTransition(async () => {
      const result = await updateOrderStatus(orderId, 'cancelled')
      if (!result.ok) {
        setError(result.error)
        setConfirming(false)
        return
      }
      router.refresh()
    })
  }

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        <XCircle className="size-4" />
        Cancel order
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Button variant="danger" size="sm" onClick={cancel} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Yes, cancel it
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Keep
        </Button>
      </div>
      {error && <span className="text-xs text-rose-400">{error}</span>}
    </div>
  )
}
