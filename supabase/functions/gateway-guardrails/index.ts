/**
 * RegAnchor — Guardrails: one place to switch, test and prove every runtime control on the gateway.
 *
 * RegAnchor-enforced: pause an agent, registered model only, blocked models, custom rules (budgets are
 * managed by gateway-budget). Cloudflare-enforced: data loss prevention, prompt injection, harmful
 * content and rate limit, configured on the organisation's own AI Gateway through the Cloudflare API.
 *
 * Members can list. Owners and admins change settings and run tests; every change and test is audited.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, getAuthedUser, json, parseUuid, writeAudit } from '../_shared/provider-connection.ts'
import {
  type AppliesTo,
  type GuardrailMode,
  GUARDRAIL_BY_KEY,
  GUARDRAILS,
  orgGatewayId,
  signCheck,
} from '../_shared/guardrails.ts'

const CF_ACCOUNT_ID = Deno.env.get('CF_AIG_ACCOUNT_ID') || '40074a03408bb2b183c964e22d1e2bea'
const CF_ADMIN_TOKEN = Deno.env.get('CF_AIG_ADMIN_TOKEN') || ''
const CHECK_SECRET = Deno.env.get('GATEWAY_CHECK_SECRET') || ''
const CF_GATEWAYS_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai-gateway/gateways`

const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const BEDROCK_MODEL_RE = /^(?:[a-z][a-z-]*\.)?anthropic\.[a-z0-9][a-z0-9.:_-]*$/i
const AWS_REGION_RE = /^[a-z]{2}(-[a-z]+)+-\d$/
const MAX_BLOCKED = 100
const MAX_RULES = 50
const DLP_KEYS = ['dlp_financial', 'dlp_identifiers']
/** Settings changed with their own actions, not with set. */
const NOT_SETTABLE = new Set(['agent_pause', 'budgets'])

type Role = 'owner' | 'admin' | 'member' | string

type GuardrailRow = {
  key: string
  mode: GuardrailMode
  applies_to: AppliesTo
  config: Record<string, unknown>
  updated_at: string | null
  inherited?: boolean
}

type GatewaySettingsRow = {
  cf_gateway_id: string | null
  route_via_ai_gateway: boolean
}

function bad(message: string, status = 400): never {
  throw new Response(JSON.stringify({ ok: false, error: message }), { status })
}

async function memberRole(supabase: SupabaseClient, userId: string, orgId: string): Promise<Role> {
  const { data } = await supabase
    .from('org_members')
    .select('role')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!data) bad('Access denied.', 403)
  return data.role as Role
}

function assertAdmin(role: Role) {
  if (role !== 'owner' && role !== 'admin') bad('Only organisation owners and admins can change or test guardrails.', 403)
}

async function loadAgent(supabase: SupabaseClient, orgId: string, assetId: string) {
  const { data } = await supabase
    .from('ai_systems')
    .select('id,org_id,name,provider_slug,model_name')
    .eq('id', assetId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!data || data.org_id !== orgId) bad('Agent not found in this organisation.', 404)
  return data as { id: string; org_id: string; name: string; provider_slug: string | null; model_name: string | null }
}

async function loadSettings(supabase: SupabaseClient, orgId: string): Promise<GatewaySettingsRow> {
  const { data } = await supabase
    .from('org_gateway_settings')
    .select('cf_gateway_id,route_via_ai_gateway')
    .eq('org_id', orgId)
    .maybeSingle()
  return { cf_gateway_id: data?.cf_gateway_id || null, route_via_ai_gateway: data?.route_via_ai_gateway === true }
}

async function loadRows(supabase: SupabaseClient, orgId: string): Promise<GuardrailRow[]> {
  const { data, error } = await supabase
    .from('org_guardrails')
    .select('key,mode,applies_to,config,updated_at')
    .eq('org_id', orgId)
  if (error) throw new Error('Could not read guardrails.')
  return (data || []) as GuardrailRow[]
}

/**
 * Settings as enforced. An organisation on the shared gateway with routing on already has data loss
 * prevention flagged on prompts and responses, so those rows show as flag until it gets its own gateway.
 */
