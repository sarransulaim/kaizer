import { AppShell } from '@/components/app-shell'

/**
 * Everything inside this group shares the ops chrome. The kitchen display sits
 * outside it, since a wall tablet wants no navigation at all.
 */
export default function AppLayout({ children }: LayoutProps<'/'>) {
  return <AppShell>{children}</AppShell>
}
