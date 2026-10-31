import type { StatusTone } from '../ui'
import { modelDisplayName } from './registry'
import { sb } from './supabase'

/**
 * Exact spend for metered requests. Below one cent the figure keeps three
 * significant digits so a $0.0000321 call never reads as $0.00.
 */
export function fmtUsdExact(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? parseFloat(value) : Number(value ?? 0)
  if (!Number.isFinite(n) || n === 0) return '$0.00'
  const sign = n < 0 ? '-' : ''
  const v = Math.abs(n)
  if (v >= 1) {
    return `${sign}$${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  const decimals = Math.min(8, Math.max(2, 2 - Math.floor(Math.log10(v))))
  const fixed = v.toFixed(decimals).replace(/0+$/, '')
  const [whole, frac = ''] = fixed.split('.')
  return `${sign}$${whole}.${frac.padEnd(2, '0')}`
}

/** Full stored precision (8 decimal places) for detail views and tooltips. */
export function fmtUsdFull(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? parseFloat(value) : Number(value ?? 0)
  return `$${(Number.isFinite(n) ? n : 0).toFixed(8)}`
}

export function prettyModel(provider: string, id?: string | null) {
  if (!id) return 'Model'
  const known = modelDisplayName(provider, id)
  if (known && known !== id) return known
  const parts = id.replace(/-\d{8}$/, '').split('-')
  const words: string[] = []
  const nums: string[] = []
  for (const p of parts) (/^\d+$/.test(p) ? nums : words).push(p)
  const name = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  return nums.length ? `${name} ${nums.join('.')}` : name
}

export type GatewayOutcome =
  | 'success'
  | 'blocked_dlp_request'
  | 'blocked_dlp_response'
  | 'rate_limited'
  | 'provider_error'
  | 'gateway_error'
  | 'client_aborted'
  | 'stream_error'

export type DlpFinding = {
  check?: 'REQUEST' | 'RESPONSE' | string
  profile?: { profile_id?: string; entry_ids?: string[] }
  policy_ids?: string[]
}

export type GatewayEvent = {
  id: string
  created_at: string
  org_id: string
  asset_id: string
  token_id?: string | null
  provider: string
  environment?: string | null
  route: string
  outcome: GatewayOutcome | string
  http_status?: number | null
  error_type?: string | null
  error_code?: string | null
  streamed?: boolean | null
  latency_ms?: number | null
  duration_ms?: number | null
  request_model?: string | null
  model?: string | null
  input_tokens?: number | null
  output_tokens?: number | null
  cache_write_5m_tokens?: number | null
  cache_write_1h_tokens?: number | null
  cache_read_tokens?: number | null
  thinking_tokens?: number | null
  web_search_requests?: number | null
  web_fetch_requests?: number | null
  code_execution_requests?: number | null
  service_tier?: string | null
  inference_geo?: string | null
  speed?: string | null
  cost_usd?: string | number | null
  cost_status?: string | null
  cost_breakdown?: {
    lines?: Record<string, number>
    notes?: string[]
    rate_basis?: string
    input_per_mtok?: number
    output_per_mtok?: number
    region_multiplier?: number
  } | null
  provider_request_id?: string | null
  aig_log_id?: string | null
  dlp_action?: 'FLAG' | 'BLOCK' | null
  dlp?: { action?: string; findings?: DlpFinding[] } | null
  content_captured?: boolean | null
}

export const GATEWAY_EVENT_COLUMNS =
  'id,created_at,org_id,asset_id,token_id,provider,environment,route,outcome,http_status,error_type,error_code,streamed,latency_ms,duration_ms,request_model,model,input_tokens,output_tokens,cache_write_5m_tokens,cache_write_1h_tokens,cache_read_tokens,thinking_tokens,web_search_requests,web_fetch_requests,code_execution_requests,service_tier,inference_geo,speed,cost_usd,cost_status,cost_breakdown,provider_request_id,aig_log_id,dlp_action,dlp,content_captured'

export type GatewaySummary = {
  since: string
  totals: {
    requests: number
    success: number
    flagged: number
    blocked: number
    rate_limited: number
    errors: number
    aborted: number
    fallback: number
    cost_usd: number
    cost_open: number
    input_tokens: number
    output_tokens: number
    cache_read_tokens: number
    cache_write_tokens: number
    latency_p50_ms: number | null
    latency_p95_ms: number | null
    last_request_at: string | null
  }
  daily: { day: string; requests: number; cost_usd: number; dlp: number; issues: number }[]
  models: { model: string; requests: number; cost_usd: number; input_tokens: number; output_tokens: number }[]
  assets: {
    asset_id: string
    name: string | null
    requests: number
    cost_usd: number
    dlp: number
    issues: number
    last_request_at: string
  }[]
  tokens: { token_id: string; requests: number; last_request_at: string }[]
  outcomes: Record<string, number>
}

export type GatewaySettings = {
  route_via_ai_gateway: boolean
  fail_mode: 'open' | 'closed' | string
  capture_content: boolean
  content_retention_days: number
  event_retention_days: number
}

export type EventFilter = 'all' | 'dlp' | 'issues'

/** Matches the summary's issue count: errors and rate limits, not DLP blocks or client cancellations. */
const ISSUE_OUTCOMES = ['provider_error', 'gateway_error', 'stream_error', 'rate_limited']

export const GATEWAY_WINDOWS = [
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
]

export function sinceIso(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

export async function loadGatewaySummary(orgId: string, assetId: string | null, days: number) {
  const { data, error } = await sb.rpc('gateway_usage_summary', {
    p_org_id: orgId,
    p_asset_id: assetId,
    p_since: sinceIso(days),
  })
  if (error) throw new Error(error.message)
  return data as GatewaySummary
}

export async function loadGatewayEvents(opts: {
  orgId: string
  assetId?: string | null
  days: number
  filter: EventFilter
  before?: string | null
  limit?: number
}) {
  let q = sb
    .from('gateway_request_events')
    .select(GATEWAY_EVENT_COLUMNS)
    .eq('org_id', opts.orgId)
    .gte('created_at', sinceIso(opts.days))
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 50)
  if (opts.assetId) q = q.eq('asset_id', opts.assetId)
  if (opts.before) q = q.lt('created_at', opts.before)
  if (opts.filter === 'dlp') q = q.not('dlp_action', 'is', null)
  if (opts.filter === 'issues') q = q.in('outcome', ISSUE_OUTCOMES)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data as GatewayEvent[]) || []
}

export async function loadGatewaySettings(orgId: string): Promise<GatewaySettings | null> {
  const { data } = await sb
    .from('org_gateway_settings')
    .select('route_via_ai_gateway,fail_mode,capture_content,content_retention_days,event_retention_days')
    .eq('org_id', orgId)
    .maybeSingle()
  return (data as GatewaySettings | null) || null
}

export type BudgetState = 'ok' | 'projected_over' | 'warn' | 'over'

export type BudgetRow = {
  id: string
  asset_id: string | null
  asset_name: string | null
  amount_usd: number
  warn_at_pct: number
  enforcement: string
  updated_at: string
  requests: number
  exact_usd: number
  estimated_usd: number
  spend_usd: number
  unpriced_requests: number
  used_pct: number
  remaining_usd: number
  projected_usd: number | null
  state: BudgetState
}

export type BudgetStatus = {
  as_of: string
  period_start: string
  period_end: string
  elapsed_fraction: number
  currency: 'USD'
  org_spend: {
    requests: number
    exact_usd: number
    estimated_usd: number
    spend_usd: number
    unpriced_requests: number
    projected_usd: number | null
  }
  budgets: BudgetRow[]
}

export async function loadBudgetStatus(orgId: string) {
  const { data, error } = await sb.rpc('gateway_budget_status', { p_org_id: orgId })
  if (error) throw new Error(error.message)
  return data as BudgetStatus
}

const BUDGET_STATE: Record<BudgetState, { label: string; tone: StatusTone }> = {
  ok: { label: 'On track', tone: 'ok' },
  projected_over: { label: 'Projected over', tone: 'warn' },
  warn: { label: 'Warning level reached', tone: 'warn' },
  over: { label: 'Over budget', tone: 'risk' },
}

export function budgetStateLabel(state: BudgetState) {
  return BUDGET_STATE[state]?.label || 'On track'
}

export function budgetStateTone(state: BudgetState): StatusTone {
  return BUDGET_STATE[state]?.tone || 'neutral'
}

/** Budget amounts are whole cents. */
export function fmtUsdBudget(value: number | string | null | undefined) {
  const n = typeof value === 'string' ? parseFloat(value) : Number(value ?? 0)
  return `$${(Number.isFinite(n) ? n : 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtPct(value: number | string | null | undefined) {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '0%'
  return `${n.toLocaleString('en-GB', { maximumFractionDigits: n > 0 && n < 1 ? 2 : 1 })}%`
}

const OUTCOME: Record<string, { label: string; tone: StatusTone }> = {
  success: { label: 'Completed', tone: 'ok' },
  blocked_dlp_request: { label: 'Blocked, prompt', tone: 'risk' },
  blocked_dlp_response: { label: 'Blocked, response', tone: 'risk' },
  rate_limited: { label: 'Rate limited', tone: 'warn' },
  provider_error: { label: 'Provider error', tone: 'risk' },
  gateway_error: { label: 'Gateway error', tone: 'risk' },
  client_aborted: { label: 'Cancelled by client', tone: 'neutral' },
  stream_error: { label: 'Stream error', tone: 'risk' },
}

export function outcomeLabel(outcome?: string | null) {
  return OUTCOME[outcome || '']?.label || (outcome || 'Unknown').replace(/_/g, ' ')
}

export function outcomeTone(outcome?: string | null): StatusTone {
  return OUTCOME[outcome || '']?.tone || 'neutral'
}

export function routeLabel(route?: string | null) {
  if (route === 'ai_gateway') return 'Cloudflare AI Gateway'
  if (route === 'direct') return 'Direct to provider'
  if (route === 'direct_fallback') return 'Direct, gateway unavailable'
  return 'Not sent'
}

const COST_STATUS: Record<string, { label: string; hint: string }> = {
  priced: { label: 'Exact', hint: 'Priced from provider-reported usage at list rates.' },
  partial: { label: 'Partial', hint: 'Code execution time is billed separately by the provider and is not included.' },
  unpriced: { label: 'Unpriced', hint: 'No verified list price for this model yet. RegAnchor never guesses a price.' },
  needs_reconciliation: {
    label: 'To reconcile',
    hint: 'Priority tier, region, cancellation or missing usage means the final figure comes from the provider cost report.',
  },
  not_billable: { label: 'Not billable', hint: 'The provider did not process this request.' },
  pending: { label: 'Pending', hint: 'Waiting for pricing.' },
}

export function costStatusLabel(status?: string | null) {
  return COST_STATUS[status || '']?.label || 'Pending'
}

export function costStatusHint(status?: string | null) {
  return COST_STATUS[status || '']?.hint || ''
}

const DLP_PROFILES: Record<string, string> = {
  'e91a2360-da51-4fdf-9711-bcdecd462614': 'Financial information',
  'd658f520-6ecb-4a34-a725-ba37243c2d28': 'National identifiers',
}

const DLP_ENTRIES: Record<string, string> = {
  '56a8c060-01bb-4f89-ba1e-3ad42770a342': 'American Express card number',
  '7f575e6d-039a-465e-85cf-175bda88d4f2': 'American Express text',
  '2d9c356d-b5a3-482a-b01e-0363e0de7458': 'Card CVV',
  '03ebabfd-ce7e-45ed-8061-65e28f0a6e53': 'Diners Club card number',
  '2f3657af-c39b-4899-9a98-22f7d187dd28': 'IBAN',
  '753a16f9-f533-4208-a5b8-6319b201e9fb': 'Mastercard card number',
  'ebcea2c4-335a-457c-853b-f7ae7cc74e07': 'Mastercard text',
  '3f5c4c83-f34c-4d17-81c7-3028385737b3': 'SWIFT code',
  'd1a84fde-c375-4d3c-8a27-8c4eaa33cf60': 'UnionPay card number',
  '6dbe5604-d3a3-4c3e-905c-57985704bea7': 'UnionPay text',
  '55ba2c6c-8ef4-4b2e-9148-e75e8b6ccac1': 'US ABA routing number',
  '5b1d5035-8c53-4bc9-a151-404eb32b34b4': 'Visa card number',
  'acf28d88-2daf-4bc4-aa36-5ac1fac0540a': 'Visa text',
  '01dff9ae-20e8-4b51-bb38-981c6e175530': 'Australia tax file number',
  '350cfd3d-b076-41be-af79-227043fc7b8b': 'Canada social insurance number',
  'c1da1616-7443-428c-a60e-050e36c3e1dd': 'France social security number',
  '50d0e227-2279-4a0e-af44-314070716c36': 'Hong Kong identity card number',
  '71a54796-ff76-41fb-977e-632e89bee3b1': 'Indonesia identity card number',
  'd57d8593-ab1e-4af1-8fb9-5fd7afe334b4': 'Malaysia identity card number',
  'd777d198-b1fa-4964-b1ff-99274d4626df': 'Philippines UMID number',
  '6caf79f0-086c-4a7c-b708-0d903c13c1a8': 'Singapore NRIC number',
  'ddc44eca-6e26-4d54-b799-8ed90aec851e': 'Taiwan national ID number',
  '500c27d5-db83-415c-a4a0-3f591153e7f1': 'Thailand identity card number',
  'c81bae8a-9426-4ecc-91c0-cd3144f40c1f': 'UK NHS number',
  '761adbab-d6de-4127-998a-12dc9be6fe6f': 'UK National Insurance number',
  '111b9d4b-a5c6-40f0-957d-9d53b25dd84a': 'US social security number',
  'aec08712-ee49-4109-9d9f-3b229c5b3dcd': 'US social security number text',
}

export function dlpProfileName(id?: string | null) {
  return DLP_PROFILES[id || ''] || 'Custom profile'
}

export function dlpEntryName(id?: string | null) {
  return DLP_ENTRIES[id || ''] || 'Custom detection'
}

/** Detection names across all findings, de-duplicated, in finding order. */
export function dlpDetections(dlp?: GatewayEvent['dlp']): string[] {
  const names: string[] = []
  for (const f of dlp?.findings || []) {
    const ids = f.profile?.entry_ids?.length ? f.profile.entry_ids : [null]
    for (const id of ids) {
      const name = id ? dlpEntryName(id) : dlpProfileName(f.profile?.profile_id)
      if (!names.includes(name)) names.push(name)
    }
  }
  return names
}

export function dlpLabel(e: Pick<GatewayEvent, 'dlp_action' | 'dlp'>) {
  if (!e.dlp_action) return ''
  const checks = new Set((e.dlp?.findings || []).map((f) => f.check))
  const where = checks.has('REQUEST') && checks.has('RESPONSE') ? 'prompt and response' : checks.has('RESPONSE') ? 'response' : 'prompt'
  return `${e.dlp_action === 'BLOCK' ? 'Blocked' : 'Flagged'} in ${where}`
}

export function fmtMs(ms?: number | null) {
  if (ms == null || !Number.isFinite(Number(ms))) return 'Not recorded'
  const v = Number(ms)
  if (v >= 10_000) return `${(v / 1000).toFixed(1)}s`
  if (v >= 1000) return `${(v / 1000).toFixed(2)}s`
  return `${Math.round(v)}ms`
}

export function fmtTimeExact(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function fmtTimeShort(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  if (sameDay) return time
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${time}`
}
