'use client'

import { Loader2, Minus, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import type { FulfillmentType, OrderChannel } from '@/lib/db/schema'
import { formatCents, formatCentsCompact, parseDollarsToCents } from '@/lib/money'
import { deleteOrder, updateOrderDetails, updateOrderItems } from '@/lib/orders/actions'
import type { MenuWithVariants } from '@/lib/orders/queries'

const CHANNELS: { value: OrderChannel; label: string }[] = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'google_form', label: 'Form' },
  { value: 'phone', label: 'Phone' },
  { value: 'walk_in', label: 'Walk-in' },
]

const FULFILLMENT: { value: FulfillmentType; label: string }[] = [
  { value: 'pickup', label: 'Pickup' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'dine_in', label: 'Dine-in' },
]

/* -------------------------------------------------------------------------- */
/*                               Order details                                */
/* -------------------------------------------------------------------------- */

export type OrderDetailsValues = {
  orderId: string
  customerName: string
  phone: string
  channel: OrderChannel
  fulfillmentType: FulfillmentType
  serviceDate: string
  serviceTime: string
  deliveryAddress: string
  notes: string
  customerNotes: string
}

/**
 * Editing the parts of an order that are not money.
 *
 * Orders arrive over WhatsApp and change over WhatsApp. Before this the only
 * way to move a pickup to 7pm was to cancel and re-take it, which cost the
 * order its number and its history.
 */
