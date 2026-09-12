import { useEffect } from 'react'
import { BrandLoader } from '../ui'
import { LEGACY_PORTAL_PATH } from '../lib/legacyPortal'

/** Hard navigate into same-origin static portal (hash SPA). */
export function LegacyPortalRedirect({ hash = 'dashboard' }: { hash?: string }) {
  useEffect(() => {
    const h = String(hash).replace(/^#/, '')
    window.location.replace(`${LEGACY_PORTAL_PATH}#${h}`)
  }, [hash])
  return <BrandLoader viewport label="Opening" />
}
