import { redirect } from 'next/navigation'

/**
 * Upcoming is a tab on the dashboard now, not a route of its own. This redirect
 * stays because the app is installed as a PWA on the owner's phone and the old
 * URL is still in its history and on the home screen.
 */
export default function UpcomingPage() {
  redirect('/?view=upcoming')
}
