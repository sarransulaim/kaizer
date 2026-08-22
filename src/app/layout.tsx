import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'

import { BUSINESS } from '@/lib/config'

import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: {
    default: `${BUSINESS.name} Orders`,
    template: `%s · ${BUSINESS.name}`,
  },
  description: `Catering order tracker for ${BUSINESS.name}.`,
  applicationName: `${BUSINESS.name} Orders`,
  appleWebApp: {
    capable: true,
    title: BUSINESS.name,
    // Lets the status bar sit over the app's own background once installed.
    statusBarStyle: 'black-translucent',
  },
  // This is an internal ops tool, not a public page.
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: '#221c14',
  // `cover` is what allows the safe-area insets to resolve on a notched iPhone.
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
  // Order entry involves reading trays and quantities; pinch-zoom stays available.
  maximumScale: 5,
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="bg-canvas text-ink flex min-h-full flex-col">{children}</body>
    </html>
  )
}