function effectiveRows(rows: GuardrailRow[], settings: GatewaySettingsRow): GuardrailRow[] {
  const byKey = new Map(rows.map((r) => [r.key, r]))
  const sharedDlp = !settings.cf_gateway_id && settings.route_via_ai_gateway
  return GUARDRAILS.filter((g) => !NOT_SETTABLE.has(g.key)).map((g) => {
    const row = byKey.get(g.key)
    if (row) return row
    if (sharedDlp && DLP_KEYS.includes(g.key)) {
      return { key: g.key, mode: 'flag', applies_to: 'both', config: {}, updated_at: null, inherited: true }
    }
    return { key: g.key, mode: 'off', applies_to: g.appliesTo.includes('both') ? 'both' : g.appliesTo[0], config: {}, updated_at: null }
  })
}

// ---------------------------------------------------------------------------
// Cloudflare AI Gateway
// ---------------------------------------------------------------------------

async function cfRequest(method: string, path: string, body?: unknown) {
  const res = await fetch(`${CF_GATEWAYS_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${CF_ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const data = await res.json().catch(() => ({})) as { success?: boolean; errors?: Array<{ code?: number; message?: string }> }
  return { status: res.status, ok: res.ok && data.success !== false, data }
}

function cloudflareConfig(rows: GuardrailRow[]) {
  const guardrails: { prompt: Record<string, string>; response: Record<string, string> } = { prompt: {}, response: {} }
  const policies: Array<Record<string, unknown>> = []
  let rate: { limit: number; interval: number } | null = null
  for (const row of rows) {
    const def = GUARDRAIL_BY_KEY.get(row.key)
    if (!def || def.source !== 'cloudflare' || row.mode === 'off') continue
    const action = row.mode === 'block' ? 'BLOCK' : 'FLAG'
    const onPrompt = row.applies_to !== 'response'
    const onResponse = row.applies_to !== 'prompt'
    if (def.cfCategory) {
      if (onPrompt) guardrails.prompt[def.cfCategory] = action
      if (onResponse && def.cfCategory !== 'P1') guardrails.response[def.cfCategory] = action
    } else if (def.dlpProfile) {
      policies.push({
        id: `reganchor-${row.key.replace(/_/g, '-')}`,
        enabled: true,
        action,
        profiles: [def.dlpProfile],
        check: [...(onPrompt ? ['REQUEST'] : []), ...(onResponse ? ['RESPONSE'] : [])],
      })
    } else if (row.key === 'rate_limit') {
      rate = { limit: Number(row.config.limit) || 600, interval: Number(row.config.interval) || 60 }
    }
  }
  return {
    authentication: true,
    collect_logs: true,
    cache_ttl: 0,
    cache_invalidate_on_update: false,
    rate_limiting_limit: rate ? rate.limit : null,
    rate_limiting_interval: rate ? rate.interval : null,
    rate_limiting_technique: rate ? 'sliding' : null,
    guardrails,
    dlp: { enabled: policies.length > 0, policies },
  }
}

/**
 * Applies the organisation's Cloudflare-enforced guardrails to its own AI Gateway, creating it on first
 * use. Once an organisation has its own gateway it keeps it, so switching everything off is exact.
 */
async function syncCloudflare(supabase: SupabaseClient, orgId: string, userId: string): Promise<string | null> {
  let settings = await loadSettings(supabase, orgId)
  if (!settings.cf_gateway_id && settings.route_via_ai_gateway) {
    // Keep the shared gateway's data loss prevention flags when moving to the organisation's own gateway.
    await supabase.from('org_guardrails').upsert(
      DLP_KEYS.map((key) => ({ org_id: orgId, key, mode: 'flag', applies_to: 'both', updated_by: userId })),
      { onConflict: 'org_id,key', ignoreDuplicates: true },
    )
  }
  const rows = await loadRows(supabase, orgId)
  const anyOn = rows.some((r) => GUARDRAIL_BY_KEY.get(r.key)?.source === 'cloudflare' && r.mode !== 'off')
  if (!settings.cf_gateway_id && !anyOn) return null
  if (!CF_ADMIN_TOKEN) bad('Cloudflare guardrails are not set up yet. Ask RegAnchor support to finish setup.', 503)

  const id = settings.cf_gateway_id || orgGatewayId(orgId)
  const config = cloudflareConfig(rows)
  const existing = await cfRequest('GET', `/${id}`)
  const saved = existing.status === 404
    ? await cfRequest('POST', '', { id, ...config })
    : existing.ok
      ? await cfRequest('PUT', `/${id}`, config)
      : existing
  if (!saved.ok) {
    console.error('cloudflare gateway sync failed', saved.status, JSON.stringify(saved.data.errors || []).slice(0, 300))
    bad('Cloudflare did not accept the change. Nothing was switched; try again shortly.', 502)
  }

  if (settings.cf_gateway_id !== id || !settings.route_via_ai_gateway) {
    const { error } = await supabase.from('org_gateway_settings').upsert(
      { org_id: orgId, cf_gateway_id: id, route_via_ai_gateway: true, updated_at: new Date().toISOString(), updated_by: userId },
      { onConflict: 'org_id' },
    )
    if (error) throw new Error('Could not save the gateway setting.')
    settings = { cf_gateway_id: id, route_via_ai_gateway: true }
  }
  return id
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Rejects patterns with nested repetition, the usual cause of runaway regular expressions. */
function validatePattern(pattern: string) {
  if (/\([^)]*[+*}][^)]*\)\s*[+*{]/.test(pattern)) bad('That pattern repeats a repeated group. Simplify it, for example ACC-[0-9]{6}.')
  try {
    new RegExp(pattern, 'i')
  } catch {
    bad('That pattern is not a valid regular expression.')
  }
}

function parseConfig(key: string, raw: unknown): Record<string, unknown> {
  if (key !== 'rate_limit') return {}
  const value = (raw && typeof raw === 'object' ? raw : {}) as { limit?: unknown; interval?: unknown }
  const limit = Math.round(Number(value.limit))
  const interval = Math.round(Number(value.interval))
  if (!Number.isFinite(limit) || limit < 1 || limit > 100_000) bad('Set a request limit between 1 and 100,000.')
  if (![60, 300, 3600].includes(interval)) bad('Choose a window of one minute, five minutes or one hour.')
  return { limit, interval }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function geoPrefix(region: string): string {
  if (region.startsWith('eu-')) return 'eu'
  if (region.startsWith('us-')) return 'us'
  if (region.startsWith('ap-')) return 'apac'
  return 'global'
}

function bedrockId(family: 'haiku' | 'sonnet', region: string) {
  const id = family === 'haiku' ? 'anthropic.claude-haiku-4-5-20251001-v1:0' : 'anthropic.claude-sonnet-4-5-20250929-v1:0'
  return `${geoPrefix(region)}.${id}`
}

async function agentRegion(supabase: SupabaseClient, orgId: string, assetId: string): Promise<string | null> {
  const { data: connection } = await supabase
    .from('provider_connections')
    .select('org_aws_account_id,metadata')
    .eq('asset_id', assetId)
    .eq('provider_slug', 'bedrock')
    .neq('status', 'revoked')
    .maybeSingle()
  const fromConnection = (connection?.metadata as { aws?: { region?: string } } | null)?.aws?.region
  if (fromConnection && AWS_REGION_RE.test(fromConnection)) return fromConnection
  if (!connection?.org_aws_account_id) return null
  const { data: account } = await supabase
    .from('org_aws_accounts')
    .select('home_region')
    .eq('id', connection.org_aws_account_id)
    .eq('org_id', orgId)
    .maybeSingle()
  return account?.home_region && AWS_REGION_RE.test(account.home_region) ? account.home_region : null
}

/** The model the agent normally calls: its latest successful gateway model, else a Claude default. */
async function usualModel(
  supabase: SupabaseClient,
  agent: { id: string; provider_slug: string | null; model_name: string | null },
  region: string | null,
): Promise<string> {
  const onBedrock = agent.provider_slug === 'bedrock'
  const fits = (m: string | null | undefined) =>
    !!m && MODEL_ID_RE.test(m) && (onBedrock ? BEDROCK_MODEL_RE.test(m) : /^claude-/i.test(m))
  const { data } = await supabase
    .from('gateway_request_events')
    .select('request_model')
    .eq('asset_id', agent.id)
    .eq('outcome', 'success')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (fits(data?.request_model)) return data!.request_model as string
  if (fits(agent.model_name)) return agent.model_name as string
  return onBedrock ? bedrockId('haiku', region || 'eu-west-2') : 'claude-haiku-4-5'
}

type TestVerdict = 'blocked' | 'flagged' | 'allowed' | 'stopped_by_other' | 'error'

function verdictFor(key: string, outcome: string, hits: Array<{ key?: string; action?: string }>): TestVerdict {
  const own = hits.filter((h) => h.key === key)
  if (own.some((h) => h.action === 'BLOCK')) return 'blocked'
  if (own.some((h) => h.action === 'FLAG')) return 'flagged'
  // Past every guardrail; a provider refusal after that is reported alongside, not as a guardrail result.
  if (outcome === 'success' || outcome === 'provider_error' || outcome === 'stream_error') return 'allowed'
  if (outcome.startsWith('blocked_') || outcome === 'rate_limited') return 'stopped_by_other'
  return 'error'
}

async function runTest(
  supabase: SupabaseClient,
  orgId: string,
  key: string,
  assetId: string,
  sample: string,
) {
  const def = GUARDRAIL_BY_KEY.get(key)
  if (!def) bad('Unknown guardrail.')
  if (!def.testPrompt && key !== 'custom_rules') bad('This guardrail has no test.')
  if (!CHECK_SECRET) bad('Guardrail tests are not set up yet. Ask RegAnchor support to finish setup.', 503)

  const agent = await loadAgent(supabase, orgId, assetId)
  if (agent.provider_slug !== 'anthropic' && agent.provider_slug !== 'bedrock') {
    bad('Tests run through the RegAnchor gateway, which this agent does not use yet. Pick an Anthropic or Amazon Bedrock agent.')
  }
  const onBedrock = agent.provider_slug === 'bedrock'
  const region = onBedrock ? await agentRegion(supabase, orgId, agent.id) : null
  let model = await usualModel(supabase, agent, region)
  let prompt = def.testPrompt || ''

  if (key === 'registered_model') {
    const isHaiku = /haiku/i.test(model)
    model = onBedrock ? bedrockId(isHaiku ? 'sonnet' : 'haiku', region || 'eu-west-2') : isHaiku ? 'claude-sonnet-4-5' : 'claude-haiku-4-5'
  } else if (key === 'blocked_models') {
    const { data: blocked } = await supabase
      .from('gateway_blocked_models')
      .select('model_key,model_id')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (!blocked) bad('Add a model to the blocked list first, then test it.')
    model = onBedrock
      ? BEDROCK_MODEL_RE.test(blocked.model_id) ? blocked.model_id : `anthropic.${blocked.model_key}`
      : blocked.model_id
    if (onBedrock && !BEDROCK_MODEL_RE.test(model)) {
      bad(`${blocked.model_id} is not a Claude model on Amazon Bedrock, so this agent cannot send it. Test with an Anthropic agent.`)
    }
  } else if (key === 'custom_rules') {
    if (sample) {
      prompt = sample
    } else {
      const { data: rule } = await supabase
        .from('gateway_custom_rules')
        .select('pattern,match_type')
        .eq('org_id', orgId)
        .eq('match_type', 'phrase')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (!rule) bad('Enter some text to test against your rules.')
      prompt = `Please check this note: ${rule.pattern}`
    }
  }

  const body = JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: prompt }] })
  const started = Date.now()
  let res: Response
  try {
    res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/gateway-anthropic`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-reganchor-check': await signCheck(CHECK_SECRET, agent.id, body),
      },
      body,
      signal: AbortSignal.timeout(45_000),
    })
  } catch {
    bad('The gateway did not respond in time. Try again shortly.', 504)
  }
  const elapsedMs = Date.now() - started
  const text = await res.text()
  let message: string | null = null
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } }
    message = parsed.error?.message ? String(parsed.error.message).slice(0, 400) : null
  } catch {
    // not JSON
  }
  const eventId = res.headers.get('x-reganchor-event-id')

  let event: { outcome: string; guardrail_hits: unknown; http_status: number | null } | null = null
  if (eventId) {
    for (let i = 0; i < 8 && !event; i++) {
      const { data } = await supabase
        .from('gateway_request_events')
        .select('outcome,guardrail_hits,http_status')
        .eq('id', eventId)
        .maybeSingle()
      if (data) event = data
      else await new Promise((r) => setTimeout(r, 500))
    }
  }
  const outcome = event?.outcome || (res.ok ? 'success' : 'gateway_error')
  const hits = Array.isArray(event?.guardrail_hits) ? event!.guardrail_hits as Array<{ key?: string; action?: string }> : []
  return {
    key,
    agent: { id: agent.id, name: agent.name },
    model,
    prompt,
    verdict: verdictFor(key, outcome, hits),
    outcome,
    http_status: res.status,
    message,
    event_id: eventId,
    hits,
    elapsed_ms: elapsedMs,
  }
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  try {
    const { user, supabase } = await getAuthedUser(req)
    const body = await req.json().catch(() => ({}))
    const orgId = parseUuid(body.org_id, 'Organisation')
    const action = String(body.action || '').trim().toLowerCase()
    const role = await memberRole(supabase, user.id, orgId)

    if (action === 'list') {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
      const [settings, rows, blocked, allowed, rules, pauses, counts, budgets, agents] = await Promise.all([
        loadSettings(supabase, orgId),
        loadRows(supabase, orgId),
        supabase.from('gateway_blocked_models').select('id,model_key,model_id,created_at').eq('org_id', orgId).order('created_at'),
        supabase.from('gateway_approved_models').select('id,asset_id,model_key,model_id,created_at').eq('org_id', orgId).order('created_at'),
        supabase.from('gateway_custom_rules').select('id,label,match_type,pattern,created_at').eq('org_id', orgId).order('created_at'),
        supabase.from('gateway_agent_pauses').select('asset_id,reason,paused_at').eq('org_id', orgId),
        supabase.rpc('gateway_guardrail_counts', { p_org_id: orgId, p_since: since }),
        supabase.from('gateway_budgets').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('enforcement', 'block'),
        supabase
          .from('ai_systems')
          .select('id,name,provider_slug,model_name')
          .eq('org_id', orgId)
          .is('deleted_at', null)
          .in('provider_slug', ['anthropic', 'bedrock'])
          .order('name'),
      ])
      return json({
        ok: true,
        can_manage: role === 'owner' || role === 'admin',
        guardrails: effectiveRows(rows, settings),
        blocked_models: blocked.data || [],
        allowed_models: allowed.data || [],
        custom_rules: rules.data || [],
        pauses: pauses.data || [],
        counts: counts.data || {},
        blocking_budgets: budgets.count || 0,
        agents: agents.data || [],
        gateway: { own: !!settings.cf_gateway_id, routed: settings.route_via_ai_gateway },
        setup: { cloudflare: CF_ADMIN_TOKEN.length > 0, tests: CHECK_SECRET.length > 0 },
      })
    }

    assertAdmin(role)

    if (action === 'set') {
      const key = String(body.key || '')
      const def = GUARDRAIL_BY_KEY.get(key)
      if (!def || NOT_SETTABLE.has(key)) bad('Unknown guardrail.')
      const mode = String(body.mode || '') as GuardrailMode
      if (!def.modes.includes(mode)) bad(`Choose ${def.modes.join(', ')}.`)
      const settings = await loadSettings(supabase, orgId)
      const previous = effectiveRows(await loadRows(supabase, orgId), settings).find((r) => r.key === key)!
      const appliesTo = (body.applies_to ? String(body.applies_to) : previous.applies_to) as AppliesTo
      if (!def.appliesTo.includes(appliesTo)) bad('Choose prompts, responses or both.')
      const config = mode === 'off' ? previous.config : parseConfig(key, body.config ?? previous.config)

      const { error } = await supabase.from('org_guardrails').upsert(
        { org_id: orgId, key, mode, applies_to: appliesTo, config, updated_at: new Date().toISOString(), updated_by: user.id },
        { onConflict: 'org_id,key' },
      )
      if (error) return json({ ok: false, error: 'Could not save the guardrail.' }, 500)

      if (def.source === 'cloudflare') {
        try {
          await syncCloudflare(supabase, orgId, user.id)
        } catch (syncError) {
          // Put the previous setting back so the switchboard matches what Cloudflare enforces.
          if (previous.updated_at || previous.inherited) {
            await supabase.from('org_guardrails').upsert(
              { org_id: orgId, key, mode: previous.mode, applies_to: previous.applies_to, config: previous.config },
              { onConflict: 'org_id,key' },
            )
          } else {
            await supabase.from('org_guardrails').delete().eq('org_id', orgId).eq('key', key)
          }
          throw syncError
        }
      }

      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: 'gateway_guardrail_changed',
        entity_type: 'organisation',
        entity_id: orgId,
        changes: {
          guardrail: key,
          mode: { from: previous.mode, to: mode },
          applies_to: { from: previous.applies_to, to: appliesTo },
          ...(key === 'rate_limit' && mode !== 'off' ? { config } : {}),
        },
      })
      return json({ ok: true, guardrail: { key, mode, applies_to: appliesTo, config } })
    }

    if (action === 'pause_agent') {
      const agent = await loadAgent(supabase, orgId, parseUuid(body.asset_id, 'Agent'))
      const reason = String(body.reason || '').trim().slice(0, 500)
      if (reason.length < 3) bad('Give a short reason, for example "Incident review".')
      const { error } = await supabase.from('gateway_agent_pauses').upsert(
        { asset_id: agent.id, org_id: orgId, reason, paused_at: new Date().toISOString(), paused_by: user.id },
        { onConflict: 'asset_id' },
      )
      if (error) return json({ ok: false, error: 'Could not pause the agent.' }, 500)
      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: 'gateway_agent_paused',
        entity_type: 'ai_system',
        entity_id: agent.id,
        changes: { _system_name: agent.name, reason },
      })
      return json({ ok: true })
    }

    if (action === 'resume_agent') {
      const agent = await loadAgent(supabase, orgId, parseUuid(body.asset_id, 'Agent'))
      const { data, error } = await supabase
        .from('gateway_agent_pauses')
        .delete()
        .eq('asset_id', agent.id)
        .eq('org_id', orgId)
        .select('reason,paused_at')
        .maybeSingle()
      if (error) return json({ ok: false, error: 'Could not resume the agent.' }, 500)
      if (!data) return json({ ok: true })
      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: 'gateway_agent_resumed',
        entity_type: 'ai_system',
        entity_id: agent.id,
        changes: { _system_name: agent.name, paused_reason: data.reason, paused_at: data.paused_at },
      })
      return json({ ok: true })
    }

    if (action === 'block_model') {
      const modelId = String(body.model || '').trim()
      if (!MODEL_ID_RE.test(modelId)) bad('Enter a model ID, for example claude-opus-4-1.')
      const { data: key, error: keyError } = await supabase.rpc('gateway_model_key', { p_model: modelId })
      if (keyError || typeof key !== 'string' || !key) bad('RegAnchor could not read that model ID.')
      const { count } = await supabase
        .from('gateway_blocked_models')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
      if ((count || 0) >= MAX_BLOCKED) bad(`An organisation can block up to ${MAX_BLOCKED} models.`)
      const { data, error } = await supabase
        .from('gateway_blocked_models')
        .insert({ org_id: orgId, model_key: key, model_id: modelId, created_by: user.id })
        .select('id,model_key,model_id,created_at')
        .single()
      if (error?.code === '23505') return json({ ok: false, error: 'That model is already blocked.' }, 409)
      if (error || !data) return json({ ok: false, error: 'Could not block the model.' }, 500)
      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: 'gateway_model_blocked',
        entity_type: 'organisation',
        entity_id: orgId,
        changes: { model_id: modelId, model_key: key },
      })
      return json({ ok: true, blocked: data })
    }

    if (action === 'unblock_model') {
      const id = parseUuid(body.id, 'Blocked model')
      const { data, error } = await supabase
        .from('gateway_blocked_models')
        .delete()
        .eq('id', id)
        .eq('org_id', orgId)
        .select('model_key,model_id')
        .maybeSingle()
      if (error) return json({ ok: false, error: 'Could not remove the model.' }, 500)
      if (!data) return json({ ok: false, error: 'Blocked model not found.' }, 404)
      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: 'gateway_model_unblocked',
        entity_type: 'organisation',
        entity_id: orgId,
        changes: { model_id: data.model_id, model_key: data.model_key },
      })
      return json({ ok: true })
    }

    if (action === 'allow_model') {
      const agent = await loadAgent(supabase, orgId, parseUuid(body.asset_id, 'Agent'))
      const modelId = String(body.model || '').trim()
      if (!MODEL_ID_RE.test(modelId)) bad('Enter a model ID, for example claude-sonnet-4-5.')
      const { data: key, error: keyError } = await supabase.rpc('gateway_model_key', { p_model: modelId })
      if (keyError || typeof key !== 'string' || !key) bad('RegAnchor could not read that model ID.')
      const { count } = await supabase
        .from('gateway_approved_models')
        .select('id', { count: 'exact', head: true })
        .eq('asset_id', agent.id)
      if ((count || 0) >= 20) bad('An agent can have up to 20 extra models.')
      const { data, error } = await supabase
        .from('gateway_approved_models')
        .insert({ org_id: orgId, asset_id: agent.id, model_key: key, model_id: modelId, created_by: user.id })
        .select('id,asset_id,model_key,model_id,created_at')
        .single()
      if (error?.code === '23505') return json({ ok: false, error: 'That model is already allowed for this agent.' }, 409)
      if (error || !data) return json({ ok: false, error: 'Could not allow the model.' }, 500)
      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: 'gateway_model_approved',
        entity_type: 'ai_system',
        entity_id: agent.id,
        changes: { _system_name: agent.name, model_id: modelId, model_key: key },
      })
      return json({ ok: true, allowed: data })
    }

    if (action === 'disallow_model') {
      const id = parseUuid(body.id, 'Allowed model')
      const { data, error } = await supabase
        .from('gateway_approved_models')
        .delete()
        .eq('id', id)
        .eq('org_id', orgId)
        .select('asset_id,model_key,model_id')
        .maybeSingle()
      if (error) return json({ ok: false, error: 'Could not remove the model.' }, 500)
      if (!data) return json({ ok: false, error: 'Allowed model not found.' }, 404)
      const agent = await loadAgent(supabase, orgId, data.asset_id)
      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: 'gateway_model_approval_removed',
        entity_type: 'ai_system',
        entity_id: agent.id,
        changes: { _system_name: agent.name, model_id: data.model_id, model_key: data.model_key },
      })
      return json({ ok: true })
    }

    if (action === 'add_rule') {
      const label = String(body.label || '').trim()
      const matchType = body.match_type === 'pattern' ? 'pattern' : 'phrase'
      const pattern = String(body.pattern || '').trim()
      if (label.length < 2 || label.length > 80) bad('Name the rule in 2 to 80 characters.')
      if (pattern.length < 2 || pattern.length > 200) bad('Enter text of 2 to 200 characters to match.')
      if (matchType === 'pattern') validatePattern(pattern)
      const { count } = await supabase
        .from('gateway_custom_rules')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
      if ((count || 0) >= MAX_RULES) bad(`An organisation can have up to ${MAX_RULES} custom rules.`)
      const { data, error } = await supabase
        .from('gateway_custom_rules')
        .insert({ org_id: orgId, label, match_type: matchType, pattern, created_by: user.id })
        .select('id,label,match_type,pattern,created_at')
        .single()
      if (error || !data) return json({ ok: false, error: 'Could not add the rule.' }, 500)
      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: 'gateway_rule_added',
        entity_type: 'organisation',
        entity_id: orgId,
        changes: { label, match_type: matchType, pattern },
      })
      return json({ ok: true, rule: data })
    }

    if (action === 'remove_rule') {
      const id = parseUuid(body.id, 'Rule')
      const { data, error } = await supabase
        .from('gateway_custom_rules')
        .delete()
        .eq('id', id)
        .eq('org_id', orgId)
        .select('label,match_type,pattern')
        .maybeSingle()
      if (error) return json({ ok: false, error: 'Could not remove the rule.' }, 500)
      if (!data) return json({ ok: false, error: 'Rule not found.' }, 404)
      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: 'gateway_rule_removed',
        entity_type: 'organisation',
        entity_id: orgId,
        changes: { label: data.label, match_type: data.match_type, pattern: data.pattern },
      })
      return json({ ok: true })
    }

    if (action === 'test') {
      const key = String(body.key || '')
      const sample = String(body.sample || '').trim().slice(0, 500)
      const result = await runTest(supabase, orgId, key, parseUuid(body.asset_id, 'Agent'), sample)
      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: 'gateway_guardrail_tested',
        entity_type: 'ai_system',
        entity_id: result.agent.id,
        changes: {
          _system_name: result.agent.name,
          guardrail: key,
          verdict: result.verdict,
          outcome: result.outcome,
          model: result.model,
          event_id: result.event_id,
        },
      })
      return json({ ok: true, test: result })
    }

    return json({ ok: false, error: 'Unknown action.' }, 400)
  } catch (error) {
    if (error instanceof Response) {
      const payload = await error.json().catch(() => ({ ok: false, error: 'Request failed.' }))
      return json(payload, error.status)
    }
    console.error('gateway-guardrails failed', error instanceof Error ? error.message : 'unknown error')
    return json({ ok: false, error: error instanceof Error ? error.message : 'Request failed.' }, 500)
  }
})
