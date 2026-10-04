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
