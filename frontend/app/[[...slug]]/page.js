import ClientApp from './client'

// Optional catch-all: every non-/api path renders the original React SPA,
// which owns routing via react-router-dom. Rendered dynamically (the SPA is
// client-only) to avoid the prerendered optional-catch-all serving path.
export const dynamic = 'force-dynamic'

export default function Page() {
  return <ClientApp />
}
