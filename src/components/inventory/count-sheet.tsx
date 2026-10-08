'use client'

import { ClipboardList, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { saveCount } from '@/lib/inventory/actions'
import { CATEGORY_LABELS, formatQuantity, parseQuantity } from '@/lib/inventory/units'
import { parseDollarsToCents } from '@/lib/money'

export type CountableIngredient = {
  id: string
  name: string
  category: string
  stockUnit: string
  /** What the app believes is there, to compare against the shelf. */
  onHandMilli: number
}

/**
 * The stocktake.
 *
 * This is the only moment the numbers meet reality, so the sheet shows what the
 * app expected beside each blank — not to lead the count, but because a wild
 * difference usually means a delivery went unlogged, and that is worth noticing
 * while standing in front of the shelf rather than a week later.
 *
 * Takings for the period are asked for here too: they are the other half of a
 * food cost percentage, and the person counting is the person who can read them
 * off the Square report.
 */
export function CountSheet({
  ingredients,
  today,
}: {
  ingredients: CountableIngredient[]
  today: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [countedOn, setCountedOn] = useState(today)
  const [sales, setSales] = useState('')
  const [quantities, setQuantities] = useState<Record<string, string>>({})

  function submit() {
    setError(null)

    const lines = ingredients
      .map((item) => ({
        ingredientId: item.id,
        quantityMilli: parseQuantity(quantities[item.id] ?? ''),
      }))
      .filter((line) => line.quantityMilli !== null)
      .map((line) => ({
        ingredientId: line.ingredientId,
        quantityMilli: line.quantityMilli!,
      }))

    if (lines.length === 0) {
      setError('Enter at least one count')
      return
    }

    startTransition(async () => {
      const result = await saveCount({
        countedOn,
        salesSinceLastCents: parseDollarsToCents(sales),
        lines,
      })

      if (!result.ok) {
        setError(result.error)
        return
      }

      setQuantities({})
      setSales('')
      setOpen(false)
      router.refresh()
    })
  }

  if (ingredients.length === 0) {
    return (
      <p className="text-ink-faint text-sm">
        Add ingredients before counting them.
      </p>
    )
  }

  if (!open) {
    return (
      <Button type="button" variant="primary" size="sm" onClick={() => setOpen(true)}>
        <ClipboardList className="size-4" />
        Start a stocktake
      </Button>
    )
  }

  const grouped = ingredients.reduce<Record<string, CountableIngredient[]>>(
    (acc, item) => {
      ;(acc[item.category] ||= []).push(item)
      return acc
    },
    {},
  )

  const entered = Object.values(quantities).filter((v) => v.trim() !== '').length

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      className="rounded-card bg-surface ring-line/70 space-y-4 p-4 ring-1"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Counted on" required>
          <Input
            type="date"
            max={today}
            value={countedOn}
            onChange={(e) => setCountedOn(e.target.value)}
          />
        </Field>
        <Field label="Takings since the last count" hint="from Square">
          <Input
            inputMode="decimal"
            placeholder="0.00"
            value={sales}
            onChange={(e) => setSales(e.target.value)}
          />
        </Field>
      </div>

      <div className="space-y-4">
        {Object.entries(grouped).map(([category, items]) => (
          <div key={category}>
            <h4 className="text-ink-faint mb-1.5 text-xs font-semibold tracking-wider uppercase">
              {CATEGORY_LABELS[category] ?? category}
            </h4>
            <div className="divide-line/50 border-line/60 divide-y rounded-lg border">
              {items.map((item) => (
                <div key={item.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 text-sm">
                    {item.name}
                    <span className="text-ink-faint block text-xs">
                      expected {formatQuantity(item.onHandMilli)} {item.stockUnit}
                    </span>
                  </span>
                  <Input
                    aria-label={`Counted ${item.name}`}
                    inputMode="decimal"
                    placeholder="—"
                    value={quantities[item.id] ?? ''}
                    onChange={(e) =>
                      setQuantities((current) => ({
                        ...current,
                        [item.id]: e.target.value,
                      }))
                    }
                    className="tabular h-10 w-24 shrink-0 text-center"
                  />
                  <span className="text-ink-faint w-8 shrink-0 text-xs">
                    {item.stockUnit}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending || entered === 0}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save count
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <span className="text-ink-faint text-xs">
          {entered} of {ingredients.length} entered — blanks are left out
        </span>
      </div>
    </form>
  )
}
