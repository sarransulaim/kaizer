'use client'

import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Loader2,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/field'
import {
  addVariant,
  createMenuItem,
  deleteMenuItem,
  deleteVariant,
  moveMenuItem,
  setMenuItemActive,
  updateMenuItem,
  updateVariant,
} from '@/lib/menu/actions'
import type { AdminMenuItem, AdminVariant } from '@/lib/menu/queries'
import { formatCentsCompact, parseDollarsToCents } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * The menu, editable in place.
 *
 * Everything here writes through a server action and then refreshes, so the
 * screen always shows what is actually in the database rather than an optimistic
 * guess. The menu is edited a handful of times a month — correctness is worth
 * more than the few hundred milliseconds an optimistic update would save.
 */

type Result = { ok: true } | { ok: false; error: string }

/** Cents to a dollars string an operator can edit: 16000 -> "160.00". */
/**
 * Shown in the empty recipe box. A worked example is a far better prompt than
 * an instruction — it sets the expected shape (quantities, then method) without
 * the interface having to explain itself.
 */
const RECIPE_PLACEHOLDER = `Serves one large tray

  4 kg basmati, soaked 45 min
  3 kg chicken thigh, bone-in
  1 kg fried onion
  500 g yoghurt

1. Marinate overnight with ginger-garlic, chilli, garam masala.
2. Parboil rice to 70%, drain.
3. Layer chicken, rice, saffron milk, fried onion.
4. Seal and dum on low for 45 min. Rest 20 min before opening.`

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2)
}

