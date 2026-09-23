import { Navigate, useLocation, useParams } from 'react-router-dom'
import { portalHashToAppPath, reactPathToPortalHash } from '../lib/legacyPortal'

/**
 * Legacy /portal/* URLs map into the React app (no hand-off to portal.html).
 */
export function PortalBridgePage({ hash }: { hash?: string }) {
  const location = useLocation()
  const params = useParams()

  let target = hash
  if (!target && params.view) {
    target = params.view
    if (params.id) target = `${params.view}-detail-${params.id}`
  }
  if (!target) target = reactPathToPortalHash(location.pathname)

  const mapped = portalHashToAppPath(target)
  const [base, mappedQs = ''] = mapped.split('?')
  const merged = new URLSearchParams(mappedQs)
  new URLSearchParams(location.search).forEach((v, k) => merged.set(k, v))
  const qs = merged.toString()
  return <Navigate to={qs ? `${base}?${qs}` : base} replace />
}
