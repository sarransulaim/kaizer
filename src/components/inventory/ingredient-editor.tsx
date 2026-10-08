'use client'

import { ChevronDown, Loader2, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { saveIngredient, setIngredientActive } from '@/lib/inventory/actions'
import {
  CATEGORY_LABELS,
  formatQuantity,
  parseQuantity,
  PURCHASE_UNITS,
  STOCK_UNITS,
} from '@/lib/inventory/units'
import { formatCentsCompact, parseDollarsToCents } from '@/lib/money'
import { cn } from '@/lib/utils'

export type IngredientRow = {
  id: string
  name: string
  category: string
  stockUnit: string
  purchaseUnit: string
  stockPerPurchaseMilli: number
  parLevelMilli: number
  lastCostCents: number
  supplier: string | null
  notes: string | null
  active: boolean
}

type Draft = {
  id?: string
  name: string
  category: string
  stockUnit: string
  purchaseUnit: string
  /** How many stock units in one purchase unit, as typed. */
  perPurchase: string
  parLevel: string
  cost: string
  supplier: string
}

function draftFrom(row?: IngredientRow): Draft {
  return {
    id: row?.id,
    name: row?.name ?? '',
    category: row?.category ?? 'other',
    stockUnit: row?.stockUnit ?? 'kg',
    purchaseUnit: row?.purchaseUnit ?? 'case',
    perPurchase: row ? formatQuantity(row.stockPerPurchaseMilli) : '',
    parLevel: row && row.parLevelMilli > 0 ? formatQuantity(row.parLevelMilli) : '',
    cost: row && row.lastCostCents > 0 ? (row.lastCostCents / 100).toFixed(2) : '',
    supplier: row?.supplier ?? '',
  }
}

/**
 * The ingredient list, and the form for adding to it.
 *
 * The two units are the thing this form exists to capture. Restaurant Depot
 * sells a 40lb case and the kitchen counts in pounds, so the form asks for both
 * and for what connects them — and shows the resulting cost per pound back, so
 * a mistyped pack size is visible immediately rather than quietly skewing every
 * valuation afterwards.
 */
export function IngredientEditor({ rows }: { rows: IngredientRow[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  function submit() {
    if (!draft) return
    setError(null)
    setFieldErrors({})

    const perPurchase = parseQuantity(draft.perPurchase)
    if (perPurchase === null || perPurchase < 1) {
      setFieldErrors({ stockPerPurchaseMilli: 'How much is in one?' })
      return
    }

    startTransition(async () => {
      const result = await saveIngredient({
        id: draft.id,
        name: draft.name,
        category: draft.category as never,
        stockUnit: draft.stockUnit,
        purchaseUnit: draft.purchaseUnit,
        stockPerPurchaseMilli: perPurchase,
        parLevelMilli: parseQuantity(draft.parLevel) ?? 0,
        lastCostCents: parseDollarsToCents(draft.cost) ?? 0,
        supplier: draft.supplier || undefined,
      })

      if (!result.ok) {
        setError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        return
      }

      setDraft(null)
      router.refresh()
    })
  }

  function toggle(row: IngredientRow) {
    startTransition(async () => {
      await setIngredientActive(row.id, !row.active)
      router.refresh()
    })
  }

  /* Cost per stock unit, shown live so a wrong pack size is obvious. */
  const perPurchaseMilli = draft ? parseQuantity(draft.perPurchase) : null
  const costCents = draft ? parseDollarsToCents(draft.cost) : null
  const derivedPerUnit =
    perPurchaseMilli && perPurchaseMilli > 0 && costCents
      ? Math.round((costCents * 1000) / perPurchaseMilli)
      : null

  return (
    <div className="space-y-4">
      {draft ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
          className="rounded-card bg-surface ring-line/70 space-y-3 p-4 ring-1"
        >
          <h3 className="text-ink-muted text-xs font-semibold tracking-wider uppercase">
            {draft.id ? 'Edit ingredient' : 'New ingredient'}
          </h3>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required error={fieldErrors.name}>
              <Input
                placeholder="Basmati rice"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label="Category">
              <Select
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              >
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="border-line/60 space-y-3 rounded-lg border p-3">
            <p className="text-ink-faint text-xs">
              How you buy it, and how you count it.
            </p>

            <div className="grid grid-cols-3 gap-2">
              <Field label="Bought as">
                <Select
                  value={draft.purchaseUnit}
                  onChange={(e) => setDraft({ ...draft, purchaseUnit: e.target.value })}
                >
                  {PURCHASE_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Holds"
                required
                error={fieldErrors.stockPerPurchaseMilli}
              >
                <Input
                  inputMode="decimal"
                  placeholder="40"
                  value={draft.perPurchase}
                  onChange={(e) => setDraft({ ...draft, perPurchase: e.target.value })}
                />
              </Field>
              <Field label="Counted in">
                <Select
                  value={draft.stockUnit}
                  onChange={(e) => setDraft({ ...draft, stockUnit: e.target.value })}
                >
                  {STOCK_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <p className="text-ink-faint text-xs">
              One {draft.purchaseUnit} holds{' '}
              {draft.perPurchase || '—'} {draft.stockUnit}.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={`Cost per ${draft.purchaseUnit}`} hint="optional">
              <Input
                inputMode="decimal"
                placeholder="52.00"
                value={draft.cost}
                onChange={(e) => setDraft({ ...draft, cost: e.target.value })}
              />
            </Field>
            <Field label={`Keep at least`} hint={`in ${draft.stockUnit}`}>
              <Input
                inputMode="decimal"
                placeholder="20"
                value={draft.parLevel}
                onChange={(e) => setDraft({ ...draft, parLevel: e.target.value })}
              />
            </Field>
            <Field label="Supplier" hint="optional">
              <Input
                placeholder="Restaurant Depot"
                value={draft.supplier}
                onChange={(e) => setDraft({ ...draft, supplier: e.target.value })}
              />
            </Field>
          </div>

          {derivedPerUnit !== null && (
            <p className="text-sm text-emerald-400">
              That works out to {formatCentsCompact(derivedPerUnit)} per{' '}
              {draft.stockUnit}.
            </p>
          )}

          {error && <p className="text-sm text-rose-400">{error}</p>}

          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {draft.id ? 'Save changes' : 'Add ingredient'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDraft(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setDraft(draftFrom())}
        >
          <Plus className="size-4" />
          Add an ingredient
        </Button>
      )}

      {rows.length > 0 && (
        <div className="rounded-card bg-surface ring-line/70 divide-line/50 divide-y ring-1">
          {rows.map((row) => (
            <div
              key={row.id}
              className={cn(
                'flex items-center justify-between gap-3 px-4 py-2.5',
                !row.active && 'opacity-50',
              )}
            >
              <button
                type="button"
                onClick={() => setDraft(draftFrom(row))}
                className="hover:text-accent min-w-0 flex-1 text-left transition"
              >
                <span className="block text-sm font-medium">{row.name}</span>
                <span className="text-ink-faint block text-xs">
                  {CATEGORY_LABELS[row.category]} · 1 {row.purchaseUnit} ={' '}
                  {formatQuantity(row.stockPerPurchaseMilli)} {row.stockUnit}
                  {row.lastCostCents > 0 &&
                    ` · ${formatCentsCompact(row.lastCostCents)}/${row.stockUnit}`}
                </span>
              </button>

              <div className="flex shrink-0 items-center gap-2">
                <ChevronDown className="text-ink-faint size-4 -rotate-90" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => toggle(row)}
                >
                  {row.active ? 'Turn off' : 'Turn on'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
