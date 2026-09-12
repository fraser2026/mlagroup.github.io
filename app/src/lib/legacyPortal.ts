/** Same-origin legacy portal entry (parity bridge). */
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
