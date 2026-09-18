import { sb } from './supabase'

export const TIER_LABELS: Record<string, string> = {
  none: 'Unclassified',
  unclassified: 'Unclassified',
  minimal: 'Minimal',
  limited: 'Limited',
  high: 'High',
  unacceptable: 'Unacceptable',
}

export const LIFECYCLE_LABELS: Record<string, string> = {
  planned: 'Planned',
  development: 'Development',
  pilot: 'Pilot',
  production: 'Production',
  decommissioned: 'Decommissioned',
}

/** @deprecated Use LIFECYCLE_LABELS */
export const STATUS_LABELS = LIFECYCLE_LABELS

export const KIND_LABELS: Record<string, string> = {
  system: 'System',
  agent: 'Agent',
  model: 'Model',
  tool: 'Tool',
}

export const ASSESS_STATUS_LABELS: Record<string, string> = {
  submitted: 'Awaiting RegAnchor Review',
  in_review: 'Under Review',
  controls_issued: 'Controls Issued',
}

export const CTRL_STATUS_LABELS: Record<string, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  implemented: 'Implemented',
  verified: 'Verified',
}

export const PURPOSE_OPTIONS: { value: string; label: string; group?: string }[] = [
  { value: 'biometric_identification', label: 'Biometric identification', group: 'High risk (Annex III)' },
  { value: 'critical_infrastructure', label: 'Critical infrastructure management', group: 'High risk (Annex III)' },
  { value: 'education_access', label: 'Education and vocational training access', group: 'High risk (Annex III)' },
  { value: 'employment_management', label: 'Employment and worker management', group: 'High risk (Annex III)' },
  { value: 'essential_services_access', label: 'Access to essential services (credit, insurance)', group: 'High risk (Annex III)' },
  { value: 'law_enforcement', label: 'Law enforcement', group: 'High risk (Annex III)' },
  { value: 'migration_border', label: 'Migration and border control', group: 'High risk (Annex III)' },
  { value: 'justice_administration', label: 'Administration of justice', group: 'High risk (Annex III)' },
  { value: 'customer_chatbot', label: 'Customer-facing chatbot / virtual assistant', group: 'Limited risk' },
  { value: 'content_generation', label: 'Content generation (text, image, audio)', group: 'Limited risk' },
  { value: 'emotion_recognition', label: 'Emotion recognition', group: 'Limited risk' },
  { value: 'internal_automation', label: 'Internal process automation', group: 'Minimal risk' },
  { value: 'data_analytics', label: 'Data analytics and reporting', group: 'Minimal risk' },
  { value: 'other', label: 'Other (classify manually)', group: 'Minimal risk' },
]

export const PURPOSE_TIER_MAP: Record<string, string> = {
  biometric_identification: 'high',
  critical_infrastructure: 'high',
  education_access: 'high',
  employment_management: 'high',
  essential_services_access: 'high',
  law_enforcement: 'high',
  migration_border: 'high',
  justice_administration: 'high',
  customer_chatbot: 'limited',
  content_generation: 'limited',
  emotion_recognition: 'limited',
  internal_automation: 'minimal',
  data_analytics: 'minimal',
}

export const DELETE_REASON_OPTIONS = [
  'Registered by mistake',
  'Duplicate entry',
  'Replaced by another asset',
  'Demo or test asset',
  'No longer in use',
] as const

export const DEPLOYMENT_OPTIONS = [
  'planned',
  'development',
  'pilot',
  'production',
  'decommissioned',
] as const

export const DEPLOYMENT_FILTERS = ['all', 'production', 'pilot', 'development', 'planned'] as const

const OTHER_MODEL = { id: 'other', label: 'Other (specify in notes)' }

