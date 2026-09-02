'use client'

import { useEffect } from 'react'

/**
 * The last resort: an error thrown by the root layout itself, where no theme,
 * font or shell has loaded. It has to render its own `html` and `body`, and
 * cannot rely on any of the app's styles existing — so the few colours it needs
 * are inline, matching the dark canvas the rest of the app uses.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[global error]', error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          backgroundColor: '#191714',
          color: '#f5f2ee',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          textAlign: 'center',
          padding: '2rem',
        }}
      >
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
          Kaizr could not start
        </h1>
        <p style={{ color: '#a29c93', margin: 0, fontSize: '0.875rem' }}>
          Something failed before the app could load.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: '0.5rem',
            height: '2.75rem',
            padding: '0 1.25rem',
            borderRadius: '0.5rem',
            border: 'none',
            backgroundColor: '#e8a33d',
            color: '#2a2115',
            fontSize: '0.9375rem',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
        {error.digest && (
          <p style={{ color: '#7d7770', fontSize: '0.75rem', margin: 0 }}>
            Reference {error.digest}
          </p>
        )}
      </body>
    </html>
  )
}
