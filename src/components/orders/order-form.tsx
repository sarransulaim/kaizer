'use client'

import { ChevronLeft, Loader2, Minus, Plus, UserCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import type {
  FulfillmentType,
  OrderChannel,
  PaymentMethod,
} from '@/lib/db/schema'
import { formatCents, formatCentsCompact, parseDollarsToCents } from '@/lib/money'
import { createOrder, lookupCustomer } from '@/lib/orders/actions'
import type { MenuWithVariants } from '@/lib/orders/queries'
import { formatPhone, isValidPhone } from '@/lib/phone'
import { dayLabel, formatTime, upcomingDays } from '@/lib/time'
import { cn } from '@/lib/utils'

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

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'zelle', label: 'Zelle' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'venmo', label: 'Venmo' },
  { value: 'other', label: 'Other' },
]

type CustomItem = {
  id: string
  name: string
  /** As typed, in dollars. */
  price: string
  quantity: number
}

type PriceLine = {
  key: string
  kind: 'menu' | 'custom'
  quantity: number
  itemName: string
  sizeLabel: string
  listCents: number
  chargedCents: number
  lineListCents: number
  lineChargedCents: number
  invalid: boolean
  aboveList: boolean
  changed: boolean
}

/* Ids for custom lines. Only ever React keys and a handle on a row of local
   state, so a counter is enough — and it avoids depending on
   `crypto.randomUUID` being present on an older tablet browser. */
let customIdCounter = 0
const nextCustomId = () => `custom-${(customIdCounter += 1)}`

