/** Shared person label helpers for sidebar, member pickers, and assignee menus. */

export type PersonName = {
  first_name?: string | null
  last_name?: string | null
  full_name?: string | null
  email?: string | null
}

/**
 * Primary people label: "First Last".
 * Never uses the email local-part when a real name exists.
 * When no name exists, returns the full email (not local-part) or fallback.
 */
export function personDisplayName(
  person?: PersonName | null,
  opts?: { fallback?: string },
): string {
  const named = structuredOrFullName(person)
  if (named) return named
  const email = String(person?.email || '').trim()
  if (email) return email
  return opts?.fallback || 'Unknown'
}

/** SelectMenu / assignee / owner picker label — same as personDisplayName. */
export function personPickerLabel(person?: PersonName | null): string {
  return personDisplayName(person, { fallback: 'Unknown' })
}

/** Sidebar / account chip: "Jessica Smith" → "Jessica S". */
export function sidebarAccountLabel(
  fullNameOrPerson?: string | PersonName | null,
  email?: string | null,
): string {
  const person = asPerson(fullNameOrPerson, email)
  const parts = nameParts(person)
  if (parts.length === 1) return parts[0]
  if (parts.length >= 2) {
    const last = parts[parts.length - 1]
    return `${parts[0]} ${last.charAt(0).toUpperCase()}`
  }
  const local = emailLocalPart(person.email)
  return local || 'Signed in'
}

/** Avatar initials: "Jessica Smith" → "JS"; email local-part fallback. */
export function accountInitials(
  fullNameOrPerson?: string | PersonName | null,
  email?: string | null,
): string {
  const person = asPerson(fullNameOrPerson, email)
  const parts = nameParts(person)
  if (parts.length >= 2) {
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
  }
  if (parts.length === 1) {
    const word = parts[0]
    return word.slice(0, Math.min(2, word.length)).toUpperCase()
  }
  const local = emailLocalPart(person.email) || 'U'
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
 * profile name (or auth metadata) is still loading.
 *
 * Priority: resolved name → cached prior chip for this user → quiet pending hold
 * → email local-part only after profile load confirms no name.
 */
export function resolveAccountChip(input: {
  userId?: string | null
  firstName?: string | null
  lastName?: string | null
  fullName?: string | null
  email?: string | null
  profileReady: boolean
}): AccountChip {
  const person: PersonName = {
    first_name: input.firstName,
    last_name: input.lastName,
    full_name: input.fullName,
    email: input.email,
  }
  const named = structuredOrFullName(person)
  if (named) {
    const chip = {
      label: sidebarAccountLabel(person),
      initials: accountInitials(person),
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

/** Compose full_name from first + last for writers / metadata. */
export function composeFullName(firstName?: string | null, lastName?: string | null): string {
  return [String(firstName || '').trim(), String(lastName || '').trim()].filter(Boolean).join(' ')
}

/** Split a free-text full name into first + remainder last. */
export function splitFullName(fullName?: string | null): { first_name: string; last_name: string } {
  const parts = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return { first_name: '', last_name: '' }
  if (parts.length === 1) return { first_name: parts[0], last_name: '' }
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') }
}

function asPerson(
  fullNameOrPerson?: string | PersonName | null,
  email?: string | null,
): PersonName {
  if (fullNameOrPerson && typeof fullNameOrPerson === 'object') {
    return {
      ...fullNameOrPerson,
      email: fullNameOrPerson.email ?? email,
    }
  }
  return { full_name: fullNameOrPerson || null, email }
}

function structuredOrFullName(person?: PersonName | null): string {
  const first = String(person?.first_name || '').trim()
  const last = String(person?.last_name || '').trim()
  if (first && last) return `${first} ${last}`
  if (first) return first
  if (last) return last

  const full = String(person?.full_name || '').trim()
  if (!full) return ''
  // Reject email local-part masquerading as a name
  const local = emailLocalPart(person?.email)
  if (local && full.toLowerCase() === local.toLowerCase()) return ''
  return full
}

function nameParts(person?: PersonName | null): string[] {
  const named = structuredOrFullName(person)
  return named.split(/\s+/).filter(Boolean)
}

function emailLocalPart(email?: string | null): string {
  const raw = String(email || '').trim()
  if (!raw) return ''
  return raw.split('@')[0] || ''
}
