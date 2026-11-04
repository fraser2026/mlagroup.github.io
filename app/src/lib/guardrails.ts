import type { StatusTone } from '../ui'
import { invokeEdge } from './edge'

/** Keys must match supabase/functions/_shared/guardrails.ts. */

export type GuardrailMode = 'off' | 'flag' | 'block'
export type AppliesTo = 'prompt' | 'response' | 'both'
export type GuardrailGroup = 'reganchor' | 'cloudflare' | 'more'

export type GuardrailDef = {
  key: string
  label: string
  line: string
  enforcedBy: 'reganchor' | 'cloudflare'
  /** Governance control (1 to 12) this guardrail produces evidence for. */
  evidence: number
  modes: GuardrailMode[]
  appliesTo: AppliesTo[]
  test: boolean
  group: GuardrailGroup
  /** Cloudflare guardrail code, shown beside the label. */
  code?: string
}

export const EVIDENCE_CONTROLS: Record<number, string> = {
  1: 'AI governance policy',
  2: 'AI system inventory',
  3: 'AI vendor governance',
  5: 'Human oversight framework',
  6: 'Transparency and user disclosure',
  7: 'Data governance and quality management',
  8: 'Model monitoring and performance management',
  9: 'Security and robustness testing',
  10: 'Incident and harm response process',
}

const FLAG_BLOCK: GuardrailMode[] = ['off', 'flag', 'block']
const BOTH: AppliesTo[] = ['prompt', 'response', 'both']

function content(n: number, label: string, line: string, evidence: number, group: GuardrailGroup, test = false): GuardrailDef {
  return {
    key: `content_s${n}`,
    label,
    line,
    enforcedBy: 'cloudflare',
    evidence,
    modes: FLAG_BLOCK,
    appliesTo: BOTH,
    test,
    group,
    code: `S${n}`,
  }
}

export const GUARDRAILS: GuardrailDef[] = [
  {
    key: 'agent_pause',
    label: 'Pause an agent',
    line: 'Refuse every request from one agent until it is resumed, for an incident or a review.',
    enforcedBy: 'reganchor',
    evidence: 10,
    modes: ['off', 'block'],
    appliesTo: ['prompt'],
    test: true,
    group: 'reganchor',
  },
  {
    key: 'registered_model',
    label: 'Registered model only',
    line: 'Each agent may only call the model recorded in its registry entry, plus any extra models you allow.',
    enforcedBy: 'reganchor',
    evidence: 2,
    modes: FLAG_BLOCK,
    appliesTo: ['prompt'],
    test: true,
    group: 'reganchor',
  },
  {
    key: 'blocked_models',
    label: 'Blocked models',
    line: 'Models no agent in the organisation may use, for example one that is too costly or not yet assessed.',
    enforcedBy: 'reganchor',
    evidence: 3,
    modes: FLAG_BLOCK,
    appliesTo: ['prompt'],
    test: true,
    group: 'reganchor',
  },
  {
    key: 'budgets',
    label: 'Budget limits',
    line: 'Refuse new requests once a monthly budget set to block is reached.',
    enforcedBy: 'reganchor',
    evidence: 8,
    modes: ['off', 'block'],
    appliesTo: ['prompt'],
    test: false,
    group: 'reganchor',
  },
  {
    key: 'custom_rules',
    label: 'Your own rules',
    line: 'Words, phrases or patterns your organisation does not allow in prompts, such as client account numbers.',
    enforcedBy: 'reganchor',
    evidence: 1,
    modes: FLAG_BLOCK,
    appliesTo: ['prompt'],
    test: true,
    group: 'reganchor',
  },
  {
    key: 'dlp_financial',
    label: 'Financial information',
    line: 'Payment card numbers and bank account details.',
    enforcedBy: 'cloudflare',
    evidence: 7,
    modes: FLAG_BLOCK,
    appliesTo: BOTH,
    test: true,
    group: 'cloudflare',
  },
  {
    key: 'dlp_identifiers',
    label: 'National identifiers',
    line: 'National ID numbers such as social security, national insurance and passport numbers.',
    enforcedBy: 'cloudflare',
    evidence: 7,
    modes: FLAG_BLOCK,
    appliesTo: BOTH,
    test: true,
    group: 'cloudflare',
  },
  {
    key: 'prompt_injection',
    label: 'Prompt injection',
    line: 'Attempts to override the agent\u2019s instructions or extract its system prompt.',
    enforcedBy: 'cloudflare',
    evidence: 9,
    modes: FLAG_BLOCK,
    appliesTo: ['prompt'],
    test: true,
    group: 'cloudflare',
    code: 'P1',
  },
  content(6, 'Specialised advice', 'Financial, medical or legal advice that should come from a qualified person.', 5, 'cloudflare', true),
  content(7, 'Privacy', 'Requests for, or disclosure of, personal information about individuals.', 7, 'cloudflare', true),
  content(5, 'Defamation', 'False statements that could damage the reputation of a person or a company.', 10, 'cloudflare', true),
  content(8, 'Intellectual property', 'Reproducing copyrighted or proprietary material.', 1, 'cloudflare', true),
  {
    key: 'rate_limit',
    label: 'Rate limit',
    line: 'Cap the number of requests across the organisation in a time window.',
    enforcedBy: 'cloudflare',
    evidence: 9,
    modes: ['off', 'block'],
    appliesTo: ['prompt'],
    test: false,
    group: 'cloudflare',
  },
  content(1, 'Violent crimes', 'Content that enables or encourages violent crime.', 10, 'more'),
  content(2, 'Non-violent crimes', 'Content that enables fraud, theft, hacking or other non-violent crime.', 10, 'more'),
  content(3, 'Sex-related crimes', 'Content that enables or encourages sex-related crime.', 10, 'more'),
  content(4, 'Child sexual exploitation', 'Any content that sexualises children.', 10, 'more'),
  content(9, 'Indiscriminate weapons', 'Content that enables chemical, biological, nuclear or explosive weapons.', 10, 'more'),
  content(10, 'Hate', 'Content that demeans people for a protected characteristic.', 10, 'more'),
  content(11, 'Suicide and self-harm', 'Content that encourages suicide or self-harm.', 10, 'more'),
  content(12, 'Sexual content', 'Sexually explicit content.', 10, 'more'),
  content(13, 'Elections', 'False information about voting, candidates or election processes.', 6, 'more'),
  content(14, 'Code interpreter abuse', 'Attempts to misuse code execution tools.', 9, 'more'),
]

