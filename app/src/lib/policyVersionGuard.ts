import { sb } from './supabase'

/** Normalize policy title for uniqueness comparisons (trim + case-fold). */
export function normalizePolicyTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase()
}

export type PolicyVersionParts = { major: number; minor: number; patch: number | null }

/** Parse `1`, `1.0`, `1.0.2` style revisions. Returns null if not numeric. */
export function parsePolicyVersion(version: string): PolicyVersionParts | null {
  const raw = version.trim()
  if (!raw) return null
  const m = raw.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/)
  if (!m) return null
  return {
    major: Number(m[1]),
    minor: m[2] != null ? Number(m[2]) : 0,
    patch: m[3] != null ? Number(m[3]) : null,
  }
}

export function formatPolicyVersion(parts: PolicyVersionParts): string {
  if (parts.patch != null) return `${parts.major}.${parts.minor}.${parts.patch}`
  return `${parts.major}.${parts.minor}`
}

/** Bump the least-significant numeric segment (patch if present, else minor). */
export function bumpPolicyVersion(version: string): string {
  const parts = parsePolicyVersion(version)
  if (!parts) {
    const base = version.trim() || '0.1'
    return `${base}.1`
  }
  if (parts.patch != null) {
    return formatPolicyVersion({ ...parts, patch: parts.patch + 1 })
  }
  return formatPolicyVersion({ ...parts, minor: parts.minor + 1 })
}

/**
 * Suggest the next free revision for a title, starting from a bump of `currentVersion`.
 * `taken` should be normalized version strings already used by active siblings.
 */
export function suggestNextPolicyVersion(currentVersion: string, taken: Iterable<string>): string {
  const used = new Set(
    [...taken].map((v) => v.trim()).filter(Boolean),
  )
  let candidate = bumpPolicyVersion(currentVersion.trim() || '0.1')
  for (let i = 0; i < 64; i += 1) {
    if (!used.has(candidate)) return candidate
    candidate = bumpPolicyVersion(candidate)
  }
  return `${Date.now()}.0`
}

export type PolicyTitleVersionConflict = {
  id: string
  title: string
  version: string
  published: boolean
}

export type PolicyTitleVersionLookup = {
  conflict: PolicyTitleVersionConflict | null
  /** All active versions for this title in the org (excluding excludeId). */
  titleVersions: string[]
}

/**
 * Preflight: another active row with same org + title + version?
 * Title match is case-insensitive / trim-normalized to match the DB unique index.
 */
export async function lookupPolicyTitleVersionConflict(args: {
  orgId: string
  title: string
  version: string
  excludeId?: string | null
}): Promise<PolicyTitleVersionLookup> {
  const title = args.title.trim()
  const version = args.version.trim() || '0.1'
  const norm = normalizePolicyTitle(title)
  if (!norm) {
    return { conflict: null, titleVersions: [] }
  }

  let query = sb
    .from('policy_documents')
    .select('id,title,version,published_at')
    .eq('org_id', args.orgId)
    .eq('is_active', true)
    .eq('version', version)

  if (args.excludeId) {
    query = query.neq('id', args.excludeId)
  }

  const { data, error } = await query
  if (error) {
    console.warn('lookupPolicyTitleVersionConflict', error.message)
    return { conflict: null, titleVersions: [] }
  }

  const conflictRow = (data || []).find(
    (row) => normalizePolicyTitle(String(row.title || '')) === norm,
  )

  // Sibling versions for suggest-next (same title, any version).
  let verQuery = sb
    .from('policy_documents')
    .select('id,title,version')
    .eq('org_id', args.orgId)
    .eq('is_active', true)

  if (args.excludeId) {
    verQuery = verQuery.neq('id', args.excludeId)
  }

  const { data: siblings, error: sibErr } = await verQuery
  if (sibErr) {
    console.warn('lookupPolicyTitleVersionConflict versions', sibErr.message)
  }

  const titleVersions = (siblings || [])
    .filter((row) => normalizePolicyTitle(String(row.title || '')) === norm)
    .map((row) => String(row.version || '').trim())
    .filter(Boolean)

  if (!conflictRow) {
    return { conflict: null, titleVersions }
  }

  return {
    conflict: {
      id: String(conflictRow.id),
      title: String(conflictRow.title || title),
      version: String(conflictRow.version || version),
      published: Boolean(conflictRow.published_at),
    },
    titleVersions,
  }
}

export function isPolicyUniqueViolation(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  if (err.code === '23505') return true
  const msg = (err.message || '').toLowerCase()
  return msg.includes('policy_documents_org_title_version_active') || msg.includes('duplicate key')
}
