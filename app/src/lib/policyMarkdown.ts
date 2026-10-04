import { markdownToHtml } from './tiptapMarkdown'

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Strip a leading ATX title that duplicates the policy title chrome. */
export function stripPolicyTitleMarkdown(md: string, title?: string | null): string {
  let text = String(md || '').replace(/\r\n/g, '\n').trim()
  if (!text) return ''
  if (title) {
    const titleRe = new RegExp('^#\\s+' + escapeRegExp(String(title)) + '\\s*(?:\\n+|$)', 'i')
    text = text.replace(titleRe, '')
  } else {
    text = text.replace(/^#\s+[^\n]+\n+/, '')
  }
  return text.trim()
}

/**
 * Render policy markdown for the published/detail read view.
 * Uses the same GFM → HTML path as the TipTap draft Editor (`marked` + normalize).
 */
export function renderPolicyMarkdown(md?: string | null, title?: string | null) {
  if (!md) return '<div class="empty">No content available.</div>'
  const text = stripPolicyTitleMarkdown(md, title)
  if (!text) return '<div class="empty">No content available.</div>'
  const html = markdownToHtml(text).trim()
  if (!html) return '<div class="empty">No content available.</div>'
  return `<div class="policy-doc">${html}</div>`
}

export const POLICY_CATS: Record<string, string> = {
  ai_governance: 'AI Governance',
  data_protection: 'Data Protection',
  acceptable_use: 'Acceptable Use',
  risk_management: 'Risk Management',
  security: 'Security',
  ethics: 'Ethics',
  other: 'Other',
}
