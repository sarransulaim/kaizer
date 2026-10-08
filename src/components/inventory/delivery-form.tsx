'use client'

import { Loader2, Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { logPurchase } from '@/lib/inventory/actions'
import { formatQuantity, parseQuantity, purchaseToStock } from '@/lib/inventory/units'
import { formatCents, formatCentsCompact, parseDollarsToCents } from '@/lib/money'

export type PickerIngredient = {
  id: string
  name: string
  stockUnit: string
  purchaseUnit: string
  stockPerPurchaseMilli: number
  lastCostCents: number
}

type Line = { key: string; ingredientId: string; qty: string; cost: string }

let lineCounter = 0
const nextKey = () => `line-${(lineCounter += 1)}`

/**
 * Entering a delivery the way the invoice reads: supplier, date, then a line
 * per item in the units the supplier sells in.
 *
 * Each line shows what it becomes in stock units and what that makes the cost
 * per unit, so a 40lb case entered as 40 cases is caught while it is still on
 * screen — not a month later when the food cost looks impossible.
 */
export function DeliveryForm({
  ingredients,
  today,
}: {
  ingredients: PickerIngredient[]
  today: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [supplier, setSupplier] = useState('Restaurant Depot')
  const [purchasedOn, setPurchasedOn] = useState(today)
  const [reference, setReference] = useState('')
  const [lines, setLines] = useState<Line[]>([])

  const byId = useMemo(
    () => new Map(ingredients.map((i) => [i.id, i])),
    [ingredients],
  )

  function addLine() {
    setLines((current) => [
      ...current,
      { key: nextKey(), ingredientId: ingredients[0]?.id ?? '', qty: '', cost: '' },
    ])
  }

  function patch(key: string, change: Partial<Line>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...change } : line)),
    )
  }

  const resolved = lines.map((line) => {
    const ingredient = byId.get(line.ingredientId)
    const qtyMilli = parseQuantity(line.qty)
    const costCents = parseDollarsToCents(line.cost)

    const stockMilli =
      ingredient && qtyMilli !== null
        ? purchaseToStock(qtyMilli, ingredient.stockPerPurchaseMilli)
        : null

    const perStockUnit =
      ingredient && costCents !== null && ingredient.stockPerPurchaseMilli > 0
        ? Math.round((costCents * 1000) / ingredient.stockPerPurchaseMilli)
        : null

    const lineTotal =
      qtyMilli !== null && costCents !== null
        ? Math.round((qtyMilli * costCents) / 1000)
        : null

    return { line, ingredient, qtyMilli, costCents, stockMilli, perStockUnit, lineTotal }
  })

  const total = resolved.reduce((sum, r) => sum + (r.lineTotal ?? 0), 0)
  const ready =
    lines.length > 0 &&
    resolved.every((r) => r.ingredient && r.qtyMilli !== null && r.qtyMilli > 0 && r.costCents !== null)

  function submit() {
    setError(null)

    startTransition(async () => {
      const result = await logPurchase({
        supplier,
        purchasedOn,
        reference: reference || undefined,
        lines: resolved.map((r) => ({
          ingredientId: r.line.ingredientId,
          quantityMilli: r.qtyMilli!,
          unitCostCents: r.costCents!,
        })),
      })

      if (!result.ok) {
        setError(result.error)
        return
      }

      setLines([])
      setReference('')
      setOpen(false)
      router.refresh()
    })
  }

  if (ingredients.length === 0) {
    return (
      <p className="text-ink-faint text-sm">
        Add an ingredient first — a delivery has to be of something.
      </p>
    )
  }

  if (!open) {
    return (
      <Button type="button" variant="primary" size="sm" onClick={() => { setOpen(true); addLine() }}>
        <Plus className="size-4" />
        Log a delivery
      </Button>
    )
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      className="rounded-card bg-surface ring-line/70 space-y-3 p-4 ring-1"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Supplier" required>
          <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </Field>
        <Field label="Date" required>
          <Input
            type="date"
            max={today}
            value={purchasedOn}
            onChange={(e) => setPurchasedOn(e.target.value)}
          />
        </Field>
        <Field label="Invoice no." hint="optional">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>

      <div className="divide-line/50 border-line/60 divide-y rounded-lg border">
        {resolved.map(({ line, ingredient, stockMilli, perStockUnit, lineTotal }) => (
          <div key={line.key} className="space-y-2 p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <Select
                  aria-label="Ingredient"
                  value={line.ingredientId}
                  onChange={(e) => patch(line.key, { ingredientId: e.target.value })}
                >
                  {ingredients.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </Select>
              </div>
              <button
                type="button"
                aria-label="Remove line"
                onClick={() =>
                  setLines((current) => current.filter((l) => l.key !== line.key))
                }
                className="text-ink-faint mt-1 flex size-10 shrink-0 items-center justify-center rounded-lg transition hover:text-rose-400"
              >
                <Trash2 className="size-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label={`How many ${ingredient?.purchaseUnit ?? 'units'}`}>
                <Input
                  inputMode="decimal"
                  placeholder="2"
                  value={line.qty}
                  onChange={(e) => patch(line.key, { qty: e.target.value })}
                />
              </Field>
              <Field label={`Cost per ${ingredient?.purchaseUnit ?? 'unit'}`}>
                <Input
                  inputMode="decimal"
                  placeholder="52.00"
                  value={line.cost}
                  onChange={(e) => patch(line.key, { cost: e.target.value })}
                />
              </Field>
            </div>

            {ingredient && (stockMilli !== null || perStockUnit !== null) && (
              <p className="text-ink-faint text-xs">
                {stockMilli !== null &&
                  `${formatQuantity(stockMilli)} ${ingredient.stockUnit} received`}
                {perStockUnit !== null &&
                  ` · ${formatCentsCompact(perStockUnit)} per ${ingredient.stockUnit}`}
                {lineTotal !== null && ` · ${formatCents(lineTotal)}`}
              </p>
            )}
          </div>
        ))}

        <div className="p-3">
          <button
            type="button"
            onClick={addLine}
            className="text-ink-muted hover:text-ink flex items-center gap-1.5 text-sm font-medium transition"
          >
            <Plus className="size-4" />
            Another line
          </button>
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <span className="text-ink-muted text-sm">Delivery total</span>
        <span className="tabular text-lg font-semibold">{formatCents(total)}</span>
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending || !ready}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save delivery
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
