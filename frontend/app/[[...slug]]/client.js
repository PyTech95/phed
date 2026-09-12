'use client'

import dynamic from 'next/dynamic'

// The original CRA app touches window/localStorage at module scope and uses
// BrowserRouter, so it must only ever render in the browser.
const App = dynamic(() => import('@/App'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="animate-pulse text-slate-600">Loading...</div>
    </div>
  ),
})

export default function ClientApp() {
  return <App />
}
