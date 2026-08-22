'use client'

import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import type { PaymentMethod } from '@/lib/db/schema'
import { formatCentsCompact, parseDollarsToCents } from '@/lib/money'
import { updatePayment } from '@/lib/orders/actions'

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'zelle', label: 'Zelle' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'venmo', label: 'Venmo' },
  { value: 'other', label: 'Other' },
]

export function PaymentPanel({
  orderId,
  totalCents,
  amountPaidCents,
  paymentMethod,
  paymentRef,
}: {
  orderId: string
  totalCents: number
  amountPaidCents: number
  paymentMethod: PaymentMethod | null
  paymentRef: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [amount, setAmount] = useState(
    amountPaidCents > 0 ? (amountPaidCents / 100).toFixed(2) : '',
  )
  const [method, setMethod] = useState<PaymentMethod | ''>(paymentMethod ?? '')
  const [reference, setReference] = useState(paymentRef ?? '')

  const outstanding = totalCents - amountPaidCents

  function save(overrideCents?: number) {
    setError(null)
    const cents = overrideCents ?? parseDollarsToCents(amount) ?? 0

    startTransition(async () => {
      const result = await updatePayment({
        orderId,
        amountPaidCents: cents,
        paymentMethod: method || undefined,
        paymentRef: reference || undefined,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setAmount((cents / 100).toFixed(2))
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      {outstanding > 0 && (
        <Button
          type="button"
          variant="primary"
          full
          disabled={pending}
          onClick={() => {
            setAmount((totalCents / 100).toFixed(2))
            save(totalCents)
          }}
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          Mark paid in full · {formatCentsCompact(outstanding)} due
        </Button>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount received">
          <Input
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Method">
          <Select
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
          >
            <option value="">—</option>
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {method === 'zelle' && (
        <Field label="Zelle sent from">
          <Input
            placeholder="Name / phone on the transfer"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </Field>
      )}

      {error && <p className="text-xs text-rose-400">{error}</p>}

      <Button type="button" variant="secondary" full disabled={pending} onClick={() => save()}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Update payment
      </Button>
    </div>
  )
}
