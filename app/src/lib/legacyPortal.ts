/** Same-origin legacy portal entry (parity bridge; prefer React routes). */
export const LEGACY_PORTAL_PATH = '/legacy/portal.html'

export function legacyPortalUrl(hash = 'dashboard') {
  const h = String(hash || 'dashboard').replace(/^#/, '')
  return `${LEGACY_PORTAL_PATH}#${h}`
}

/** Map React paths → portal hash for bridge hand-off / deep links. */
export function reactPathToPortalHash(pathname: string): string {
  const p = pathname.replace(/\/$/, '') || '/'
  if (p === '/' || p === '') return 'dashboard'
  if (p === '/registry') return 'registry'
  if (p.startsWith('/registry/')) return `registry-detail-${p.slice('/registry/'.length)}`
  if (p === '/controls') return 'controls'
  if (p.startsWith('/controls/')) return `control-detail-${p.slice('/controls/'.length)}`
  if (p === '/policies') return 'policies'
  if (p.startsWith('/policies/')) return `policy-detail-${p.slice('/policies/'.length)}`
  if (p === '/organisation' || p === '/organization') return 'org'
  if (p === '/integrations') return 'integrations'
  if (p === '/settings') return 'settings'
  if (p === '/users') return 'users'
  if (p === '/billing') return 'billing'
  if (p === '/plans') return 'plans'
  if (p === '/alerts' || p === '/notifications') return 'alerts'
  if (p === '/reports') return 'reports'
  if (p === '/monitoring') return 'audit-log'
  return 'dashboard'
}

/** Map legacy portal hash / goto → React app path (no portal hand-off). */
export function portalHashToAppPath(raw: string): string {
  const h = String(raw || 'dashboard').replace(/^#/, '').replace(/^\?goto=/, '')
  if (!h || h === 'dashboard') return '/registry'
  if (h === 'registry') return '/registry'
  if (h.startsWith('registry-detail-')) return `/registry/${h.slice('registry-detail-'.length)}`
  if (h.startsWith('system-controls-')) {
    return `/registry/${h.slice('system-controls-'.length)}?tab=controls`
  }
  if (h === 'controls') return '/controls'
  if (h.startsWith('control-detail-')) return `/controls/${h.slice('control-detail-'.length)}`
  if (h === 'policies') return '/policies'
  if (h.startsWith('policy-detail-')) return `/policies/${h.slice('policy-detail-'.length)}`
  if (h === 'org' || h === 'organisation' || h === 'organization') return '/organisation'
  if (h === 'integrations') return '/integrations'
  if (h === 'settings') return '/settings'
  if (h === 'users') return '/users'
  if (h === 'billing') return '/billing'
  if (h === 'plans') return '/plans'
  if (h === 'alerts' || h === 'notifications') return '/alerts'
  if (h === 'reports') return '/reports'
  if (h === 'audit-log' || h === 'monitoring') return '/monitoring'
  if (h === 'api-keys') return '/api-keys'
  return '/registry'
}
