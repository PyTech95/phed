import ClientApp from './client'

// Optional catch-all: every non-/api path renders the original React SPA,
// which owns routing via react-router-dom.
export function generateStaticParams() {
  return [{ slug: [''] }]
}

export default function Page() {
  return <ClientApp />
}