const ASSET_MODELS: Record<string, { id: string; label: string }[]> = {
  anthropic: [
    { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
    { id: 'claude-opus-5', label: 'Claude Opus 5' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    OTHER_MODEL,
  ],
  openai: [
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
    { id: 'gpt-5.4-pro', label: 'GPT-5.4 Pro' },
    OTHER_MODEL,
  ],
  google: [
    { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro' },
    { id: 'gemini-3.0-pro', label: 'Gemini 3.0 Pro' },
    { id: 'gemini-3.0-flash', label: 'Gemini 3.0 Flash' },
    OTHER_MODEL,
  ],
  bedrock: [
    { id: 'anthropic.claude-opus-5', label: 'Claude Opus 5 (Bedrock)' },
    { id: 'anthropic.claude-sonnet-5', label: 'Claude Sonnet 5 (Bedrock)' },
    { id: 'anthropic.claude-fable-5-1', label: 'Claude Fable 5.1 (Bedrock)' },
    { id: 'amazon.nova-2-pro', label: 'Amazon Nova 2 Pro' },
    { id: 'meta.llama-4-70b', label: 'Meta Llama 4 70B' },
    OTHER_MODEL,
  ],
  azure: [
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol (Microsoft Foundry)' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra (Microsoft Foundry)' },
    OTHER_MODEL,
  ],
  in_house: [
    { id: 'custom', label: 'Custom / proprietary model' },
    { id: 'not_applicable', label: 'Not applicable' },
  ],
  other: [OTHER_MODEL],
}

export type RegistryAsset = {
  id: string
  name: string
  asset_kind?: string | null
  risk_tier?: string | null
  risk_tier_rationale?: string | null
  lifecycle?: string | null
  description?: string | null
  provider_slug?: string | null
  model_name?: string | null
  vendor?: string | null
  department?: string | null
  system_owner?: string | null
  purpose_category?: string | null
  system_type?: string | null
  notes?: string | null
  updated_at?: string | null
  created_at?: string | null
  deleted_at?: string | null
  connection_status?: string | null
  /** Latest assessment overall_score (0-100), or null if not assessed */
  maturity_score?: number | null
}

export type AssetFormValues = {
  name: string
  asset_kind: string
  description: string
  provider_slug: string
  model_name: string
  vendor: string
  purpose_category: string
  risk_tier: string
  risk_tier_rationale: string
  lifecycle: string
  system_owner: string
  department: string
  notes: string
}

export type ProviderCatalogRow = {
  slug: string
  name: string
  connector_available?: boolean | null
  docs_url?: string | null
}

export type DeletePreview = {
  ok?: boolean
  error?: string
  system_name?: string
  requires_review?: boolean
  pending_request?: boolean
}

export type DeleteResult = {
  ok?: boolean
  error?: string
  mode?: string
  system_id?: string
}

const RA_LEVELS = [
  { code: 'L1', label: 'Initial', max: 34 },
  { code: 'L2', label: 'Aware', max: 54 },
  { code: 'L3', label: 'Defined', max: 69 },
  { code: 'L4', label: 'Structured', max: 79 },
  { code: 'L5', label: 'Managed', max: 87 },
  { code: 'L6', label: 'Optimised', max: 94 },
  { code: 'L7', label: 'Authoritative', max: 100 },
] as const

export function emptyAssetForm(): AssetFormValues {
  return {
    name: '',
    asset_kind: 'system',
    description: '',
    provider_slug: '',
    model_name: '',
    vendor: '',
    purpose_category: '',
    risk_tier: '',
    risk_tier_rationale: '',
    lifecycle: 'planned',
    system_owner: '',
    department: '',
    notes: '',
  }
}

export function formFromAsset(a: Partial<RegistryAsset>): AssetFormValues {
  return {
    name: a.name || '',
    asset_kind: a.asset_kind || 'system',
    description: a.description || '',
    provider_slug: a.provider_slug || '',
    model_name: a.model_name || '',
    vendor: a.vendor || '',
    purpose_category: a.purpose_category || '',
    risk_tier: a.risk_tier || '',
    risk_tier_rationale: a.risk_tier_rationale || '',
    lifecycle: a.lifecycle || 'planned',
    system_owner: a.system_owner || '',
    department: a.department || '',
    notes: a.notes || '',
  }
}

export function modelsForPlatform(slug?: string | null) {
  if (!slug) return []
  return ASSET_MODELS[slug] || []
}

export function modelDisplayName(platformSlug?: string | null, modelId?: string | null) {
  if (!modelId) return ''
  if (modelId === 'other') return OTHER_MODEL.label
  const row = modelsForPlatform(platformSlug).find((m) => m.id === modelId)
  return row ? row.label : modelId
}

export function notesRequired(platformSlug?: string | null, modelId?: string | null) {
  return platformSlug === 'other' || modelId === 'other'
}

export function deriveAssetSystemType(platformSlug?: string | null, vendor?: string | null) {
  if (platformSlug === 'in_house') return 'in_house'
  if (vendor) return 'third_party'
  return 'in_house'
}

/** Portal openAddSystem: professional → unlimited; free/essentials/other → 1. */
export function registryAssetLimit(plan?: string | null) {
  return (plan || 'free') === 'professional' ? 999 : 1
}

export function registryLimitMessage(plan?: string | null) {
  const orgPlan = plan || 'free'
  if (orgPlan === 'essentials') {
    return 'You have reached your Essentials plan limit of 1 AI asset. Upgrade for unlimited assets, multi-user access, and more.'
  }
  if (orgPlan === 'professional') {
    return 'Need more from your governance platform? Enterprise includes unlimited users, dedicated advisory, and more.'
  }
  return 'You have reached your free plan limit of 1 AI asset. Subscribe to unlock more assets, governance certification, and more.'
}

export function suggestedTierForPurpose(purpose?: string | null) {
  if (!purpose) return null
  return PURPOSE_TIER_MAP[purpose] || null
}

export function maturityLevel(score: number | null | undefined) {
  if (score === null || score === undefined || Number.isNaN(Number(score))) return null
  const s = Math.max(0, Math.min(100, Number(score)))
  return RA_LEVELS.find((l) => s <= l.max) || RA_LEVELS[RA_LEVELS.length - 1]
}

export function maturityLabel(score: number | null | undefined) {
  const lvl = maturityLevel(score)
  return lvl ? `${lvl.code} ${lvl.label}` : 'Not assessed'
}

/** Higher number = higher severity. Used for table sort, not display. */
export function riskSortRank(tier?: string | null) {
  const t = (tier || '').toLowerCase()
  if (t === 'unacceptable') return 4
  if (t === 'high') return 3
  if (t === 'limited') return 2
  if (t === 'minimal') return 1
  return 0
}

/** Connected sorts above not connected when descending. */
export function connectionSortRank(status?: string | null) {
  return status === 'connected' ? 1 : 0
}

export function labelTier(tier?: string | null) {
  if (!tier) return 'Unclassified'
  return TIER_LABELS[tier] || tier
}

export function labelLifecycle(lifecycle?: string | null) {
  if (!lifecycle) return 'Planned'
  return LIFECYCLE_LABELS[lifecycle] || lifecycle
}

/** @deprecated Use labelLifecycle */
export function labelStatus(status?: string | null) {
  return labelLifecycle(status)
}

export function labelKind(kind?: string | null) {
  if (!kind) return 'System'
  return KIND_LABELS[kind] || kind
}

export function labelPurpose(purpose?: string | null) {
  if (!purpose) return 'Not set'
  const row = PURPOSE_OPTIONS.find((p) => p.value === purpose)
  return row?.label || purpose.replace(/_/g, ' ')
}

/** Official model-provider display names (slug → brand casing). */
export const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  bedrock: 'AWS Bedrock',
  aws: 'AWS',
  google: 'Google',
  googlecloud: 'Google Cloud',
  gemini: 'Gemini',
  deepmind: 'DeepMind',
  /** Model provider surface (formerly Azure AI Studio / Azure OpenAI branding). */
  azure: 'Microsoft Foundry',
  azureai: 'Microsoft Foundry',
  microsoft: 'Microsoft',
  meta: 'Meta',
  huggingface: 'Hugging Face',
  groq: 'Groq',
  cerebras: 'Cerebras',
  cohere: 'Cohere',
  cursor: 'Cursor',
  bigquery: 'BigQuery',
  snowflake: 'Snowflake',
  databricks: 'Databricks',
  redshift: 'Redshift',
  postgres: 'Postgres',
  postgresql: 'Postgres',
  in_house: 'In-house',
  other: 'Other',
}

export function labelProvider(slug?: string | null, fallback?: string | null) {
  const s = (slug || '').trim()
  if (!s) return (fallback || '').trim() || 'Not set'
  const known = PROVIDER_LABELS[s.toLowerCase()]
  if (known) return known
  const fb = (fallback || '').trim()
  if (fb) return fb
  // Unknown slug with no vendor fallback: salesforce → Salesforce (never invent a mark).
  return s
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function labelAssessStatus(status?: string | null) {
  if (!status) return 'Unknown'
  return ASSESS_STATUS_LABELS[status] || status
}

export function labelCtrlStatus(status?: string | null) {
  if (!status) return 'Not Started'
  return CTRL_STATUS_LABELS[status] || status
}

/** Catalogue code, e.g. C5. */
export function controlCode(controlNumber?: string | number | null) {
  if (controlNumber == null || controlNumber === '') return null
  const n = String(controlNumber).replace(/^c/i, '')
  if (!n) return null
  return `C${n}`
}

/** Portal family label: System Controls / Organisation Controls / Assurance Controls. */
export function controlFamilyLabel(controlType?: string | null) {
  const t = (controlType || '').toLowerCase()
  if (t === 'organisation' || t === 'organization') return 'Organisation Controls'
  if (t === 'assurance') return 'Assurance Controls'
  if (t === 'system') return 'System Controls'
  return 'Controls'
}

/** Policy catalogue code from display order, e.g. P1. */
export function policyCode(displayOrder?: string | number | null, fallbackIndex?: number) {
  const n = Number(displayOrder)
  if (Number.isFinite(n) && n > 0) return `P${n}`
  if (typeof fallbackIndex === 'number' && fallbackIndex >= 0) return `P${fallbackIndex + 1}`
  return null
}

export function riskTone(tier?: string | null) {
  if (tier === 'high' || tier === 'unacceptable') return 'risk' as const
  if (tier === 'limited') return 'warn' as const
  if (tier === 'minimal') return 'ok' as const
  return 'neutral' as const
}

export function connectionTone(status?: string | null) {
  if (status === 'connected') return 'ok' as const
  if (status === 'error') return 'risk' as const
  if (status === 'pending') return 'warn' as const
  return 'neutral' as const
}

export function connectionLabel(status?: string | null) {
  if (status === 'connected') return 'Connected'
  if (status === 'error') return 'Error'
  if (status === 'pending') return 'Pending'
  if (status === 'revoked') return 'Revoked'
  return 'Not connected'
}

export function ctrlTone(status?: string | null) {
  if (status === 'implemented' || status === 'verified') return 'ok' as const
  if (status === 'in_progress') return 'warn' as const
  if (status === 'overdue') return 'risk' as const
  return 'neutral' as const
}

export function assessTone(status?: string | null) {
  if (status === 'controls_issued') return 'ok' as const
  if (status === 'in_review') return 'warn' as const
  if (status === 'submitted') return 'warn' as const
  return 'neutral' as const
}

export function assetHaystack(a: RegistryAsset) {
  return [
    a.name,
    labelTier(a.risk_tier),
    labelLifecycle(a.lifecycle),
    a.provider_slug,
    a.model_name,
    a.description,
    a.system_owner,
    a.department,
    a.connection_status === 'connected' ? 'connected' : 'not connected',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function actorName(profile?: { full_name?: string | null } | null, email?: string | null) {
  return profile?.full_name || email?.split('@')[0] || 'Unknown'
}

export function assessmentUrl(systemId: string) {
  return `/legacy/assessment.html?system_id=${encodeURIComponent(systemId)}`
}

export function systemReportUrl(assessmentId: string) {
  return `/legacy/system-report.html?aid=${encodeURIComponent(assessmentId)}`
}

export function exportAssetsCsv(rows: RegistryAsset[]) {
  const cols = [
    'id',
    'name',
    'asset_kind',
    'provider_slug',
    'model_name',
    'risk_tier',
    'lifecycle',
    'system_owner',
    'department',
    'description',
  ] as const
  const header = cols.join(',')
  const body = rows
    .map((r) =>
      cols
        .map((c) => {
          const raw = String(r[c] ?? '')
          const escaped = raw.replace(/"/g, '""')
          return `"${escaped}"`
        })
        .join(','),
    )
    .join('\n')
  const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `reganchor-registry-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function buildAssetPayload(
  form: AssetFormValues,
  orgId: string,
  userId: string,
): Record<string, unknown> {
  const vendorVal = form.vendor.trim() || null
  const tier = form.risk_tier || null
  return {
    org_id: orgId,
    name: form.name.trim(),
    asset_kind: form.asset_kind || 'system',
    provider_slug: form.provider_slug,
    model_name: form.model_name,
    description: form.description.trim() || null,
    vendor: vendorVal,
    system_type: deriveAssetSystemType(form.provider_slug, vendorVal),
    purpose_category: form.purpose_category || null,
    risk_tier: tier,
    risk_tier_rationale: form.risk_tier_rationale.trim() || null,
    risk_tier_set_by: tier ? userId : null,
    lifecycle: form.lifecycle || 'planned',
    system_owner: form.system_owner.trim(),
    department: form.department.trim() || null,
    notes: form.notes.trim() || null,
  }
}

export function validateAssetForm(form: AssetFormValues): string | null {
  if (!form.name.trim() || !form.system_owner.trim()) return 'Name and owner are required.'
  if (!form.provider_slug || !form.model_name) return 'Provider and model are required.'
  if (notesRequired(form.provider_slug, form.model_name) && !form.notes.trim()) {
    return 'Please specify the provider or model in Notes when selecting Other.'
  }
  return null
}

export function auditChangesFromPatch(
  prev: RegistryAsset,
  patch: Record<string, unknown>,
  actor: string,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {
    _actor_name: actor,
    _system_name: prev.name,
  }
  for (const [k, newVal] of Object.entries(patch)) {
    const oldVal = (prev as Record<string, unknown>)[k]
    changes[k] = { old: oldVal == null ? '' : oldVal, new: newVal }
  }
  return changes
}

export function auditChangesFromUpdate(
  prev: Partial<RegistryAsset>,
  payload: Record<string, unknown>,
  actor: string,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {
    _actor_name: actor,
    _system_name: (payload.name as string) || prev.name || '',
  }
  for (const [k, newVal] of Object.entries(payload)) {
    if (k === 'org_id' || k === 'created_by' || k === 'risk_tier_set_by') continue
    const oldVal = (prev as Record<string, unknown>)[k]
    const oldS = oldVal == null ? '' : oldVal
    const newS = newVal == null ? '' : newVal
    if (String(oldS) !== String(newS)) changes[k] = { old: oldS, new: newS }
  }
  return changes
}

/** Portal requestRegistryAssessments: write assessment_requested only when latest is not already that. */
export async function requestRegistryAssessments(opts: {
  orgId: string
  userId: string
  actor: string
  systems: { id: string; name: string }[]
}): Promise<{ added: number; error?: string }> {
  const { orgId, userId, actor, systems } = opts
  if (!systems.length) return { added: 0 }
  const { data: existing, error: exErr } = await sb
    .from('registry_audit_log')
    .select('action,entity_id,created_at')
    .eq('org_id', orgId)
    .in('action', ['assessment_requested', 'assessment_submitted'])
    .in(
      'entity_id',
      systems.map((s) => s.id),
    )
    .order('created_at', { ascending: false })
    .limit(200)
  if (exErr) return { added: 0, error: exErr.message }

  const latest: Record<string, string> = {}
  for (const entry of existing || []) {
    if (!entry.entity_id || latest[entry.entity_id]) continue
    latest[entry.entity_id] = entry.action
  }
  const rows = systems
    .filter((s) => latest[s.id] !== 'assessment_requested')
    .map((s) => ({
      org_id: orgId,
      user_id: userId,
      action: 'assessment_requested',
      entity_type: 'ai_system',
      entity_id: s.id,
      changes: { _actor_name: actor, _system_name: s.name },
    }))
  if (!rows.length) return { added: 0 }
  const { error } = await sb.from('registry_audit_log').insert(rows)
  if (error) return { added: 0, error: error.message }
  return { added: rows.length }
}

export async function fetchDeletePreview(systemId: string): Promise<DeletePreview> {
  const { data, error } = await sb.rpc('get_registry_asset_delete_preview', { p_system_id: systemId })
  if (error) throw new Error(error.message)
  return (data || {}) as DeletePreview
}

export async function deleteRegistryAsset(opts: {
  systemId: string
  reason: string
  confirmName?: string | null
}): Promise<DeleteResult> {
  const { data, error } = await sb.rpc('delete_registry_asset', {
    p_system_id: opts.systemId,
    p_reason: opts.reason,
    p_confirm_name: opts.confirmName || null,
  })
  if (error) throw new Error(error.message)
  return (data || {}) as DeleteResult
}

export async function loadProviderCatalog(): Promise<ProviderCatalogRow[]> {
  const { data, error } = await sb
    .from('provider_catalog')
    .select('slug,name,connector_available,docs_url')
    .eq('is_active', true)
    .order('display_order')
  if (error) return []
  return ((data as ProviderCatalogRow[]) || []).map((p) => ({
    ...p,
    name: labelProvider(p.slug, p.name),
  }))
}

export function formatAuditPlain(
  entry: { action?: string | null; changes?: Record<string, unknown> | null; user_id?: string | null },
  namesMap: Record<string, string>,
): { who: string; text: string } {
  const c = (entry.changes || {}) as Record<string, unknown>
  const who =
    (c._is_mla ? 'RegAnchor' : null) ||
    namesMap[entry.user_id || ''] ||
    (typeof c._actor_name === 'string' ? c._actor_name : null) ||
    'System'
  const systemName = String(c._system_name || 'an AI asset')
  let text = (entry.action || '').replace(/_/g, ' ')
  switch (entry.action) {
    case 'system_created':
      text = `Registered new AI asset: ${c.name || systemName}`
      break
    case 'system_updated':
      text = formatSystemUpdatedPlain(c)
      break
    case 'system_deleted':
      text = `Removed ${systemName} from the registry`
      break
    case 'delete_requested':
      text = `Requested deletion of ${systemName}, pending RegAnchor review`
      break
    case 'assessment_requested':
      text = `Requested an assessment of ${systemName}`
      break
    case 'assessment_submitted':
      text = 'Submitted an assessment for review by RegAnchor'
      break
    case 'provider_connected':
      text = `Connected ${labelProvider(String(c.provider_slug || ''))} runtime API key for ${systemName}`
      break
    case 'provider_revoked':
      text = `Revoked ${labelProvider(String(c.provider_slug || ''))} connection for ${systemName}`
      break
    case 'provider_verified':
      text =
        c.verification_ok === false
          ? `Live API check failed for ${labelProvider(String(c.provider_slug || ''))} on ${systemName}`
          : `Live API check passed for ${labelProvider(String(c.provider_slug || ''))} on ${systemName}`
      break
    case 'provider_insights_refreshed':
      text = `Refreshed governance insights for ${systemName} (${c.window_days || 30}-day window)`
      break
    case 'control_updated':
      text = `Updated progress on ${c.control || 'a control'}`
      break
    case 'control_implemented':
      text = `Marked ${c.control || 'a control'} as implemented`
      break
    case 'mla_review_updated':
      text = `RegAnchor updated assessment status to ${c.status || 'updated'}`
      break
    default:
      break
  }
  return { who: String(who), text }
}

function formatSystemUpdatedPlain(c: Record<string, unknown>) {
  const parts: string[] = []
  const status = (c.lifecycle || c.deployment_status) as { old?: unknown; new?: unknown } | undefined
  if (status && typeof status === 'object' && ('new' in status || 'old' in status)) {
    if (status.new === 'decommissioned') parts.push('Marked as decommissioned')
    else if (status.old) {
      parts.push(
        `Changed lifecycle from ${labelLifecycle(String(status.old))} to ${labelLifecycle(String(status.new))}`,
      )
    } else parts.push(`Set lifecycle to ${labelLifecycle(String(status.new))}`)
  }
  const owner = c.system_owner as { old?: unknown; new?: unknown } | undefined
  if (owner && typeof owner === 'object' && ('new' in owner || 'old' in owner)) {
    if (owner.old) parts.push(`Reassigned owner from ${owner.old} to ${owner.new}`)
    else parts.push(`Assigned owner to ${owner.new}`)
  }
  const tier = c.risk_tier as { old?: unknown; new?: unknown } | undefined
  if (tier && typeof tier === 'object' && ('new' in tier || 'old' in tier)) {
    parts.push(
      `Reclassified from ${labelTier(tier.old == null || tier.old === '' ? null : String(tier.old))} to ${labelTier(String(tier.new))}`,
    )
  }
  for (const [k, d] of Object.entries(c)) {
    if (k.startsWith('_') || k === 'lifecycle' || k === 'deployment_status' || k === 'system_owner' || k === 'risk_tier') continue
    if (!d || typeof d !== 'object' || !(('old' in d) || ('new' in d))) continue
    const diff = d as { old?: unknown; new?: unknown }
    const from = diff.old == null || diff.old === '' ? 'not set' : String(diff.old)
    const to = diff.new == null || diff.new === '' ? 'not set' : String(diff.new)
    if (from === to) continue
    parts.push(`Updated ${k.replace(/_/g, ' ')} from ${from} to ${to}`)
  }
  return parts.length ? parts.join('. ') : 'Updated system details'
}

export function fmtProviderTokens(n: number | null | undefined) {
  const v = Number(n) || 0
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return v.toLocaleString('en-GB')
}

export function fmtProviderUsd(s: number | string | null | undefined) {
  const n = parseFloat(String(s ?? 0))
  const v = Number.isFinite(n) ? n : 0
  return `$${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export type ProviderInsights = {
  window_days?: number
  refreshed_at?: string
  scope?: string
  estimated_asset_usd?: number | string | null
  errors?: string[]
  usage?: {
    total_tokens?: number
    uncached_input_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_tokens?: number
    output_tokens?: number
    by_model?: { model?: string; total_tokens?: number }[]
  }
}

export function insightsUsageFetchFailed(insights?: ProviderInsights | null) {
  const errs = insights?.errors || []
  return errs.some((note) =>
    /Could not fetch usage report|Usage report is not available|Zero tokens are not confirmed usage/i.test(
      String(note || ''),
    ),
  )
}