export function EditOrderDetails({ order }: { order: OrderDetailsValues }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const [values, setValues] = useState(order)
  const set = <K extends keyof OrderDetailsValues>(
    key: K,
    value: OrderDetailsValues[K],
  ) => setValues((current) => ({ ...current, [key]: value }))

  function save() {
    setError(null)
    setFieldErrors({})

    startTransition(async () => {
      const result = await updateOrderDetails({
        orderId: values.orderId,
        customerName: values.customerName,
        phone: values.phone,
        channel: values.channel,
        fulfillmentType: values.fulfillmentType,
        serviceDate: values.serviceDate,
        serviceTime: values.serviceTime,
        deliveryAddress: values.deliveryAddress || undefined,
        notes: values.notes || undefined,
        customerNotes: values.customerNotes || undefined,
      })

      if (!result.ok) {
        setError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        return
      }

      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="size-4" />
        Edit details
      </Button>
    )
  }

  return (
    <div className="border-line/60 mt-3 space-y-3 border-t pt-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" required error={fieldErrors.customerName}>
          <Input
            value={values.customerName}
            onChange={(e) => set('customerName', e.target.value)}
          />
        </Field>
        <Field label="Phone" required error={fieldErrors.phone}>
          <Input value={values.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" required error={fieldErrors.serviceDate}>
          <Input
            type="date"
            value={values.serviceDate}
            onChange={(e) => set('serviceDate', e.target.value)}
          />
        </Field>
        <Field label="Time" required error={fieldErrors.serviceTime}>
          <Input
            type="time"
            value={values.serviceTime}
            onChange={(e) => set('serviceTime', e.target.value)}
          />
        </Field>
      </div>

      <Field label="Fulfillment">
        <Segmented
          options={FULFILLMENT}
          value={values.fulfillmentType}
          onChange={(value) => set('fulfillmentType', value)}
        />
      </Field>

      {values.fulfillmentType === 'delivery' && (
        <Field label="Delivery address" required error={fieldErrors.deliveryAddress}>
          <Textarea
            value={values.deliveryAddress}
            onChange={(e) => set('deliveryAddress', e.target.value)}
          />
        </Field>
      )}

      <Field label="Came in via">
        <Select
          value={values.channel}
          onChange={(e) => set('channel', e.target.value as OrderChannel)}
        >
          {CHANNELS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Customer request" hint="in their words">
        <Textarea
          value={values.customerNotes}
          onChange={(e) => set('customerNotes', e.target.value)}
        />
      </Field>

      <Field label="Kitchen note" hint="shown on the prep display">
        <Textarea value={values.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      <div className="flex gap-2">
        <Button type="button" variant="primary" disabled={pending} onClick={save}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save details
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setValues(order)
            setError(null)
            setFieldErrors({})
            setOpen(false)
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                                   Items                                    */
/* -------------------------------------------------------------------------- */

export type EditableLine = {
  variantId: string | null
  itemName: string
  sizeLabel: string
  unitPriceCents: number
  quantity: number
}

type Line = {
  key: string
  kind: 'menu' | 'custom'
  variantId: string | null
  name: string
  sizeLabel: string
  /** The menu price for a menu line; for a custom line, whatever was typed. */
  listCents: number
  price: string
  quantity: number
}

let lineCounter = 0
const nextKey = () => `line-${(lineCounter += 1)}`

/**
 * Editing what is actually on the order.
 *
 * A line item always stores the menu price; anything knocked off is held once,
 * on the order, as a discount. That is what lets the total read "160 − 20"
 * and what keeps analytics crediting an item at list price.
 *
 * So this editor exposes the discount as the single figure it actually is,
 * seeded with whatever the order already carries. Offering a price box per
 * menu line instead would have been a trap: the stored line price is the menu
 * price, so reopening an order and saving would have quietly reset an existing
 * discount to zero. Custom lines are different — they have no menu price to be
 * discounted from, so what is typed on them is simply what is charged.
 */
export function EditOrderItems({
  orderId,
  lines: initial,
  discountCents,
  menu,
}: {
  orderId: string
  lines: EditableLine[]
  discountCents: number
  menu: MenuWithVariants
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const toLines = (): Line[] =>
    initial.map((line) => ({
      key: nextKey(),
      kind: line.variantId ? 'menu' : 'custom',
      variantId: line.variantId,
      name: line.itemName,
      sizeLabel: line.sizeLabel,
      listCents: line.unitPriceCents,
      price: (line.unitPriceCents / 100).toFixed(2),
      quantity: line.quantity,
    }))

  const [lines, setLines] = useState<Line[]>(toLines)
  const [discount, setDiscount] = useState(
    discountCents > 0 ? (discountCents / 100).toFixed(2) : '',
  )

  const menuPrice = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of menu) {
      for (const variant of item.variants) map.set(variant.id, variant.priceCents)
    }
    return map
  }, [menu])

  const pricing = useMemo(() => {
    let subtotal = 0
    let invalid = false

    for (const line of lines) {
      if (line.kind === 'menu') {
        subtotal +=
          (menuPrice.get(line.variantId!) ?? line.listCents) * line.quantity
        continue
      }

      const parsed = parseDollarsToCents(line.price)
      if (parsed === null || line.name.trim() === '') {
        invalid = true
        continue
      }
      subtotal += parsed * line.quantity
    }

    const typedDiscount = discount.trim() === '' ? 0 : parseDollarsToCents(discount)
    const discountInvalid = typedDiscount === null
    /* Never more than the order is worth: a discount larger than the subtotal
       would make the total negative. */
    const discountCentsValue = Math.min(typedDiscount ?? 0, subtotal)

    return {
      subtotalCents: subtotal,
      discountCents: discountCentsValue,
      totalCents: subtotal - discountCentsValue,
      invalid: invalid || discountInvalid,
      empty: lines.length === 0,
    }
  }, [lines, menuPrice, discount])

  const update = (key: string, patch: Partial<Line>) =>
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    )

  function save() {
    setError(null)

    startTransition(async () => {
      const result = await updateOrderItems({
        orderId,
        discountCents: pricing.discountCents,
        items: lines.map((line) =>
          line.kind === 'menu'
            ? { variantId: line.variantId!, quantity: line.quantity }
            : {
                name: line.name.trim(),
                priceCents: parseDollarsToCents(line.price) ?? 0,
                quantity: line.quantity,
              },
        ),
      })

      if (!result.ok) {
        setError(result.error)
        /* A refund notice still means the change was saved. */
        router.refresh()
        return
      }

      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          setLines(toLines())
          setOpen(true)
        }}
      >
        <Pencil className="size-4" />
        Edit items
      </Button>
    )
  }

  return (
    <div className="border-line/60 mt-3 space-y-3 border-t pt-3">
      <ul className="divide-line/50 divide-y">
        {lines.map((line) => (
          <li key={line.key} className="space-y-2 py-3">
            <div className="flex items-center gap-2">
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label={`Remove one ${line.name}`}
                  disabled={line.quantity <= 1}
                  onClick={() => update(line.key, { quantity: line.quantity - 1 })}
                  className="bg-surface-raised ring-line text-ink-muted hover:text-ink flex size-7 items-center justify-center rounded-md ring-1 transition disabled:opacity-30"
                >
                  <Minus className="size-3.5" />
                </button>
                <span className="tabular text-accent w-5 text-center text-sm font-semibold">
                  {line.quantity}
                </span>
                <button
                  type="button"
                  aria-label={`Add one ${line.name}`}
                  onClick={() => update(line.key, { quantity: line.quantity + 1 })}
                  className="bg-accent text-accent-ink hover:bg-accent-strong flex size-7 items-center justify-center rounded-md transition"
                >
                  <Plus className="size-3.5" />
                </button>
              </span>

              {line.kind === 'custom' ? (
                <input
                  aria-label="Item name"
                  placeholder="What is it?"
                  value={line.name}
                  onChange={(e) => update(line.key, { name: e.target.value })}
                  className="bg-surface-raised ring-line focus:ring-accent text-ink h-9 min-w-0 flex-1 rounded-lg px-2.5 text-sm ring-1 transition focus:ring-2 focus:outline-none"
                />
              ) : (
                <span className="min-w-0 flex-1 text-sm">
                  {line.name}
                  <span className="text-ink-faint"> · {line.sizeLabel}</span>
                </span>
              )}

              <button
                type="button"
                aria-label={`Remove ${line.name}`}
                onClick={() =>
                  setLines((current) => current.filter((l) => l.key !== line.key))
                }
                className="text-ink-faint shrink-0 transition hover:text-rose-400"
              >
                <Trash2 className="size-4" />
              </button>
            </div>

            <div className="flex items-center gap-2 pl-[5.25rem]">
              {line.kind === 'custom' ? (
                <>
                  <label className="text-ink-faint shrink-0 text-xs">
                    Price each
                  </label>
                  <input
                    inputMode="decimal"
                    aria-label={`Price for ${line.name || 'the custom item'}`}
                    placeholder="0.00"
                    value={line.price}
                    onChange={(e) => update(line.key, { price: e.target.value })}
                    className="bg-surface-raised ring-line focus:ring-accent text-ink tabular h-9 w-24 shrink-0 rounded-lg px-2.5 text-sm ring-1 transition focus:ring-2 focus:outline-none"
                  />
                  <span className="text-ink-faint truncate text-xs">
                    not on the menu
                  </span>
                </>
              ) : (
                <span className="text-ink-faint truncate text-xs">
                  {formatCentsCompact(
                    menuPrice.get(line.variantId!) ?? line.listCents,
                  )}{' '}
                  each · menu price
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="rounded-card bg-surface-raised ring-line/70 space-y-2 p-3 ring-1">
          <div className="text-ink-muted text-xs font-semibold tracking-wide uppercase">
            Add from the menu
          </div>
          <div className="max-h-56 space-y-2 overflow-y-auto">
            {menu.map((item) => (
              <div key={item.id}>
                <div className="text-xs font-medium">{item.name}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {item.variants.map((variant) => (
                    <button
                      key={variant.id}
                      type="button"
                      onClick={() => {
                        setLines((current) => [
                          ...current,
                          {
                            key: nextKey(),
                            kind: 'menu',
                            variantId: variant.id,
                            name: item.name,
                            sizeLabel: variant.sizeLabel,
                            listCents: variant.priceCents,
                            price: (variant.priceCents / 100).toFixed(2),
                            quantity: 1,
                          },
                        ])
                        setAdding(false)
                      }}
                      className="bg-surface ring-line hover:text-ink text-ink-muted rounded-lg px-2.5 py-1.5 text-xs ring-1 transition"
                    >
                      {variant.sizeLabel} {formatCentsCompact(variant.priceCents)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="border-line/60 flex gap-2 border-t pt-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setLines((current) => [
                  ...current,
                  {
                    key: nextKey(),
                    kind: 'custom',
                    variantId: null,
                    name: '',
                    sizeLabel: 'Custom',
                    listCents: 0,
                    price: '',
                    quantity: 1,
                  },
                ])
                setAdding(false)
              }}
            >
              <Plus className="size-4" />
              One-off item
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
              <X className="size-4" />
              Close
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-ink-muted hover:text-ink flex items-center gap-1.5 text-sm font-medium transition"
        >
          <Plus className="size-4" />
          Add an item
        </button>
      )}

      <div className="border-line/60 flex items-center gap-2 border-t pt-3">
        <label htmlFor="order-discount" className="text-ink-muted text-sm">
          Discount
        </label>
        <input
          id="order-discount"
          inputMode="decimal"
          placeholder="0.00"
          value={discount}
          onChange={(e) => setDiscount(e.target.value)}
          className="bg-surface-raised ring-line focus:ring-accent text-ink tabular h-9 w-24 rounded-lg px-2.5 text-sm ring-1 transition focus:ring-2 focus:outline-none"
        />
        <span className="text-ink-faint text-xs">taken off the whole order</span>
      </div>

      <dl className="space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-ink-muted">Subtotal</dt>
          <dd className="tabular">{formatCents(pricing.subtotalCents)}</dd>
        </div>
        {pricing.discountCents > 0 && (
          <div className="flex justify-between text-emerald-400">
            <dt>Price change</dt>
            <dd className="tabular">−{formatCents(pricing.discountCents)}</dd>
          </div>
        )}
        <div className="flex justify-between text-base font-semibold">
          <dt>Total</dt>
          <dd className="tabular">{formatCents(pricing.totalCents)}</dd>
        </div>
      </dl>

      {error && <p className="text-sm text-amber-300">{error}</p>}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="primary"
          disabled={pending || pricing.invalid || pricing.empty}
          onClick={save}
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save items
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setLines(toLines())
            setError(null)
            setOpen(false)
          }}
        >
          Cancel
        </Button>
      </div>

      {pricing.empty && (
        <p className="text-xs text-rose-400">
          An order needs at least one item. Cancel the order instead if it is not
          happening.
        </p>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                                  Delete                                    */
/* -------------------------------------------------------------------------- */

/**
 * Permanent removal, kept deliberately separate from cancelling.
 *
 * Cancelling keeps the order, its history and its place in the day's record,
 * and is what almost every situation calls for. This is for orders that should
 * never have existed, and it takes the line items and the audit trail with it.
 */
export function DeleteOrderButton({
  orderId,
  orderNumber,
  amountPaidCents,
}: {
  orderId: string
  orderNumber: number
  amountPaidCents: number
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function remove() {
    setError(null)
    startTransition(async () => {
      const result = await deleteOrder(orderId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.replace('/')
      router.refresh()
    })
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-ink-faint text-xs underline transition hover:text-rose-400"
      >
        Delete permanently
      </button>
    )
  }

  return (
    <div className="space-y-2 rounded-lg bg-rose-500/10 px-3 py-2.5">
      <p className="text-sm text-rose-200">
        Delete order #{orderNumber} for good? Its items and its whole history go
        with it, and there is no undo.
      </p>
      {amountPaidCents > 0 && (
        <p className="text-xs text-rose-300">
          {formatCents(amountPaidCents)} has been recorded as paid against this
          order. Deleting it removes that record too.
        </p>
      )}
      <p className="text-ink-faint text-xs">
        To keep the record and take it off the board, cancel it instead.
      </p>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="danger"
          size="sm"
          disabled={pending}
          onClick={remove}
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          Delete for good
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setConfirming(false)}
        >
          Keep it
        </Button>
      </div>
    </div>
  )
}