export const GUARDRAIL_BY_KEY = new Map(GUARDRAILS.map((g) => [g.key, g]))

export const GUARDRAIL_GROUPS: { id: GuardrailGroup; label: string; line: string }[] = [
  {
    id: 'reganchor',
    label: 'RegAnchor gateway',
    line: 'Checked by RegAnchor before a request leaves for the provider. Takes effect at once.',
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare AI Gateway',
    line: 'Checked by your organisation\u2019s own Cloudflare AI Gateway on the prompt, the response or both. Content categories most relevant to financial services come first.',
  },
  { id: 'more', label: 'More categories', line: 'The remaining harmful content categories, also checked by Cloudflare.' },
]

export function enforcedByLabel(def: GuardrailDef) {
  return def.enforcedBy === 'reganchor' ? 'RegAnchor gateway' : 'Cloudflare AI Gateway'
}

export function evidenceLabel(def: GuardrailDef) {
  return `${def.evidence}. ${EVIDENCE_CONTROLS[def.evidence] || 'Governance control'}`
}

export const MODE_LABEL: Record<GuardrailMode, string> = { off: 'Off', flag: 'Flag', block: 'Block' }

export const APPLIES_LABEL: Record<AppliesTo, string> = {
  prompt: 'Prompts',
  response: 'Responses',
  both: 'Prompts and responses',
}

/** Label for a guardrail key recorded on a request, including keys with no row. */
export function guardrailLabel(key: string) {
  if (key === 'cloudflare_guardrail') return 'Cloudflare guardrail'
  return GUARDRAIL_BY_KEY.get(key)?.label || key.replace(/_/g, ' ')
}

export type GuardrailHit = {
  key: string
  action: 'FLAG' | 'BLOCK'
  check: 'REQUEST' | 'RESPONSE'
  source: 'reganchor' | 'cloudflare'
  detail?: string
}

export type GuardrailState = {
  key: string
  mode: GuardrailMode
  applies_to: AppliesTo
  config: { limit?: number; interval?: number }
  updated_at: string | null
  /** Data loss prevention flagged by the shared gateway before the organisation had its own. */
  inherited?: boolean
}

export type GuardrailAgent = { id: string; name: string; provider_slug: string | null; model_name: string | null }
export type BlockedModel = { id: string; model_key: string; model_id: string; created_at: string }
export type AllowedModel = BlockedModel & { asset_id: string }
export type CustomRule = { id: string; label: string; match_type: 'phrase' | 'pattern'; pattern: string; created_at: string }
export type AgentPause = { asset_id: string; reason: string; paused_at: string }
export type GuardrailCount = { flagged: number; blocked: number; last_at: string | null }

export type GuardrailsData = {
  can_manage: boolean
  guardrails: GuardrailState[]
  blocked_models: BlockedModel[]
  allowed_models: AllowedModel[]
  custom_rules: CustomRule[]
  pauses: AgentPause[]
  counts: Record<string, GuardrailCount>
  blocking_budgets: number
  agents: GuardrailAgent[]
  gateway: { own: boolean; routed: boolean }
  setup: { cloudflare: boolean; tests: boolean }
}

export type TestVerdict = 'blocked' | 'flagged' | 'allowed' | 'stopped_by_other' | 'error'

export type GuardrailTest = {
  key: string
  agent: { id: string; name: string }
  model: string
  prompt: string
  verdict: TestVerdict
  outcome: string
  http_status: number
  message: string | null
  event_id: string | null
  hits: GuardrailHit[]
  elapsed_ms: number
}

export const VERDICT: Record<TestVerdict, { label: string; tone: StatusTone }> = {
  blocked: { label: 'Blocked', tone: 'risk' },
  flagged: { label: 'Flagged', tone: 'warn' },
  allowed: { label: 'Allowed', tone: 'ok' },
  stopped_by_other: { label: 'Stopped by another guardrail', tone: 'warn' },
  error: { label: 'Did not complete', tone: 'risk' },
}

/** What a test should show for a setting: block expects blocked, flag expects flagged, off expects allowed. */
export function expectedVerdict(mode: GuardrailMode): TestVerdict {
  return mode === 'block' ? 'blocked' : mode === 'flag' ? 'flagged' : 'allowed'
}

export const GUARDRAIL_COUNT_DAYS = 30

export function guardrailsCall<T = { ok: true }>(
  action: string,
  orgId: string,
  accessToken: string,
  body: Record<string, unknown> = {},
) {
  return invokeEdge<T>('gateway-guardrails', { ...body, action, org_id: orgId }, accessToken)
}
