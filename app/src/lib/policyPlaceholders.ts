/**
 * Stage B helpers: scan remaining [bracket] fields and apply human fills.
 * Skips markdown links/images: [label](url) / ![alt](url).
 */

const PLACEHOLDER_RE = /\[[^\[\]\n]+\](?![\(\[])/g

/** Unique placeholders in document order. */
export function listUniquePlaceholders(markdown: string): string[] {
  if (!markdown) return []
  const seen = new Set<string>()
  const ordered: string[] = []
  const re = new RegExp(PLACEHOLDER_RE.source, PLACEHOLDER_RE.flags)
  let match: RegExpExecArray | null
  while ((match = re.exec(markdown)) !== null) {
    const token = match[0]
    if (seen.has(token)) continue
    seen.add(token)
    ordered.push(token)
  }
  return ordered
}

/** Replace every exact instance of a placeholder token. */
export function replacePlaceholderAll(markdown: string, token: string, value: string): string {
  if (!markdown || !token) return markdown
  const next = value.trim()
  if (!next) return markdown
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return markdown.replace(new RegExp(escaped, 'g'), next)
}

/** Quiet label for the review list (strip brackets). */
export function placeholderLabel(token: string): string {
  const inner = token.replace(/^\[/, '').replace(/\]$/, '').trim()
  return inner || token
}
