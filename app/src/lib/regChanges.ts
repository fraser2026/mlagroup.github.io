import type { StatusTone } from '../ui/StatusLabel'
import { sb } from './supabase'
import { controlCode } from './registry'

export type RegChangeKind = 'now_applies' | 'replaced' | 'repealed' | 'wording' | 'added'

export type RegChange = {
  requirement_key: string
  citation: string
  title: string
  change: RegChangeKind
  changed_on: string
  replaces: string | null
  replaced_by: string | null
  sections: { key: string; title: string; answers: number }[]
  controls: { control_number: number | null; reference: string | null; title: string }[]
  official_url: string | null
  assessed_on: string
  /** Paragraph citations folded into this article, e.g. "50(1)". */
  includes: string[]
}

export type HorizonItem = {
  requirement_key: string
  citation: string
  title: string
  summary: string
  applies_to: string[]
  effective_from: string
  scope: 'cited' | 'all_systems'
  assets: number
  official_url: string | null
}

export const CHANGE_LABELS: Record<RegChangeKind, { label: string; tone: StatusTone }> = {
  now_applies: { label: 'Now applies', tone: 'warn' },
  replaced: { label: 'Replaced', tone: 'warn' },
  repealed: { label: 'Repealed', tone: 'neutral' },
  wording: { label: 'Updated', tone: 'info' },
  added: { label: 'Newly cited', tone: 'info' },
}

const ROLE_LABELS: Record<string, string> = {
  provider: 'providers',
  deployer: 'deployers',
  controller: 'controllers',
  processor: 'processors',
  eu_financial_entity: 'EU financial entities',
  fca_firm: 'FCA-regulated firms',
  pra_firm: 'PRA-regulated firms',
  pra_bank: 'PRA-regulated banks',
}

export function labelRoles(roles: string[] | null | undefined) {
  const text = (roles || []).map((r) => ROLE_LABELS[r] || r.replace(/_/g, ' ')).join(', ')
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'All'
}

export function fmtRegDate(d: string | null | undefined) {
  if (!d) return ''
  return new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function joinList(items: string[]) {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** Plain sentence naming the answers and controls a change affects. */
export function describeImpact(c: RegChange) {
  const parts: string[] = []
  if (c.sections.length) {
    parts.push(
      joinList(
        c.sections.map((s) => `${s.title} (${s.answers} ${s.answers === 1 ? 'answer' : 'answers'})`),
      ),
    )
  }
  const codes = c.controls
    .map((k) => controlCode(k.control_number, k.reference))
    .filter(Boolean) as string[]
  if (codes.length) parts.push(`${codes.length === 1 ? 'control' : 'controls'} ${joinList(codes)}`)
  return parts.length ? `Affects ${parts.join(' and ')}.` : ''
}

/** Folds paragraph rows (Article 50(1)) into their article (Article 50) when both changed the same way. */
function foldParagraphs(rows: RegChange[]): RegChange[] {
  const byKey = new Map(rows.map((r) => [r.requirement_key, { ...r, includes: [] as string[] }]))
  const out: RegChange[] = []
  for (const r of byKey.values()) {
    const m = r.requirement_key.match(/^(.*?)(\(.+\))$/)
    const parent = m ? byKey.get(m[1]) : undefined
    if (parent && parent.change === r.change && parent.changed_on === r.changed_on) {
      parent.includes.push(r.citation.replace(/^.*?(\d+\w*\(.+\))$/, '$1'))
      const seen = new Set(parent.controls.map((k) => `${k.control_number}|${k.reference}|${k.title}`))
      for (const k of r.controls) {
        const id = `${k.control_number}|${k.reference}|${k.title}`
        if (!seen.has(id)) {
          parent.controls.push(k)
          seen.add(id)
        }
      }
      continue
    }
    out.push(r)
  }
  return out
}

export async function loadAssetRegChanges(systemId: string): Promise<RegChange[]> {
  const { data, error } = await sb.rpc('asset_regulatory_changes', { p_system_id: systemId })
  if (error || !data) return []
  return foldParagraphs(data as RegChange[])
}

export async function loadOrgHorizon(orgId: string): Promise<HorizonItem[]> {
  const { data, error } = await sb.rpc('org_regulatory_horizon', { p_org_id: orgId })
  if (error || !data) return []
  return data as HorizonItem[]
}
