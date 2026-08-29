'use client'

import {
  BarChart3,
  ChefHat,
  ClipboardList,
  LayoutDashboard,
  Plus,
  Settings,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { BUSINESS } from '@/lib/config'
import { cn } from '@/lib/utils'

import { ConnectionDot, RealtimeProvider } from './realtime-refresh'

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/prep', label: 'Prep', icon: ClipboardList },
  { href: '/kitchen', label: 'Kitchen', icon: ChefHat },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href)
}

/**
 * Two navigation treatments from one definition: a bottom tab bar on phones
 * (thumb reach) and a persistent sidebar from `lg` up, where the extra width is
 * better spent on a denser order list than on chrome.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()

  return (
    <RealtimeProvider>
      <div className="flex min-h-full flex-col lg:flex-row">
        {/* Desktop sidebar */}
        <aside className="ring-line/60 hidden w-56 shrink-0 flex-col gap-1 p-4 ring-1 lg:flex">
          <div className="mb-6 px-2">
            <div className="text-lg font-semibold tracking-tight">{BUSINESS.name}</div>
            <div className="text-ink-faint text-xs">{BUSINESS.tagline}</div>
          </div>

          <Link
            href="/orders/new"
            className="bg-accent text-accent-ink hover:bg-accent-strong mb-3 flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-medium transition"
          >
            <Plus className="size-4" />
            New order
          </Link>

          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex h-11 items-center gap-3 rounded-lg px-3 text-sm transition',
                isActive(pathname, href)
                  ? 'bg-surface-raised text-ink font-medium'
                  : 'text-ink-muted hover:bg-surface hover:text-ink',
              )}
            >
              <Icon className="size-4.5" />
              {label}
            </Link>
          ))}

          <ConnectionDot className="mt-auto px-3 pt-1" />
        </aside>

        {/* Mobile header */}
        <header className="bg-canvas/85 ring-line/60 pt-safe sticky top-0 z-20 shrink-0 ring-1 backdrop-blur lg:hidden">
          <div className="flex h-14 items-center justify-between px-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-base leading-tight font-semibold tracking-tight">
                  {BUSINESS.name}
                </span>
                <ConnectionDot />
              </div>
              <div className="text-ink-faint text-[0.6875rem] leading-tight">
                {BUSINESS.tagline}
              </div>
            </div>
            <Link
              href="/orders/new"
              aria-label="New order"
              className="bg-accent text-accent-ink hover:bg-accent-strong flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition"
            >
              <Plus className="size-4" />
              New
            </Link>
          </div>
        </header>

        <main className="min-w-0 flex-1 pb-24 lg:pb-0">{children}</main>

        {/* Mobile bottom tabs */}
        <nav className="bg-canvas/90 ring-line/60 pb-safe fixed inset-x-0 bottom-0 z-20 ring-1 backdrop-blur lg:hidden">
          <div className="grid grid-cols-5">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = isActive(pathname, href)
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'flex h-16 flex-col items-center justify-center gap-1 text-[0.6875rem] transition',
                    active ? 'text-accent' : 'text-ink-faint',
                  )}
                >
                  <Icon className={cn('size-5', active && 'stroke-[2.25]')} />
                  {label}
                </Link>
              )
            })}
          </div>
        </nav>
      </div>
    </RealtimeProvider>
  )
}
