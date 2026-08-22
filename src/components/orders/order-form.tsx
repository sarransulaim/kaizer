'use client'

import { Loader2, Minus, Plus, UserCheck } from 'lucide-react'
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
import { formatCentsCompact, parseDollarsToCents } from '@/lib/money'
import { createOrder, lookupCustomer } from '@/lib/orders/actions'
import type { MenuWithVariants } from '@/lib/orders/queries'
import { formatPhone, isValidPhone } from '@/lib/phone'
import { upcomingServiceDates } from '@/lib/time'
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

export function OrderForm({ menu }: { menu: MenuWithVariants }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const serviceDates = useMemo(() => upcomingServiceDates(), [])

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

  const variantIndex = useMemo(() => {
    const map = new Map<string, { priceCents: number }>()
    for (const item of menu) {
      for (const variant of item.variants) {
        map.set(variant.id, { priceCents: variant.priceCents })
      }
    }
    return map
  }, [menu])

  const subtotalCents = useMemo(
    () =>
      Object.entries(quantities).reduce((sum, [variantId, qty]) => {
        const variant = variantIndex.get(variantId)
        return variant ? sum + variant.priceCents * qty : sum
      }, 0),
    [quantities, variantIndex],
  )

  const itemCount = Object.values(quantities).reduce((a, b) => a + b, 0)
  const paidCents = parseDollarsToCents(amountPaid) ?? 0

  function setQuantity(variantId: string, next: number) {
    setQuantities((current) => {
      const updated = { ...current }
      if (next <= 0) delete updated[variantId]
      else updated[variantId] = next
      return updated
    })
  }

  function submit() {
    setFormError(null)
    setFieldErrors({})

    const items = Object.entries(quantities).map(([variantId, quantity]) => ({
      variantId,
      quantity,
    }))

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
        discountCents: 0,
        amountPaidCents: paidCents,
        paymentMethod: paymentMethod || undefined,
        paymentRef: paymentRef || undefined,
        notes: notes || undefined,
        customerNotes: customerNotes || undefined,
      })

      if (!result.ok) {
        setFormError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        return
      }

      router.push(`/orders/${result.data.orderId}`)
    })
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submit()
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
          {formError && (
            <p className="mb-2 text-sm text-rose-400">{formError}</p>
          )}
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="tabular text-xl font-semibold">
                {formatCentsCompact(subtotalCents)}
              </div>
              <div className="text-ink-faint text-xs">
                {itemCount === 0
                  ? 'No items yet'
                  : `${itemCount} item${itemCount === 1 ? '' : 's'}`}
                {paidCents > 0 &&
                  ` · ${formatCentsCompact(paidCents)} paid`}
              </div>
            </div>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={pending || itemCount === 0}
              className="min-w-36"
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Save order
            </Button>
          </div>
        </div>
      </div>
    </form>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-ink-faint text-xs font-semibold tracking-wider uppercase">
      {children}
    </h2>
  )
}
