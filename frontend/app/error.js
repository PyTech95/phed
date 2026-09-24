'use client'

import { useEffect } from 'react'

// App Router error boundary: if a page chunk fails to load or a render throws,
// show a retryable message instead of a blank white "Application error" screen.
export default function Error({ error, reset }) {
  useEffect(() => {
    // Surface to console for support/debugging
    console.error('App error boundary caught:', error)
  }, [error])

  return (
    <div
      data-testid="app-error-boundary"
      style={{
        minHeight: '70vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '16px',
        fontFamily: 'system-ui, sans-serif', padding: '24px', textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 40 }} aria-hidden>⚠️</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>
        Page load nahi ho paya
      </h2>
      <p style={{ maxWidth: 420, fontSize: 14, color: '#475569' }}>
        Kuch galat ho gaya. Ye aksar tab hota hai jab app ka naya version aaya ho
        aur browser purana data use kar raha ho. Kripya retry karein ya page refresh karein.
      </p>
      <div style={{ display: 'flex', gap: 12 }}>
        <button
          data-testid="app-error-retry"
          onClick={() => reset()}
          style={{
            background: '#1565C0', color: '#fff', border: 'none', borderRadius: 8,
            padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}
        >
          Retry
        </button>
        <button
          data-testid="app-error-reload"
          onClick={() => window.location.reload()}
          style={{
            background: '#fff', color: '#1565C0', border: '1px solid #1565C0',
            borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}
        >
          Refresh page
        </button>
      </div>
    </div>
  )
}
