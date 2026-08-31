import { ShieldCheck } from 'lucide-react'

import { PushManager } from '@/components/push-manager'
import { MenuEditor } from '@/components/settings/menu-editor'
import { SignOutButton } from '@/components/settings/sign-out-button'
import { StaffManager, type StaffView } from '@/components/settings/staff-manager'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { BUSINESS } from '@/lib/config'
import { getMenuForAdmin } from '@/lib/menu/queries'
import { getStaff } from '@/lib/staff/queries'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Settings' }

export default async function SettingsPage() {
  const [menu, staff] = await Promise.all([getMenuForAdmin(), getStaff()])
  const staffView: StaffView[] = staff

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 lg:py-8">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-ink-faint text-sm">
          {BUSINESS.name} · {BUSINESS.timezone}
        </p>
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
            <p className="text-ink-faint mb-3 text-xs">
              Items and prices used by the order form. Changes apply to new
              orders only — existing orders keep the name and price they were
              taken at.
            </p>
            <MenuEditor items={menu} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Staff and pay</CardTitle>
          </CardHeader>
          <CardBody>
            <StaffManager staff={staffView} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Access</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-400" />
              <div className="space-y-2 text-sm">
                <p className="font-medium">This side is passcode protected</p>
                <p className="text-ink-muted">
                  Orders, analytics, payroll and these settings all sit behind
                  the shared passcode. The kitchen display at{' '}
                  <code className="text-ink-muted">/kitchen</code> stays open so
                  the tablet and the workers&apos; phones need no login — they
                  get the order board and the time clock, and nothing else.
                </p>
                <p className="text-ink-faint text-xs">
                  Change the passcode by setting APP_PASSCODE in the Railway
                  dashboard. Everyone signed in stays signed in; changing
                  AUTH_SECRET instead signs everyone out.
                </p>
              </div>
            </div>

            <SignOutButton />
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