export function OrderForm({ menu }: { menu: MenuWithVariants }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const serviceDates = useMemo(() => upcomingDays(), [])

  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [matched, setMatched] = useState<{ orders: number } | null>(null)

  const [channel, setChannel] = useState<OrderChannel>('whatsapp')
  const [fulfillmentType, setFulfillment] = useState<FulfillmentType>('pickup')
  const [serviceDate, setServiceDate] = useState(serviceDates[0]?.date ?? '')
  const [serviceTime, setServiceTime] = useState('18:00')
  const [deliveryAddress, setDeliveryAddress] = useState('')

  const [quantities, setQuantities] = useState<Record<string, number>>({})
  /* Typed dollar strings, keyed by variant. Empty means "charge menu price". */
  const [priceOverrides, setPriceOverrides] = useState<Record<string, string>>({})
  /**
   * Lines that exist only on this order — a special request, a surcharge, a
   * cake somebody asked for. Held as typed strings so a half-entered price is
   * never rounded while it is still being typed.
   */
  const [customItems, setCustomItems] = useState<CustomItem[]>([])
  const [reviewing, setReviewing] = useState(false)

  const [amountPaid, setAmountPaid] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('')
  const [paymentRef, setPaymentRef] = useState('')

  const [notes, setNotes] = useState('')
  const [customerNotes, setCustomerNotes] = useState('')

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  /* Phone is the identity key, so a complete number triggers a lookup and
     pre-fills the rest. Most catering customers order repeatedly. */
  useEffect(() => {
    let cancelled = false

    /* Every state update happens inside the debounce callback rather than in
       the effect body — a synchronous setState here would cascade a re-render
       on each keystroke, and it also made the "returning customer" hint flicker
       while the number was being typed. */
    const timer = setTimeout(async () => {
      if (!isValidPhone(phone)) {
        if (!cancelled) setMatched(null)
        return
      }

      const result = await lookupCustomer(phone)
      if (cancelled) return

      if (!result) {
        setMatched(null)
        return
      }

      setName((current) => current || result.customer.name)
      setEmail((current) => current || (result.customer.email ?? ''))
      setMatched({ orders: result.recentOrders.length })
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [phone])

  /* Menu price plus the name and size a variant belongs to, so the
     confirmation step can list the order without walking the menu again. */
  const variantIndex = useMemo(() => {
    const map = new Map<
      string,
      { priceCents: number; itemName: string; sizeLabel: string }
    >()
    for (const item of menu) {
      for (const variant of item.variants) {
        map.set(variant.id, {
          priceCents: variant.priceCents,
          itemName: item.name,
          sizeLabel: variant.sizeLabel,
        })
      }
    }
    return map
  }, [menu])

  /**
   * The order exactly as it will be saved.
   *
   * A line item always keeps the menu price: that snapshot is what lets an old
   * order render for the rest of time as it was taken. So a price the operator
   * types here is recorded as an order-level discount rather than a quietly
   * rewritten line price — which is also why the confirmation can read
   * "100 − 20 = 80" instead of just showing 80 with no explanation.
   */
  const pricing = useMemo(() => {
    const menuLines: PriceLine[] = Object.entries(quantities).flatMap(
      ([variantId, quantity]) => {
        const variant = variantIndex.get(variantId)
        if (!variant) return []

        const listCents = variant.priceCents
        const typed = priceOverrides[variantId]?.trim() ?? ''
        const parsed = typed ? parseDollarsToCents(typed) : null
        const chargedCents = parsed ?? listCents

        return [
          {
            key: variantId,
            kind: 'menu' as const,
            quantity,
            itemName: variant.itemName,
            sizeLabel: variant.sizeLabel,
            listCents,
            chargedCents,
            lineListCents: listCents * quantity,
            lineChargedCents: chargedCents * quantity,
            /* A blank box is not an override, it is "leave the menu price". */
            invalid: typed !== '' && parsed === null,
            aboveList: chargedCents > listCents,
            changed: parsed !== null && parsed !== listCents,
          },
        ]
      },
    )

    /**
     * A custom line has no menu price to be discounted from, so the number
     * typed into it simply is the price. That keeps the breakdown honest: the
     * "price change" figure stays a record of discounts against the menu and
     * does not quietly absorb the cost of a one-off item.
     */
    const customLines: PriceLine[] = customItems.map((item) => {
      const parsed = parseDollarsToCents(item.price)
      const cents = parsed ?? 0

      return {
        key: item.id,
        kind: 'custom' as const,
        quantity: item.quantity,
        itemName: item.name.trim() || 'Untitled item',
        sizeLabel: 'Custom',
        listCents: cents,
        chargedCents: cents,
        lineListCents: cents * item.quantity,
        lineChargedCents: cents * item.quantity,
        invalid: item.price.trim() === '' || parsed === null,
        aboveList: false,
        changed: false,
      }
    })

    const lines = [...menuLines, ...customLines]

    const subtotalCents = lines.reduce((sum, l) => sum + l.lineListCents, 0)
    const discountCents = lines.reduce(
      (sum, l) => sum + Math.max(0, l.lineListCents - l.lineChargedCents),
      0,
    )

    return {
      lines,
      subtotalCents,
      discountCents,
      totalCents: subtotalCents - discountCents,
      hasInvalid: lines.some((l) => l.invalid),
      hasAboveList: lines.some((l) => l.aboveList),
      hasUnnamed: customItems.some((item) => item.name.trim() === ''),
    }
  }, [quantities, variantIndex, priceOverrides, customItems])

  const itemCount =
    Object.values(quantities).reduce((a, b) => a + b, 0) +
    customItems.reduce((sum, item) => sum + item.quantity, 0)
  const paidCents = parseDollarsToCents(amountPaid) ?? 0
  const balanceCents = Math.max(pricing.totalCents - paidCents, 0)

  function setQuantity(variantId: string, next: number) {
    setQuantities((current) => {
      const updated = { ...current }
      if (next <= 0) delete updated[variantId]
      else updated[variantId] = next
      return updated
    })

    /* Clearing a line drops its price override too, so re-adding the same tray
       later starts from the menu price rather than a forgotten one. */
    if (next <= 0) {
      setPriceOverrides((current) => {
        if (!(variantId in current)) return current
        const updated = { ...current }
        delete updated[variantId]
        return updated
      })
    }
  }

  function setPrice(variantId: string, value: string) {
    setPriceOverrides((current) => ({ ...current, [variantId]: value }))
  }

  function addCustomItem() {
    setCustomItems((current) => [
      ...current,
      { id: nextCustomId(), name: '', price: '', quantity: 1 },
    ])
  }

  function updateCustomItem(id: string, patch: Partial<Omit<CustomItem, 'id'>>) {
    setCustomItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    )
  }

  function removeCustomItem(id: string) {
    setCustomItems((current) => current.filter((item) => item.id !== id))
  }

  function resetPrice(variantId: string) {
    setPriceOverrides((current) => {
      const updated = { ...current }
      delete updated[variantId]
      return updated
    })
  }

  function save() {
    setFormError(null)
    setFieldErrors({})

    const items = [
      ...Object.entries(quantities).map(([variantId, quantity]) => ({
        variantId,
        quantity,
      })),
      ...customItems.map((item) => ({
        name: item.name.trim(),
        priceCents: parseDollarsToCents(item.price) ?? 0,
        quantity: item.quantity,
      })),
    ]

    startTransition(async () => {
      const result = await createOrder({
        customerName: name,
        phone,
        email: email || undefined,
        channel,
        fulfillmentType,
        serviceDate,
        serviceTime,
        deliveryAddress: deliveryAddress || undefined,
        items,
        discountCents: pricing.discountCents,
        amountPaidCents: paidCents,
        paymentMethod: paymentMethod || undefined,
        paymentRef: paymentRef || undefined,
        notes: notes || undefined,
        customerNotes: customerNotes || undefined,
      })

      if (!result.ok) {
        setFormError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        /* The fields these errors point at sit behind the confirmation sheet,
           so it has to close for them to be reachable. */
        setReviewing(false)
        return
      }

      router.push(`/orders/${result.data.orderId}`)
    })
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (itemCount > 0) setReviewing(true)
      }}
      className="space-y-6 pb-32"
    >
      {/* ----------------------------- Customer ----------------------------- */}
      <section className="space-y-3">
        <SectionTitle>Customer</SectionTitle>

        <Field
          label="Phone"
          required
          error={fieldErrors.phone}
          hint={phone && isValidPhone(phone) ? formatPhone(phone) : undefined}
        >
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="732 555 0134"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>

        {matched && (
          <p className="flex items-center gap-1.5 text-xs text-emerald-400">
            <UserCheck className="size-3.5" />
            Returning customer — details filled in
          </p>
        )}

        <Field label="Name" required error={fieldErrors.customerName}>
          <Input
            autoComplete="off"
            placeholder="Contact name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field label="Email" hint="optional" error={fieldErrors.email}>
          <Input
            type="email"
            autoComplete="off"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field label="Came in via">
          <Segmented options={CHANNELS} value={channel} onChange={setChannel} />
        </Field>
      </section>

      {/* ------------------------------ When -------------------------------- */}
      <section className="space-y-3">
        <SectionTitle>When</SectionTitle>

        <div className="flex flex-wrap gap-2">
          {serviceDates.map(({ date, label }) => (
            <button
              key={date}
              type="button"
              onClick={() => setServiceDate(date)}
              className={cn(
                'h-9 rounded-lg px-3 text-sm font-medium ring-1 transition',
                serviceDate === date
                  ? 'bg-accent text-accent-ink ring-accent'
                  : 'bg-surface-raised text-ink-muted ring-line hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" required error={fieldErrors.serviceDate}>
            <Input
              type="date"
              value={serviceDate}
              onChange={(e) => setServiceDate(e.target.value)}
            />
          </Field>
          <Field label="Time" required error={fieldErrors.serviceTime}>
            <Input
              type="time"
              value={serviceTime}
              onChange={(e) => setServiceTime(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Fulfillment">
          <Segmented
            options={FULFILLMENT}
            value={fulfillmentType}
            onChange={setFulfillment}
          />
        </Field>

        {fulfillmentType === 'delivery' && (
          <Field
            label="Delivery address"
            required
            error={fieldErrors.deliveryAddress}
          >
            <Textarea
              placeholder="Street, city, apartment / gate code"
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
            />
          </Field>
        )}
      </section>

      {/* ------------------------------ Items ------------------------------- */}
      <section className="space-y-3">
        <SectionTitle>Items</SectionTitle>
        {fieldErrors.items && (
          <p className="text-xs text-rose-400">{fieldErrors.items}</p>
        )}

        <div className="space-y-3">
          {menu.map((item) => (
            <div
              key={item.id}
              className="rounded-card bg-surface ring-line/70 overflow-hidden ring-1"
            >
              <div className="border-line/60 border-b px-3.5 py-2.5">
                <div className="text-sm font-semibold">{item.name}</div>
              </div>

              <div className="divide-line/50 divide-y">
                {item.variants.map((variant) => {
                  const qty = quantities[variant.id] ?? 0
                  return (
                    <div
                      key={variant.id}
                      className={cn(
                        'flex items-center gap-3 px-3.5 py-2.5 transition',
                        qty > 0 && 'bg-accent/5',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm">{variant.sizeLabel}</div>
                        <div className="text-ink-faint tabular text-xs">
                          {formatCentsCompact(variant.priceCents)}
                          {variant.servesCount
                            ? ` · serves ~${variant.servesCount}`
                            : ''}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          aria-label={`Remove one ${item.name} ${variant.sizeLabel}`}
                          onClick={() => setQuantity(variant.id, qty - 1)}
                          disabled={qty === 0}
                          className="bg-surface-raised ring-line text-ink-muted hover:text-ink flex size-9 items-center justify-center rounded-lg ring-1 transition disabled:opacity-30"
                        >
                          <Minus className="size-4" />
                        </button>
                        <span
                          className={cn(
                            'tabular w-7 text-center text-sm font-semibold',
                            qty === 0 && 'text-ink-faint',
                          )}
                        >
                          {qty}
                        </span>
                        <button
                          type="button"
                          aria-label={`Add one ${item.name} ${variant.sizeLabel}`}
                          onClick={() => setQuantity(variant.id, qty + 1)}
                          className="bg-accent text-accent-ink hover:bg-accent-strong flex size-9 items-center justify-center rounded-lg transition"
                        >
                          <Plus className="size-4" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ----------------------------- Payment ------------------------------ */}
      <section className="space-y-3">
        <SectionTitle>Payment</SectionTitle>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount paid" hint="leave blank if unpaid">
            <Input
              inputMode="decimal"
              placeholder="0.00"
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
            />
          </Field>
          <Field label="Method">
            <Select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
            >
              <option value="">—</option>
              {PAYMENT_METHODS.map((method) => (
                <option key={method.value} value={method.value}>
                  {method.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {paymentMethod === 'zelle' && (
          <Field label="Zelle sent from" hint="name or phone on the transfer">
            <Input
              placeholder="Name / phone the payment came from"
              value={paymentRef}
              onChange={(e) => setPaymentRef(e.target.value)}
            />
          </Field>
        )}
      </section>

      {/* ------------------------------ Notes ------------------------------- */}
      <section className="space-y-3">
        <SectionTitle>Notes</SectionTitle>

        <Field label="Customer request" hint="in their words">
          <Textarea
            placeholder="Extra spicy, no nuts, ring the bell…"
            value={customerNotes}
            onChange={(e) => setCustomerNotes(e.target.value)}
          />
        </Field>

        <Field label="Kitchen note" hint="shown on the prep display">
          <Textarea
            placeholder="Anything the kitchen needs to know"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </section>

      {/* --------------------------- Sticky total --------------------------- */}
      <div className="bg-canvas/95 ring-line/70 pb-safe fixed inset-x-0 bottom-0 z-30 ring-1 backdrop-blur lg:left-56">
        <div className="mx-auto w-full max-w-3xl px-4 py-3">
          {formError && !reviewing && (
            <p className="mb-2 text-sm text-rose-400">{formError}</p>
          )}
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="tabular text-xl font-semibold">
                {formatCentsCompact(pricing.totalCents)}
              </div>
              <div className="text-ink-faint text-xs">
                {itemCount === 0
                  ? 'No items yet'
                  : `${itemCount} item${itemCount === 1 ? '' : 's'}`}
                {pricing.discountCents > 0 && ` · ${formatCentsCompact(pricing.discountCents)} off`}
                {paidCents > 0 && ` · ${formatCentsCompact(paidCents)} paid`}
              </div>
            </div>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={itemCount === 0}
              className="min-w-36"
            >
              Review order
            </Button>
          </div>
        </div>
      </div>

      {/* ------------------------ Confirmation sheet ------------------------ */}
      {reviewing && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm order"
          className="bg-canvas fixed inset-0 z-40 flex flex-col lg:left-56"
        >
          <header className="border-line/60 pt-safe shrink-0 border-b px-4 py-3">
            <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
              <button
                type="button"
                onClick={() => setReviewing(false)}
                aria-label="Back to the order form"
                className="text-ink-muted hover:text-ink -ml-2 flex size-10 shrink-0 items-center justify-center rounded-lg transition"
              >
                <ChevronLeft className="size-5" />
              </button>
              <div className="min-w-0">
                <h2 className="text-lg leading-tight font-semibold tracking-tight">
                  Confirm order
                </h2>
                <p className="text-ink-faint truncate text-xs">
                  Check the prices before saving
                </p>
              </div>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="mx-auto w-full max-w-3xl space-y-4">
              {/* Who and when */}
              <div className="rounded-card bg-surface ring-line/70 divide-line/50 divide-y ring-1">
                <SummaryRow label="Customer">
                  {name || <span className="text-rose-400">Name missing</span>}
                  {phone && (
                    <span className="text-ink-faint block text-xs">
                      {isValidPhone(phone) ? formatPhone(phone) : phone}
                    </span>
                  )}
                </SummaryRow>
                <SummaryRow label="When">
                  {serviceDate ? dayLabel(serviceDate) : '—'}
                  <span className="text-ink-faint block text-xs">
                    {serviceDate} · {formatTime(serviceTime)}
                  </span>
                </SummaryRow>
                <SummaryRow label="Fulfillment">
                  {FULFILLMENT.find((f) => f.value === fulfillmentType)?.label}
                  {fulfillmentType === 'delivery' && deliveryAddress && (
                    <span className="text-ink-faint block text-xs">
                      {deliveryAddress}
                    </span>
                  )}
                </SummaryRow>
              </div>

              {/* Items, with an editable price per line */}
              <div className="rounded-card bg-surface ring-line/70 ring-1">
                <div className="border-line/60 border-b px-4 py-2.5">
                  <h3 className="text-ink-muted text-xs font-semibold tracking-wider uppercase">
                    Items and prices
                  </h3>
                </div>
                <ul className="divide-line/50 divide-y">
                  {pricing.lines.map((line) => (
                    <li key={line.key} className="px-4 py-3">
                      <div className="flex items-baseline gap-2.5">
                        {line.kind === 'custom' ? (
                          <span className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              aria-label={`Remove one ${line.itemName}`}
                              onClick={() =>
                                updateCustomItem(line.key, {
                                  quantity: Math.max(1, line.quantity - 1),
                                })
                              }
                              disabled={line.quantity <= 1}
                              className="bg-surface-raised ring-line text-ink-muted hover:text-ink flex size-7 items-center justify-center rounded-md ring-1 transition disabled:opacity-30"
                            >
                              <Minus className="size-3.5" />
                            </button>
                            <span className="tabular text-accent w-5 text-center text-sm font-semibold">
                              {line.quantity}
                            </span>
                            <button
                              type="button"
                              aria-label={`Add one ${line.itemName}`}
                              onClick={() =>
                                updateCustomItem(line.key, { quantity: line.quantity + 1 })
                              }
                              className="bg-accent text-accent-ink hover:bg-accent-strong flex size-7 items-center justify-center rounded-md transition"
                            >
                              <Plus className="size-3.5" />
                            </button>
                          </span>
                        ) : (
                          <span className="tabular text-accent w-8 shrink-0 font-semibold">
                            {line.quantity}×
                          </span>
                        )}
                        {line.kind === 'custom' ? (
                          <input
                            aria-label="Item name"
                            placeholder="What is it?"
                            value={
                              customItems.find((item) => item.id === line.key)?.name ??
                              ''
                            }
                            onChange={(event) =>
                              updateCustomItem(line.key, { name: event.target.value })
                            }
                            className={cn(
                              'bg-surface-raised text-ink placeholder:text-ink-faint h-9 min-w-0 flex-1 rounded-lg px-2.5 text-sm ring-1 transition focus:ring-2 focus:outline-none',
                              line.itemName === 'Untitled item'
                                ? 'ring-rose-500'
                                : 'ring-line focus:ring-accent',
                            )}
                          />
                        ) : (
                          <span className="min-w-0 flex-1 text-sm">
                            {line.itemName}
                            <span className="text-ink-faint"> · {line.sizeLabel}</span>
                          </span>
                        )}
                        <span className="tabular shrink-0 text-sm">
                          {line.changed && !line.aboveList && (
                            <span className="text-ink-faint mr-1.5 line-through">
                              {formatCentsCompact(line.lineListCents)}
                            </span>
                          )}
                          {formatCents(line.lineChargedCents)}
                        </span>
                      </div>

                      <div className="mt-2 flex items-center gap-2 pl-[2.625rem]">
                        <label
                          htmlFor={`price-${line.key}`}
                          className="text-ink-faint shrink-0 text-xs"
                        >
                          Price each
                        </label>
                        <input
                          id={`price-${line.key}`}
                          inputMode="decimal"
                          placeholder={
                            line.kind === 'custom'
                              ? '0.00'
                              : (line.listCents / 100).toFixed(2)
                          }
                          value={
                            line.kind === 'custom'
                              ? (customItems.find((item) => item.id === line.key)
                                  ?.price ?? '')
                              : (priceOverrides[line.key] ?? '')
                          }
                          onChange={(e) =>
                            line.kind === 'custom'
                              ? updateCustomItem(line.key, { price: e.target.value })
                              : setPrice(line.key, e.target.value)
                          }
                          className={cn(
                            'bg-surface-raised text-ink placeholder:text-ink-faint tabular h-10 w-24 shrink-0 rounded-lg px-2.5 text-base ring-1 transition focus:ring-2 focus:outline-none',
                            line.invalid || line.aboveList
                              ? 'ring-rose-500'
                              : 'ring-line focus:ring-accent',
                          )}
                        />
                        <span className="text-ink-faint truncate text-xs">
                          {line.kind === 'custom'
                            ? 'not on the menu'
                            : `menu ${formatCentsCompact(line.listCents)}`}
                        </span>
                        {line.kind === 'custom' ? (
                          <button
                            type="button"
                            onClick={() => removeCustomItem(line.key)}
                            className="text-ink-faint ml-auto shrink-0 text-xs underline hover:text-rose-400"
                          >
                            Remove
                          </button>
                        ) : (
                          line.changed && (
                            <button
                              type="button"
                              onClick={() => resetPrice(line.key)}
                              className="text-ink-faint hover:text-ink ml-auto shrink-0 text-xs underline"
                            >
                              Reset
                            </button>
                          )
                        )}
                      </div>

                      {line.invalid && (
                        <p className="mt-1.5 pl-[2.625rem] text-xs text-rose-400">
                          {line.kind === 'custom'
                            ? 'Give this item a price, like 25 or 12.50'
                            : 'Enter a price like 80 or 79.50'}
                        </p>
                      )}
                      {line.aboveList && !line.invalid && (
                        <p className="mt-1.5 pl-[2.625rem] text-xs text-rose-400">
                          Higher than the menu price of{' '}
                          {formatCentsCompact(line.listCents)}. Lower it here, or
                          raise the menu price in Settings.
                        </p>
                      )}
                    </li>
                  ))}
                </ul>

                <div className="border-line/60 border-t px-4 py-3">
                  <button
                    type="button"
                    onClick={addCustomItem}
                    className="text-ink-muted hover:text-ink flex items-center gap-1.5 text-sm font-medium transition"
                  >
                    <Plus className="size-4" />
                    Add an item that is not on the menu
                  </button>
                </div>
              </div>

              {/* The arithmetic, spelled out */}
              <div className="rounded-card bg-surface ring-line/70 px-4 py-3 ring-1">
                <dl className="space-y-1.5 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-ink-muted">Subtotal</dt>
                    <dd className="tabular">{formatCents(pricing.subtotalCents)}</dd>
                  </div>
                  {pricing.discountCents > 0 && (
                    <div className="flex items-baseline justify-between gap-3 text-emerald-400">
                      <dt>Price change</dt>
                      <dd className="tabular">
                        −{formatCents(pricing.discountCents)}
                      </dd>
                    </div>
                  )}
                  <div className="border-line/60 flex items-baseline justify-between gap-3 border-t pt-2 text-base font-semibold">
                    <dt>Total</dt>
                    <dd className="tabular">{formatCents(pricing.totalCents)}</dd>
                  </div>
                  {paidCents > 0 && (
                    <>
                      <div className="flex items-baseline justify-between gap-3 pt-1">
                        <dt className="text-ink-muted">Paid</dt>
                        <dd className="tabular">
                          {formatCents(Math.min(paidCents, pricing.totalCents))}
                        </dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-ink-muted">Balance</dt>
                        <dd
                          className={cn(
                            'tabular',
                            balanceCents > 0 ? 'text-amber-400' : 'text-emerald-400',
                          )}
                        >
                          {formatCents(balanceCents)}
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
              </div>

              {formError && <p className="text-sm text-rose-400">{formError}</p>}
            </div>
          </div>

          <footer className="border-line/60 pb-safe shrink-0 border-t px-4 py-3">
            <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="tabular text-xl font-semibold">
                  {formatCents(pricing.totalCents)}
                </div>
                <div className="text-ink-faint truncate text-xs">
                  {pricing.discountCents > 0
                    ? `${formatCentsCompact(pricing.subtotalCents)} − ${formatCentsCompact(pricing.discountCents)}`
                    : `${itemCount} item${itemCount === 1 ? '' : 's'}`}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  onClick={() => setReviewing(false)}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  onClick={save}
                  disabled={
                    pending ||
                    itemCount === 0 ||
                    pricing.hasInvalid ||
                    pricing.hasAboveList ||
                    pricing.hasUnnamed
                  }
                >
                  {pending && <Loader2 className="size-4 animate-spin" />}
                  Confirm &amp; save
                </Button>
              </div>
            </div>
          </footer>
        </div>
      )}
    </form>
  )
}

function SummaryRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5 text-sm">
      <span className="text-ink-muted shrink-0">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-ink-faint text-xs font-semibold tracking-wider uppercase">
      {children}
    </h2>
  )
}
