import { PushManager } from '@/components/push-manager'
import { MenuEditor } from '@/components/settings/menu-editor'
import { PasscodePanel } from '@/components/settings/passcode-panel'
import { SignOutButton } from '@/components/settings/sign-out-button'
import { StaffManager, type StaffView } from '@/components/settings/staff-manager'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { BUSINESS } from '@/lib/config'
import { getMenuForAdmin } from '@/lib/menu/queries'
import { secretKeyConfigured } from '@/lib/auth/passcode'
import { getStaff } from '@/lib/staff/queries'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Settings' }

export default async function SettingsPage() {
  const [menu, staff] = await Promise.all([getMenuForAdmin(), getStaff()])
  const secretKeyReady = secretKeyConfigured()
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
            <PasscodePanel secretKeyConfigured={secretKeyReady} />

            <div className="border-line/60 border-t pt-4">
              <SignOutButton />
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
