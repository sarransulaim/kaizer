'use client'

import { LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { signOut } from '@/lib/auth/actions'

export function SignOutButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <Button
      type="button"
      variant="secondary"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await signOut()
          router.replace('/login')
          router.refresh()
        })
      }
    >
      <LogOut className="size-4" />
      Sign out of this device
    </Button>
  )
}
