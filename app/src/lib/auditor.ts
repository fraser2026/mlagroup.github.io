export const AUDITOR_SCOPE_KEYS = [
  'assets',
  'assessments',
  'policies',
  'controls',
  'frameworks',
  'evidence',
  'scores',
  'activity',
] as const

export type AuditorScopeKey = (typeof AUDITOR_SCOPE_KEYS)[number]

export type AuditorScopes = Record<AuditorScopeKey, boolean>

export const DEFAULT_AUDITOR_SCOPES: AuditorScopes = {
  assets: true,
  assessments: true,
  policies: true,
  controls: true,
  frameworks: true,
  evidence: true,
  scores: true,
  activity: false,
}

export type AuditorScopeCatalogItem = {
  key: AuditorScopeKey | string
  label: string
  description: string
  default?: boolean
}

export type AuditorToken = {
  id: string
  kind: 'share' | 'api'
  label: string
  token_prefix: string
  expires_at: string
  last_used_at?: string | null
  revoked_at?: string | null
  created_at: string
}

export type AuditorEngagement = {
  id: string
  name: string
  firm_name?: string | null
  contact_email?: string | null
  status: 'draft' | 'active' | 'completed' | 'revoked' | string
  window_start: string
  window_end: string
  scopes: Partial<AuditorScopes> | Record<string, boolean>
  created_at: string
  updated_at?: string
  revoked_at?: string | null
  completed_at?: string | null
  tokens?: AuditorToken[]
}

export function auditorShareUrl(token: string): string {
  if (typeof window === 'undefined') return `/auditor/${encodeURIComponent(token)}`
  return `${window.location.origin}/auditor/${encodeURIComponent(token)}`
}
