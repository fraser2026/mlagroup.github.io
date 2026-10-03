import { sb } from './supabase'

/** Default draft revision when the title is new in the org. */
export const DEFAULT_DRAFT_VERSION = '0.1'

/** Trim and collapse internal whitespace (display / save). Does not case-fold. */
export function trimPolicyTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ')
}

/** Normalize policy title for uniqueness comparisons (trim + case-fold). */
export function normalizePolicyTitle(title: string): string {
  return trimPolicyTitle(title).toLowerCase()
}

/**
 * Loose stem for near-duplicate detection (not uniqueness).
 * Strips a trailing "policy" word and punctuation so
 * "Vendor AI Governance" ≈ "Vendor AI Governance Policy".
 */
export function policyTitleStem(title: string): string {
  return normalizePolicyTitle(title)
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\bpolic(?:y|ies)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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
  let candidate = bumpPolicyVersion(currentVersion.trim() || DEFAULT_DRAFT_VERSION)
  for (let i = 0; i < 64; i += 1) {
    if (!used.has(candidate)) return candidate
    candidate = bumpPolicyVersion(candidate)
  }
  return `${Date.now()}.0`
}

/**
 * Prefill version from org lineage for a title.
 * New title → `0.1`. Existing active title → next free revision after the highest numeric sibling.
 */
export function suggestVersionForTitleLineage(takenVersions: Iterable<string>): string {
  const used = [...takenVersions].map((v) => v.trim()).filter(Boolean)
  if (!used.length) return DEFAULT_DRAFT_VERSION

  let best: PolicyVersionParts | null = null
  let bestRaw = DEFAULT_DRAFT_VERSION
  for (const raw of used) {
    const parts = parsePolicyVersion(raw)
    if (!parts) continue
    if (
      !best ||
      parts.major > best.major ||
      (parts.major === best.major && parts.minor > best.minor) ||
      (parts.major === best.major &&
        parts.minor === best.minor &&
        (parts.patch ?? -1) > (best.patch ?? -1))
    ) {
      best = parts
      bestRaw = raw
    }
  }
  return suggestNextPolicyVersion(best ? bestRaw : DEFAULT_DRAFT_VERSION, used)
}

export type PolicyTitleCatalogEntry = {
  id: string
  title: string
  version: string
  published: boolean
}

/** Active org policies for title lineage / near-match suggestions. */
export async function listActivePolicyTitleCatalog(
  orgId: string,
  excludeId?: string | null,
): Promise<PolicyTitleCatalogEntry[]> {
  let query = sb
    .from('policy_documents')
    .select('id,title,version,published_at')
    .eq('org_id', orgId)
    .eq('is_active', true)

  if (excludeId) {
    query = query.neq('id', excludeId)
  }

  const { data, error } = await query
  if (error) {
    console.warn('listActivePolicyTitleCatalog', error.message)
    return []
  }

  return (data || [])
    .map((row) => ({
      id: String(row.id),
      title: String(row.title || '').trim(),
      version: String(row.version || '').trim(),
      published: Boolean(row.published_at),
    }))
    .filter((row) => row.title)
}

/**
 * Suggest a canonical existing title when the candidate is an exact CI match
 * or a near-duplicate stem (e.g. missing trailing "Policy"). Never auto-merges.
 */
export function suggestCanonicalTitle(
  candidate: string,
  catalog: Iterable<Pick<PolicyTitleCatalogEntry, 'title'>>,
): string | null {
  const trimmed = trimPolicyTitle(candidate)
  if (!trimmed) return null
  const norm = normalizePolicyTitle(trimmed)
  const stem = policyTitleStem(trimmed)
  if (!stem) return null

  let exact: string | null = null
  let near: string | null = null
  let nearLen = -1

  for (const row of catalog) {
    const title = trimPolicyTitle(row.title)
    if (!title) continue
    const rowNorm = normalizePolicyTitle(title)
    if (rowNorm === norm) {
      // Prefer existing casing / spelling when it differs only by case/spacing.
      if (title !== trimmed) exact = title
      continue
    }
    if (policyTitleStem(title) === stem && title.length > nearLen) {
      near = title
      nearLen = title.length
    }
  }

  return exact || near
}

/** Versions already taken by the same title (CI) in a catalog. */
export function versionsForTitle(
  catalog: Iterable<Pick<PolicyTitleCatalogEntry, 'title' | 'version'>>,
  title: string,
): string[] {
  const norm = normalizePolicyTitle(title)
  if (!norm) return []
  return [...catalog]
    .filter((row) => normalizePolicyTitle(row.title) === norm)
    .map((row) => row.version.trim())
    .filter(Boolean)
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
