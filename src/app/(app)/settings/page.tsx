import { ShieldAlert } from 'lucide-react'

import { PushManager } from '@/components/push-manager'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { BUSINESS } from '@/lib/config'
import { formatCentsCompact } from '@/lib/money'
import { getMenu } from '@/lib/orders/queries'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Settings' }

export default async function SettingsPage() {
  const menu = await getMenu()

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 lg:py-8">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-ink-faint text-sm">{BUSINESS.name} · {BUSINESS.timezone}</p>
      </header>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
          </CardHeader>
          <CardBody>
            <PushManager />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Menu</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="space-y-3">
              {menu.map((item) => (
                <div key={item.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium">{item.name}</span>
                    <span className="text-ink-faint text-xs">
                      {item.prepLeadHours}h lead
                    </span>
                  </div>
                  <div className="text-ink-muted mt-0.5 flex flex-wrap gap-x-3 text-xs">
                    {item.variants.map((variant) => (
                      <span key={variant.id} className="tabular">
                        {variant.sizeLabel} {formatCentsCompact(variant.priceCents)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-ink-faint mt-4 text-xs">
              Menu and prep lead times are seeded from{' '}
              <code className="text-ink-muted">scripts/seed.ts</code>. Editing
              them in-app comes in a later stage.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Access</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="flex gap-3">
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-400" />
              <div className="space-y-2 text-sm">
                <p className="font-medium">No login is enabled</p>
                <p className="text-ink-muted">
                  Anyone with the URL can see and edit every order, including
                  customer names and phone numbers. The user and role tables
                  already exist and every change is attributed in the order
                  history, so switching authentication on later needs no data
                  migration.
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
