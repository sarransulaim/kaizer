import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

import { OrderForm } from '@/components/orders/order-form'
import { getMenu } from '@/lib/orders/queries'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'New order' }

export default async function NewOrderPage() {
  const menu = await getMenu()

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 lg:py-8">
      <header className="mb-5">
        <Link
          href="/"
          className="text-ink-faint hover:text-ink mb-2 inline-flex items-center gap-1 text-sm transition"
        >
          <ArrowLeft className="size-4" />
          Back
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">New order</h1>
        <p className="text-ink-faint text-sm">
          From WhatsApp, the Google Form, or over the phone.
        </p>
      </header>

      {menu.length === 0 ? (
        <div className="rounded-card bg-surface ring-line/70 px-5 py-8 text-center ring-1">
          <p className="font-medium">No menu items yet</p>
          <p className="text-ink-faint mt-1 text-sm">
            Run <code className="text-accent">npm run db:seed</code> to load the menu.
          </p>
        </div>
      ) : (
        <OrderForm menu={menu} />
      )}
    </div>
  )
}