export function MenuEditor({ items }: { items: AdminMenuItem[] }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  return (
    <div className="space-y-3">
      {items.length === 0 && !adding && (
        <p className="text-ink-faint py-4 text-center text-sm">
          No menu items yet. Add the first one below.
        </p>
      )}

      {items.map((item, index) => (
        <ItemCard
          key={item.id}
          item={item}
          open={openId === item.id}
          onToggle={() => setOpenId((current) => (current === item.id ? null : item.id))}
          isFirst={index === 0}
          isLast={index === items.length - 1}
        />
      ))}

      {adding ? (
        <NewItemForm onClose={() => setAdding(false)} />
      ) : (
        <Button variant="secondary" full onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          Add an item
        </Button>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                                 Item card                                  */
/* -------------------------------------------------------------------------- */

function ItemCard({
  item,
  open,
  onToggle,
  isFirst,
  isLast,
}: {
  item: AdminMenuItem
  open: boolean
  onToggle: () => void
  isFirst: boolean
  isLast: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [addingSize, setAddingSize] = useState(false)

  const [name, setName] = useState(item.name)
  const [category, setCategory] = useState(item.category)
  const [lead, setLead] = useState(String(item.prepLeadHours))
  const [description, setDescription] = useState(item.description ?? '')
  const [recipe, setRecipe] = useState(item.recipe ?? '')

  const dirty =
    name !== item.name ||
    category !== item.category ||
    lead !== String(item.prepLeadHours) ||
    description !== (item.description ?? '') ||
    recipe !== (item.recipe ?? '')

  function run(action: () => Promise<Result>) {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setConfirmingDelete(false)
      router.refresh()
    })
  }

  function save() {
    const hours = Number(lead)
    if (!Number.isInteger(hours) || hours < 0) {
      setError('Lead time must be a whole number of hours')
      return
    }

    run(() =>
      updateMenuItem(item.id, {
        name,
        category,
        description: description.trim() || null,
        recipe: recipe.trim() || null,
        prepLeadHours: hours,
        active: item.active,
      }),
    )
  }

  const activeVariants = item.variants.filter((v) => v.active)

  return (
    <div
      className={cn(
        'rounded-card bg-surface ring-line/70 overflow-hidden ring-1',
        !item.active && 'opacity-60',
      )}
    >
      {/* -------------------------------- Head ------------------------------- */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="hover:bg-surface-raised/50 flex w-full items-center gap-3 px-3.5 py-3 text-left transition"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{item.name}</span>
            {!item.active && (
              <span className="bg-line/60 text-ink-faint shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem]">
                Off
              </span>
            )}
          </div>
          <div className="text-ink-faint mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
            <span>{item.prepLeadHours}h lead</span>
            <span>·</span>
            <span className={cn(item.recipe && 'text-emerald-400/80')}>
              {item.recipe ? 'Recipe' : 'No recipe'}
            </span>
            <span>·</span>
            <span>
              {activeVariants.length} size
              {activeVariants.length === 1 ? '' : 's'}
            </span>
            {activeVariants.length > 0 && (
              <>
                <span>·</span>
                <span className="tabular truncate">
                  {activeVariants
                    .map((v) => `${v.sizeLabel} ${formatCentsCompact(v.priceCents)}`)
                    .join(' · ')}
                </span>
              </>
            )}
          </div>
        </div>
        <ChevronDown
          className={cn(
            'text-ink-faint size-4 shrink-0 transition',
            open && 'rotate-180',
          )}
        />
      </button>

      {/* ------------------------------- Body -------------------------------- */}
      {open && (
        <div className="border-line/60 space-y-4 border-t px-3.5 py-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Category" hint="main, dessert, side">
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </Field>
            <Field
              label="Prep lead time"
              hint="hours before service"
              className="sm:col-span-2"
            >
              <Input
                inputMode="numeric"
                value={lead}
                onChange={(e) => setLead(e.target.value)}
              />
            </Field>
            <Field label="Description" hint="optional" className="sm:col-span-2">
              <Textarea
                className="min-h-16"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <Field
              label="Recipe"
              hint="shown on the kitchen display"
              className="sm:col-span-2"
            >
              <Textarea
                className="min-h-40 font-mono text-sm leading-relaxed"
                placeholder={RECIPE_PLACEHOLDER}
                value={recipe}
                onChange={(e) => setRecipe(e.target.value)}
              />
            </Field>
          </div>

          {dirty && (
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={save} disabled={pending}>
                {pending && <Loader2 className="size-3.5 animate-spin" />}
                Save changes
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setName(item.name)
                  setCategory(item.category)
                  setLead(String(item.prepLeadHours))
                  setDescription(item.description ?? '')
                  setRecipe(item.recipe ?? '')
                  setError(null)
                }}
              >
                Discard
              </Button>
            </div>
          )}

          {/* ------------------------------ Sizes ----------------------------- */}
          <div>
            <h3 className="text-ink-faint mb-2 text-xs font-semibold tracking-wider uppercase">
              Sizes and prices
            </h3>

            <div className="divide-line/50 divide-y">
              {item.variants.map((variant) => (
                <VariantRow key={variant.id} variant={variant} />
              ))}
            </div>

            {item.variants.length === 0 && !addingSize && (
              <p className="text-ink-faint py-2 text-xs">
                This item has no sizes yet, so it cannot be ordered.
              </p>
            )}

            {addingSize ? (
              <NewVariantForm
                itemId={item.id}
                onClose={() => setAddingSize(false)}
              />
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => setAddingSize(true)}
              >
                <Plus className="size-3.5" />
                Add a size
              </Button>
            )}
          </div>

          {/* ----------------------------- Actions ---------------------------- */}
          <div className="border-line/60 flex flex-wrap items-center gap-2 border-t pt-3">
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => run(() => setMenuItemActive(item.id, !item.active))}
            >
              {item.active ? 'Turn off' : 'Turn on'}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              aria-label="Move up"
              disabled={pending || isFirst}
              onClick={() => run(() => moveMenuItem(item.id, 'up'))}
            >
              <ArrowUp className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Move down"
              disabled={pending || isLast}
              onClick={() => run(() => moveMenuItem(item.id, 'down'))}
            >
              <ArrowDown className="size-4" />
            </Button>

            <div className="ml-auto flex items-center gap-2">
              {item.usageCount > 0 ? (
                <span className="text-ink-faint text-xs">
                  On {item.usageCount} order line
                  {item.usageCount === 1 ? '' : 's'}
                </span>
              ) : confirmingDelete ? (
                <>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={pending}
                    onClick={() => run(() => deleteMenuItem(item.id))}
                  >
                    {pending && <Loader2 className="size-3.5 animate-spin" />}
                    Delete for good
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete ${item.name}`}
                  disabled={pending}
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          </div>

          {error && <ErrorLine message={error} />}
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                                Variant row                                 */
/* -------------------------------------------------------------------------- */

function VariantRow({ variant }: { variant: AdminVariant }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const [sizeLabel, setSizeLabel] = useState(variant.sizeLabel)
  const [price, setPrice] = useState(centsToInput(variant.priceCents))
  const [serves, setServes] = useState(
    variant.servesCount ? String(variant.servesCount) : '',
  )

  const dirty =
    sizeLabel !== variant.sizeLabel ||
    price !== centsToInput(variant.priceCents) ||
    serves !== (variant.servesCount ? String(variant.servesCount) : '')

  function run(action: () => Promise<Result>) {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setConfirmingDelete(false)
      router.refresh()
    })
  }

  /** Saving and toggling both write the row, so they share one payload. */
  function payload(active: boolean) {
    const priceCents = parseDollarsToCents(price)
    if (priceCents === null) {
      setError('Enter a price like 160 or 14.50')
      return null
    }

    const servesCount = serves.trim() === '' ? null : Number(serves)
    if (servesCount !== null && !Number.isInteger(servesCount)) {
      setError('Serves must be a whole number')
      return null
    }

    return { sizeLabel, priceCents, servesCount, active }
  }

  function save(active = variant.active) {
    const values = payload(active)
    if (values) run(() => updateVariant(variant.id, values))
  }

  return (
    <div className="py-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Size" className="min-w-32 flex-1">
          <Input
            className="h-10"
            value={sizeLabel}
            onChange={(e) => setSizeLabel(e.target.value)}
          />
        </Field>
        <Field label="Price" className="w-24">
          <Input
            className="h-10"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
        <Field label="Serves" className="w-20">
          <Input
            className="h-10"
            inputMode="numeric"
            placeholder="—"
            value={serves}
            onChange={(e) => setServes(e.target.value)}
          />
        </Field>

        <div className="flex items-center gap-1.5 pb-0.5">
          {dirty ? (
            <Button
              variant="primary"
              size="sm"
              disabled={pending}
              onClick={() => save()}
            >
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              Save
            </Button>
          ) : (
            <Button
              variant={variant.active ? 'secondary' : 'outline'}
              size="sm"
              disabled={pending}
              onClick={() => save(!variant.active)}
            >
              {variant.active ? 'On' : 'Off'}
            </Button>
          )}

          {variant.usageCount === 0 &&
            (confirmingDelete ? (
              <Button
                variant="danger"
                size="sm"
                disabled={pending}
                onClick={() => run(() => deleteVariant(variant.id))}
              >
                Delete?
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Delete ${variant.sizeLabel}`}
                disabled={pending}
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            ))}
        </div>
      </div>

      {variant.usageCount > 0 && (
        <p className="text-ink-faint mt-1 text-[0.6875rem]">
          On {variant.usageCount} order line
          {variant.usageCount === 1 ? '' : 's'} — turn it off to retire it.
        </p>
      )}

      {error && <ErrorLine message={error} />}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                                 New forms                                  */
/* -------------------------------------------------------------------------- */

function NewVariantForm({
  itemId,
  onClose,
}: {
  itemId: string
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [sizeLabel, setSizeLabel] = useState('')
  const [price, setPrice] = useState('')
  const [serves, setServes] = useState('')

  function submit() {
    const priceCents = parseDollarsToCents(price)
    if (!sizeLabel.trim()) return setError('Give the size a name')
    if (priceCents === null) return setError('Enter a price like 160 or 14.50')

    setError(null)
    startTransition(async () => {
      const result = await addVariant(itemId, {
        sizeLabel,
        priceCents,
        servesCount: serves.trim() === '' ? null : Number(serves),
        active: true,
      })

      if (!result.ok) {
        setError(result.error)
        return
      }

      onClose()
      router.refresh()
    })
  }

  return (
    <div className="border-line/60 mt-2 border-t pt-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="New size" className="min-w-32 flex-1">
          <Input
            autoFocus
            className="h-10"
            placeholder="Large tray"
            value={sizeLabel}
            onChange={(e) => setSizeLabel(e.target.value)}
          />
        </Field>
        <Field label="Price" className="w-24">
          <Input
            className="h-10"
            inputMode="decimal"
            placeholder="160"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
        <Field label="Serves" className="w-20">
          <Input
            className="h-10"
            inputMode="numeric"
            placeholder="—"
            value={serves}
            onChange={(e) => setServes(e.target.value)}
          />
        </Field>
        <div className="flex items-center gap-1.5 pb-0.5">
          <Button variant="primary" size="sm" disabled={pending} onClick={submit}>
            {pending && <Loader2 className="size-3.5 animate-spin" />}
            Add
          </Button>
          <Button variant="ghost" size="sm" aria-label="Cancel" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
      </div>
      {error && <ErrorLine message={error} />}
    </div>
  )
}

function NewItemForm({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [category, setCategory] = useState('main')
  const [lead, setLead] = useState('12')
  const [recipe, setRecipe] = useState('')
  const [sizeLabel, setSizeLabel] = useState('')
  const [price, setPrice] = useState('')

  function submit() {
    const priceCents = parseDollarsToCents(price)
    const hours = Number(lead)

    if (!name.trim()) return setError('Name is required')
    if (!sizeLabel.trim()) return setError('Add at least one size')
    if (priceCents === null) return setError('Enter a price like 160 or 14.50')
    if (!Number.isInteger(hours) || hours < 0) {
      return setError('Lead time must be a whole number of hours')
    }

    setError(null)
    startTransition(async () => {
      const result = await createMenuItem({
        name,
        category: category.trim() || 'main',
        description: null,
        recipe: recipe.trim() || null,
        prepLeadHours: hours,
        active: true,
        variants: [{ sizeLabel, priceCents, servesCount: null, active: true }],
      })

      if (!result.ok) {
        setError(result.error)
        return
      }

      onClose()
      router.refresh()
    })
  }

  return (
    <div className="rounded-card bg-surface ring-accent/40 space-y-3 px-3.5 py-3.5 ring-1">
      <h3 className="text-ink-faint text-xs font-semibold tracking-wider uppercase">
        New item
      </h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required>
          <Input
            autoFocus
            placeholder="Chicken Biryani"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Category" hint="main, dessert, side">
          <Input value={category} onChange={(e) => setCategory(e.target.value)} />
        </Field>
        <Field label="First size" required hint="more can be added after">
          <Input
            placeholder="Large tray"
            value={sizeLabel}
            onChange={(e) => setSizeLabel(e.target.value)}
          />
        </Field>
        <Field label="Price" required>
          <Input
            inputMode="decimal"
            placeholder="160"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
        <Field label="Prep lead time" hint="hours before service">
          <Input
            inputMode="numeric"
            value={lead}
            onChange={(e) => setLead(e.target.value)}
          />
        </Field>
        <Field
          label="Recipe"
          hint="optional — shown on the kitchen display"
          className="sm:col-span-2"
        >
          <Textarea
            className="min-h-40 font-mono text-sm leading-relaxed"
            placeholder={RECIPE_PLACEHOLDER}
            value={recipe}
            onChange={(e) => setRecipe(e.target.value)}
          />
        </Field>
      </div>

      <div className="flex gap-2">
        <Button variant="primary" size="sm" disabled={pending} onClick={submit}>
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          Add item
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>

      {error && <ErrorLine message={error} />}
    </div>
  )
}

function ErrorLine({ message }: { message: string }) {
  return (
    <p className="mt-2 flex items-start gap-1.5 text-xs text-rose-400">
      <X className="mt-0.5 size-3 shrink-0" />
      {message}
    </p>
  )
}
