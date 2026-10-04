/**
 * Deterministic org fill for MLA policy drafts (Stage A).
 * Auto-fill what RegAnchor knows; never invent roles, timeframes, or tools.
 */

export type OrgFillContext = {
  orgName: string
  /** Human-readable draft-day date (en-GB), e.g. "3 October 2026". */
  effectiveDate: string
  /** Requesting member display name when known; null keeps role placeholders. */
  documentOwner: string | null
}

/** Draft-day default in organisation-facing British English. */
export function formatDraftEffectiveDate(d: Date = new Date()): string {
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/**
 * Substitute known facts into policy markdown.
 * Leaves unresolved [brackets] for client Review fields (Stage B).
 */
export function applyOrgFill(markdown: string, fill: OrgFillContext): string {
  if (!markdown) return markdown
  let out = markdown
  const org = (fill.orgName || '').trim()
  const date = (fill.effectiveDate || '').trim()
  const owner = (fill.documentOwner || '').trim()

  if (date) {
    out = out.replace(/\[Effective date\]/gi, date)
  }
  if (org) {
    out = out.replace(/\[Organisation name\]/gi, org)
    out = out.replace(/\[Organization name\]/gi, org)
    out = out.replace(/\[Company name\]/gi, org)
    out = out.replace(/\[Org name\]/gi, org)
  }
  if (owner) {
    out = out.replace(/\[Document owner\]/gi, owner)
    out = out.replace(/\[Policy owner\]/gi, owner)
    // Common catalogue placeholder when a real person is known — do not invent a role title.
    out = out.replace(/\[AI Governance Lead\]/g, owner)
  }
  return out
}

/** Prompt block: known facts only. */
export function orgFillPromptBlock(fill: OrgFillContext): string {
  const org = (fill.orgName || '').trim() || 'the organisation'
  const lines = [
    'KNOWN ORG FACTS (use these literally in the document channel; never invent other people, dates, tools, or timeframes):',
    `- Organisation name: ${org}`,
    `- Effective date (draft day default): ${fill.effectiveDate}`,
    '  Use this date in the document-control line and closing version line. Do not leave [Effective date] when using this default.',
  ]
  if (fill.documentOwner?.trim()) {
    lines.push(
      `- Document owner (requesting member): ${fill.documentOwner.trim()}`,
      '  Use this person where a document owner or AI Governance Lead name belongs. Do not invent other named contacts.',
    )
  } else {
    lines.push(
      '- Document owner: unknown. Keep square-bracket role placeholders such as [AI Governance Lead] — do not invent a name.',
    )
  }
  return lines.join('\n')
}
