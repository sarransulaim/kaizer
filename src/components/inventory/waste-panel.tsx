'use client'

import { Loader2, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { deleteWaste, logWaste } from '@/lib/inventory/actions'
import { parseQuantity, WASTE_REASON_LABELS } from '@/lib/inventory/units'
import { formatCents } from '@/lib/money'

export type WasteIngredient = {
  id: string
  name: string
  stockUnit: string
  lastCostCents: number
}

export type WasteRow = {
  id: string
  name: string
  quantityLabel: string
  costCents: number
  reason: string
  note: string | null
  dateLabel: string
}

/**
 * Logging what gets thrown away.
 *
 * Waste that is never written down still shows up — as a gap between what the
 * shelf says and what the recipes expected — but by then it is impossible to
 * tell spoilage from over-portioning or from stock walking out of the door.
 * Writing it down is what keeps that gap meaningful.
 */
export function WastePanel({
  ingredients,
  rows,
  today,
}: {
  ingredients: WasteIngredient[]
  rows: WasteRow[]
  today: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [ingredientId, setIngredientId] = useState(ingredients[0]?.id ?? '')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('spoiled')
  const [note, setNote] = useState('')

  const selected = ingredients.find((i) => i.id === ingredientId)
  const qtyMilli = parseQuantity(quantity)
  const estimate =
    selected && qtyMilli !== null
      ? Math.round((qtyMilli * selected.lastCostCents) / 1000)
      : null

  function submit() {
    setError(null)
    if (qtyMilli === null || qtyMilli <= 0) {
      setError('How much was thrown away?')
      return
    }

    startTransition(async () => {
      const result = await logWaste({
        ingredientId,
        quantityMilli: qtyMilli,
        reason: reason as never,
        note: note || undefined,
        wastedOn: today,
      })

      if (!result.ok) {
        setError(result.error)
        return
      }

      setQuantity('')
      setNote('')
      router.refresh()
    })
  }

  function remove(id: string) {
    startTransition(async () => {
      await deleteWaste(id)
      router.refresh()
    })
  }

  if (ingredients.length === 0) {
    return <p className="text-ink-faint text-sm">Add ingredients first.</p>
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
        className="rounded-card bg-surface ring-line/70 space-y-3 p-4 ring-1"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="What">
            <Select
              value={ingredientId}
              onChange={(e) => setIngredientId(e.target.value)}
            >
              {ingredients.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="How much" hint={selected?.stockUnit}>
            <Input
              inputMode="decimal"
              placeholder="2"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Why">
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              {Object.entries(WASTE_REASON_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Note" hint="optional">
            <Input
              placeholder="Left out overnight"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>

        {estimate !== null && estimate > 0 && (
          <p className="text-sm text-amber-400">
            That is about {formatCents(estimate)} of stock.
          </p>
        )}

        {error && <p className="text-sm text-rose-400">{error}</p>}

        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Log it
        </Button>
      </form>

      {rows.length > 0 && (
        <div className="rounded-card bg-surface ring-line/70 divide-line/50 divide-y ring-1">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <span className="block text-sm">
                  {row.quantityLabel} {row.name}
                </span>
                <span className="text-ink-faint block text-xs">
                  {WASTE_REASON_LABELS[row.reason] ?? row.reason} · {row.dateLabel}
                  {row.note && ` · ${row.note}`}
                </span>
              </div>
              <span className="tabular shrink-0 text-sm text-amber-400">
                {formatCents(row.costCents)}
              </span>
              <button
                type="button"
                aria-label={`Remove ${row.name} waste entry`}
                disabled={pending}
                onClick={() => remove(row.id)}
                className="text-ink-faint flex size-9 shrink-0 items-center justify-center rounded-lg transition hover:text-rose-400"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
