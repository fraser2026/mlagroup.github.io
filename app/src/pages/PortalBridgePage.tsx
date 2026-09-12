import { useEffect } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { BrandLoader } from '../ui'
import { legacyPortalUrl, reactPathToPortalHash } from '../lib/legacyPortal'

/**
 * Full-document hand-off to the same-origin legacy portal.
 * Used for surfaces not yet React-parity-complete, and as the
 * primary "portal on app as is" experience.
 */
export function PortalBridgePage({ hash }: { hash?: string }) {
  const location = useLocation()
  const params = useParams()

  useEffect(() => {
    let target = hash
    if (!target && params.view) {
      target = params.view
      if (params.id) target = `${params.view}-detail-${params.id}`
    }
    if (!target) target = reactPathToPortalHash(location.pathname)

    const url = new URL(legacyPortalUrl(target), window.location.origin)
    if (location.search) {
      const src = new URLSearchParams(location.search)
      src.forEach((v, k) => url.searchParams.set(k, v))
    }
    window.location.replace(url.pathname + url.search + url.hash)
  }, [hash, location.pathname, location.search, params.view, params.id])

  return <BrandLoader viewport label="Opening" />
}
