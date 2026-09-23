import { Navigate } from 'react-router-dom'
import { portalHashToAppPath } from '../lib/legacyPortal'

/** Old /legacy-portal entry → React registry (no portal.html). */
export function LegacyPortalRedirect({ hash = 'dashboard' }: { hash?: string }) {
  return <Navigate to={portalHashToAppPath(hash)} replace />
}
