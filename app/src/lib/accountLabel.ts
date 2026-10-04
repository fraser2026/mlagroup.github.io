/** Sidebar / account chip: "Jessica Smith" → "Jessica S". */
export function sidebarAccountLabel(fullName?: string | null, email?: string | null): string {
  const parts = splitName(fullName)
  if (parts.length === 1) return parts[0]
  if (parts.length >= 2) {
    const last = parts[parts.length - 1]
    return `${parts[0]} ${last.charAt(0).toUpperCase()}`
  }
  const local = emailLocalPart(email)
  return local || 'Signed in'
}

/** Avatar initials: "Jessica Smith" → "JS"; email local-part fallback. */
export function accountInitials(fullName?: string | null, email?: string | null): string {
  const parts = splitName(fullName)
  if (parts.length >= 2) {
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
  }
  if (parts.length === 1) {
    const word = parts[0]
    return word.slice(0, Math.min(2, word.length)).toUpperCase()
  }
  const local = emailLocalPart(email) || 'U'
  const segs = local.split(/[._\-\s]+/).filter(Boolean)
  if (segs.length >= 2) {
    return (segs[0].charAt(0) + segs[1].charAt(0)).toUpperCase()
  }
  return local.slice(0, 2).toUpperCase()
}

export type AccountChip = {
  label: string
  initials: string
  /** True while profile/auth name is still loading — do not paint email fallback. */
  pending: boolean
}

const CHIP_CACHE_KEY = 'ra_account_chip'

type CachedChip = {
  userId: string
  label: string
  initials: string
}

/** Same-tab memory so remounts stay stable even before sessionStorage is available. */
let memoryChip: CachedChip | null = null

/**
 * Resolve sidebar label + initials without flashing the email local-part while
 * profile `full_name` (or auth metadata) is still loading.
 *
 * Priority: resolved name → cached prior chip for this user → quiet pending hold
 * → email local-part only after profile load confirms no name.
 */
export function resolveAccountChip(input: {
  userId?: string | null
  fullName?: string | null
  email?: string | null
  profileReady: boolean
}): AccountChip {
  const name = String(input.fullName || '').trim()
  if (name) {
    const chip = {
      label: sidebarAccountLabel(name, null),
      initials: accountInitials(name, null),
      pending: false,
    }
    rememberAccountChip(input.userId, chip)
    return chip
  }

  if (!input.profileReady) {
    const cached = readAccountChip(input.userId)
    if (cached) {
      return { label: cached.label, initials: cached.initials, pending: false }
    }
    return { label: '', initials: '', pending: true }
  }

  const chip = {
    label: sidebarAccountLabel(null, input.email),
    initials: accountInitials(null, input.email),
    pending: false,
  }
  rememberAccountChip(input.userId, chip)
  return chip
}

export function rememberAccountChip(
  userId: string | null | undefined,
  chip: { label: string; initials: string },
) {
  if (!userId) return
  if (!chip.label || !chip.initials) return
  const payload: CachedChip = {
    userId,
    label: chip.label,
    initials: chip.initials,
  }
  memoryChip = payload
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(CHIP_CACHE_KEY, JSON.stringify(payload))
  } catch {
    /* private mode / quota — ignore */
  }
}

export function readAccountChip(userId: string | null | undefined): CachedChip | null {
  if (!userId) return null
  if (memoryChip?.userId === userId && memoryChip.label && memoryChip.initials) {
    return memoryChip
  }
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(CHIP_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedChip
    if (!parsed || parsed.userId !== userId) return null
    if (!parsed.label || !parsed.initials) return null
    memoryChip = parsed
    return parsed
  } catch {
    return null
  }
}

export function clearAccountChipCache() {
  memoryChip = null
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(CHIP_CACHE_KEY)
  } catch {
    /* ignore */
  }
}

function splitName(fullName?: string | null): string[] {
  return String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

function emailLocalPart(email?: string | null): string {
  const raw = String(email || '').trim()
  if (!raw) return ''
  return raw.split('@')[0] || ''
}
