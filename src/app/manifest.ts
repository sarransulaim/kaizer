import type { MetadataRoute } from 'next'

import { BUSINESS } from '@/lib/config'

/**
 * Required for "Add to Home Screen". On iOS this is also what makes web push
 * available at all — notifications only work once the PWA is installed.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BUSINESS.name} Orders`,
    short_name: BUSINESS.name,
    description: `Catering order tracker for ${BUSINESS.name}.`,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#221c14',
    theme_color: '#221c14',
    categories: ['business', 'food', 'productivity'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      { name: 'New order', short_name: 'New', url: '/orders/new' },
      { name: 'Prep sheet', short_name: 'Prep', url: '/prep' },
    ],
  }
}
