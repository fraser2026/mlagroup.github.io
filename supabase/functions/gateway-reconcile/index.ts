/**
 * RegAnchor — Gateway reconciliation
 * Compares gateway records with Anthropic's usage and cost analytics per API key and UTC day.
 * Manual runs: organisation owner/admin. Scheduled runs: x-cron-secret checked against Vault.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  applyRuntimeAttribution,
  assertOrgAdmin,
  corsHeaders,
  getAuthedUser,
  getServiceClient,
  json,
  parseUuid,
  readConnectionSecret,
  resolveAdminSecret,
  writeAudit,
} from '../_shared/provider-connection.ts'
import { resolveProviderRuntimeAttribution } from '../_shared/providers/index.ts'
import { AnalyticsError, fetchAnthropicAnalytics } from '../_shared/providers/anthropic-analytics.ts'
import {
  chunkRange,
  type DayResult,
  parseCostRows,
  parseUsageRows,
  type ProviderCostRow,
  type ProviderUsageRow,
  reconcileDays,
  type RecordedRow,
} from '../_shared/gateway-reconcile.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_DAYS = 62
const SCHEDULED_ORG_LIMIT = 25

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function todayStart(): number {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}

/** Complete UTC days only. Scheduled runs also revisit the previous month until it settles. */
function rangeFor(days: number | null): { start: string; end: string } {
  const end = todayStart()
  if (days) return { start: utcDay(end - days * DAY_MS), end: utcDay(end) }
  const today = new Date(end)
  let start = end - 8 * DAY_MS
  if (today.getUTCDate() <= 8) {
    start = Math.min(start, Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
  }
  return { start: utcDay(start), end: utcDay(end) }
}

async function cronAuthorized(supabase: SupabaseClient, req: Request): Promise<boolean> {
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (serviceRole && bearer === serviceRole) return true
  const secret = req.headers.get('x-cron-secret') || ''
  if (secret.length < 32) return false
  const { data, error } = await supabase.rpc('gateway_reconcile_cron_ok', { p_secret: secret })
  return !error && data === true
}

type Outcome = {
  org_id: string
  run_id?: string
  status: 'completed' | 'failed' | 'skipped'
  error?: string
  summary?: Record<string, unknown>
}

async function reconcileOrg(
  supabase: SupabaseClient,
  orgId: string,
  range: { start: string; end: string },
  trigger: 'scheduled' | 'manual',
  userId: string | null,
): Promise<Outcome> {
  const { data: run, error: runError } = await supabase
    .from('gateway_reconciliation_runs')
    .insert({
      org_id: orgId,
      provider: 'anthropic',
      range_start: range.start,
      range_end: range.end,
      trigger,
      triggered_by: userId,
      status: 'running',
    })
    .select('id')
    .single()
  if (runError || !run) throw new Error(runError?.message || 'Could not start reconciliation.')

  const finish = async (patch: Record<string, unknown>) => {
    const { error } = await supabase
      .from('gateway_reconciliation_runs')
      .update({ ...patch, finished_at: new Date().toISOString() })
      .eq('id', run.id)
    if (error) console.error('reconciliation run update failed', error.message)
  }

  try {
    const admin = await resolveAdminSecret(supabase, orgId, 'anthropic')
    if (!admin.secret) {
      const error = 'Connect an Anthropic Admin key on the Organisation page to reconcile against Anthropic.'
      await finish({ status: 'skipped', error })
      return { org_id: orgId, run_id: run.id, status: 'skipped', error }
    }

    // Agents that have used, or can use, the gateway.
    const { data: tokenRows, error: tokenError } = await supabase
      .from('asset_gateway_tokens')
      .select('asset_id')
      .eq('org_id', orgId)
    if (tokenError) throw new Error(tokenError.message)
    const gatewayAssets = [...new Set((tokenRows || []).map((t) => t.asset_id as string))]

    const keyAssets = new Map<string, string[]>()
    if (gatewayAssets.length) {
      const { data: connections, error: connError } = await supabase
        .from('provider_connections')
        .select('id,asset_id,status,credential_secret_id,runtime_api_key_id,runtime_workspace_id,metadata')
        .eq('org_id', orgId)
        .eq('provider_slug', 'anthropic')
        .neq('status', 'revoked')
        .in('asset_id', gatewayAssets)
      if (connError) throw new Error(connError.message)
      for (const connection of connections || []) {
        let apiKeyId = connection.runtime_api_key_id as string | null
        if (connection.credential_secret_id) {
          try {
            const runtimeSecret = await readConnectionSecret(supabase, connection.id, 'api')
            if (runtimeSecret) {
              const matched = await resolveProviderRuntimeAttribution('anthropic', admin.secret, runtimeSecret)
              if (matched && matched.api_key_id !== apiKeyId) {
                await applyRuntimeAttribution(supabase, connection, matched)
              }
              if (matched) apiKeyId = matched.api_key_id
            }
          } catch (err) {
            console.error('runtime key attribution failed', err instanceof Error ? err.message : 'unknown error')
          }
        }
        if (!apiKeyId) continue
        keyAssets.set(apiKeyId, [...(keyAssets.get(apiKeyId) || []), connection.asset_id as string])
      }
    }

    const { data: recordedData, error: recordedError } = await supabase.rpc('gateway_recorded_daily', {
      p_org_id: orgId,
      p_start: range.start,
      p_end: range.end,
    })
    if (recordedError) throw new Error(recordedError.message)
    const recorded = (recordedData || []) as RecordedRow[]

    const keys = new Set(keyAssets.keys())
    for (const row of recorded) if (row.api_key_id) keys.add(row.api_key_id)
    const unattributed = recorded.filter((row) => !row.api_key_id)
    const unattributedEvents = unattributed.reduce((sum, row) => sum + Number(row.events || 0), 0)
    const unattributedAssets = [...new Set(unattributed.map((row) => row.asset_id))]

    const providerUsage: ProviderUsageRow[] = []
    const providerCost: ProviderCostRow[] = []
    const refreshedByChunk: Array<{ start: string; end: string; refreshed: string | null }> = []
    if (keys.size) {
      for (const chunk of chunkRange(range.start, range.end, 31)) {
        const query = { ...chunk, apiKeyIds: [...keys] }
        const usage = await fetchAnthropicAnalytics('usage', admin.secret, query)
        const cost = await fetchAnthropicAnalytics('cost', admin.secret, query)
        providerUsage.push(...parseUsageRows(usage.data))
        providerCost.push(...parseCostRows(cost.data))
        const stamps = [usage.data_refreshed_at, cost.data_refreshed_at]
        const refreshed = stamps.every(Boolean)
          ? stamps.map((s) => s as string).sort()[0]
          : null
        refreshedByChunk.push({ ...chunk, refreshed })
      }
    }

    const refreshedFor = (day: string) =>
      refreshedByChunk.find((c) => day >= c.start && day < c.end)?.refreshed ?? null
    const results: DayResult[] = keys.size
      ? reconcileDays({ providerUsage, providerCost, recorded, keys, keyAssets, refreshedFor, now: new Date() })
      : []

    const checkedAt = new Date().toISOString()
    if (results.length) {
      const { error: upsertError } = await supabase
        .from('gateway_reconciliation_days')
        .upsert(results.map((r) => ({ ...r, org_id: orgId, provider: 'anthropic', checked_at: checkedAt, run_id: run.id })), {
          onConflict: 'org_id,provider,api_key_id,day',
        })
      if (upsertError) throw new Error(upsertError.message)
    }

    // Rows in this range that no longer have any usage on either side.
    const { data: existing, error: existingError } = await supabase
      .from('gateway_reconciliation_days')
      .select('api_key_id,day')
      .eq('org_id', orgId)
      .eq('provider', 'anthropic')
      .gte('day', range.start)
      .lt('day', range.end)
    if (existingError) throw new Error(existingError.message)
    const current = new Set(results.map((r) => `${r.api_key_id}|${r.day}`))
    for (const row of existing || []) {
      if (current.has(`${row.api_key_id}|${row.day}`)) continue
      await supabase
        .from('gateway_reconciliation_days')
        .delete()
        .eq('org_id', orgId)
        .eq('provider', 'anthropic')
        .eq('api_key_id', row.api_key_id)
        .eq('day', row.day)
    }

    const count = (status: string) => results.filter((r) => r.status === status).length
    const summary = {
      keys: keys.size,
      days: results.length,
      matched: count('matched'),
      provider_higher: count('provider_higher'),
      recorded_higher: count('recorded_higher'),
      cost_difference: count('cost_difference'),
      provider_pending: count('provider_pending'),
      final: results.filter((r) => r.final).length,
      unattributed_events: unattributedEvents,
      unattributed_assets: unattributedAssets,
    }
    const refreshedValues = refreshedByChunk.map((c) => c.refreshed).filter(Boolean) as string[]
    await finish({
      status: 'completed',
      summary,
      data_refreshed_at: refreshedValues.length ? refreshedValues.sort()[refreshedValues.length - 1] : null,
    })
    return { org_id: orgId, run_id: run.id, status: 'completed', summary }
  } catch (err) {
    const error = err instanceof AnalyticsError || err instanceof Error ? err.message : 'Reconciliation failed.'
    await finish({ status: 'failed', error })
    return { org_id: orgId, run_id: run.id, status: 'failed', error }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  try {
    const body = await req.json().catch(() => ({}))
    const service = await getServiceClient()
    const isCron = await cronAuthorized(service, req)

    const requestedDays = body.days === undefined || body.days === null ? null : Number(body.days)
    if (requestedDays !== null && (!Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > MAX_DAYS)) {
      return json({ ok: false, error: `Days must be a whole number from 1 to ${MAX_DAYS}.` }, 400)
    }

    if (!isCron) {
      const auth = await getAuthedUser(req)
      const orgId = parseUuid(body.org_id, 'Organisation')
      await assertOrgAdmin(auth.supabase, auth.user.id, orgId)
      const range = rangeFor(requestedDays ?? 7)
      const outcome = await reconcileOrg(service, orgId, range, 'manual', auth.user.id)
      await writeAudit(service, {
        org_id: orgId,
        user_id: auth.user.id,
        action: 'gateway_reconciliation_run',
        entity_type: 'organisation',
        entity_id: orgId,
        changes: { range, status: outcome.status, summary: outcome.summary || null, error: outcome.error || null },
      })
      const status = outcome.status === 'failed' ? 502 : 200
      return json({ ok: outcome.status !== 'failed', range, ...outcome }, status)
    }

    const range = rangeFor(requestedDays)
    let orgIds: string[]
    if (body.org_id) {
      orgIds = [parseUuid(body.org_id, 'Organisation')]
    } else {
      const { data, error } = await service.from('asset_gateway_tokens').select('org_id')
      if (error) throw new Error(error.message)
      orgIds = [...new Set((data || []).map((row) => row.org_id as string))].slice(0, SCHEDULED_ORG_LIMIT)
    }

    const outcomes: Outcome[] = []
    for (const orgId of orgIds) {
      try {
        outcomes.push(await reconcileOrg(service, orgId, range, 'scheduled', null))
      } catch (err) {
        outcomes.push({ org_id: orgId, status: 'failed', error: err instanceof Error ? err.message : 'Reconciliation failed.' })
      }
    }
    return json({ ok: true, range, outcomes })
  } catch (err) {
    if (err instanceof Response) {
      const payload = await err.json().catch(() => ({ ok: false, error: 'Request failed.' }))
      return json(payload, err.status)
    }
    return json({ ok: false, error: err instanceof Error ? err.message : 'Request failed.' }, 500)
  }
})
