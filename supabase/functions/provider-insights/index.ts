/**
 * RegAnchor — Provider Insights
 * On-demand usage/cost via Admin API. Admin from org (legacy asset fallback).
 * Also upserts asset_usage_snapshots so Analytics stays in sync with Connection Refresh.
 */
import {
  applyGovernanceInsights,
  applyRuntimeAttribution,
  assertOrgAdmin,
  attributionFromConnection,
  corsHeaders,
  getAuthedUser,
  json,
  loadAsset,
  loadCatalogProvider,
  parseUuid,
  readConnectionSecret,
  resolveAdminSecret,
  writeAudit,
} from '../_shared/provider-connection.ts'
import { fetchProviderGovernanceInsights, resolveProviderRuntimeAttribution } from '../_shared/providers/index.ts'
import type { ProviderGovernanceInsights } from '../_shared/providers/types.ts'

function parseWindowDays(value: unknown): number {
  const days = Number(value)
  if (!Number.isFinite(days)) return 30
  return Math.min(90, Math.max(1, Math.floor(days)))
}

function usageFetchFailed(insights: ProviderGovernanceInsights): boolean {
  return !!(insights.errors || []).some((note) =>
    /Could not fetch usage report|Usage report is not available/i.test(note)
  )
}

function preserveUsageOnFetchFailure(
  insights: ProviderGovernanceInsights,
  previous: ProviderGovernanceInsights | null | undefined,
): ProviderGovernanceInsights {
  if (!usageFetchFailed(insights)) return insights
  const prevUsage = previous?.usage
  const prevTokens = Number(prevUsage?.total_tokens || 0)
  if (!prevUsage || prevTokens <= 0) {
    const errors = [...(insights.errors || [])]
    if (!errors.some((note) => /not treating zero tokens as confirmed/i.test(note))) {
      errors.push(
        'Admin usage could not be fetched. Zero tokens are not confirmed usage. Try Refresh again in a few minutes. Gateway metering on this asset remains authoritative for gateway calls.',
      )
    }
    return { ...insights, errors }
  }

  const errors = [...(insights.errors || [])]
  errors.push(
    'Showing the last successful Admin usage figures because the latest usage fetch failed.',
  )
  return {
    ...insights,
    usage: prevUsage,
    estimated_asset_usd: previous?.estimated_asset_usd ?? insights.estimated_asset_usd,
    organization_usage: insights.organization_usage || previous?.organization_usage,
    errors,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  try {
    const { user, supabase } = await getAuthedUser(req)
    const body = await req.json().catch(() => ({}))
    const assetId = parseUuid(body.asset_id, 'Asset')
    const windowDays = parseWindowDays(body.window_days)

    const asset = await loadAsset(supabase, assetId)
    await assertOrgAdmin(supabase, user.id, asset.org_id)

    const providerSlug = String(body.provider_slug || asset.provider_slug || '').trim()
    if (!providerSlug) {
      return json({ ok: false, error: 'No platform set on this asset.' }, 400)
    }

    await loadCatalogProvider(supabase, providerSlug)

    let { data: connection, error: connError } = await supabase
      .from('provider_connections')
      .select('*')
      .eq('asset_id', asset.id)
      .eq('provider_slug', providerSlug)
      .neq('status', 'revoked')
      .maybeSingle()

    if (connError || !connection) {
      return json({ ok: false, error: 'No active provider connection for this asset.' }, 404)
    }

    const resolved = await resolveAdminSecret(
      supabase,
      asset.org_id,
      providerSlug,
      connection,
    )
    if (!resolved.secret) {
      return json({
        ok: false,
        error: 'Connect a Governance Admin key under Organisation → Providers to refresh insights.',
      }, 400)
    }

    const adminSecret = resolved.secret

    let attribution = attributionFromConnection(connection)
    const apiSecret = await readConnectionSecret(supabase, connection.id, 'api')
    if (apiSecret) {
      const attributed = await resolveProviderRuntimeAttribution(providerSlug, adminSecret, apiSecret)
      if (attributed) {
        connection = await applyRuntimeAttribution(supabase, connection, attributed)
        attribution = attributed
      }
    }

    let insights = await fetchProviderGovernanceInsights(providerSlug, adminSecret, windowDays, attribution)
    if (!insights) {
      return json({ ok: false, error: 'Insights are not available for this platform yet.' }, 400)
    }

    const previous = (connection.metadata && (connection.metadata as { insights?: ProviderGovernanceInsights }).insights) || null
    insights = preserveUsageOnFetchFailure(insights, previous)

    const { error: snapshotError } = await supabase
      .from('asset_usage_snapshots')
      .upsert({
        org_id: asset.org_id,
        asset_id: asset.id,
        provider_slug: providerSlug,
        window_days: insights.window_days,
        scope: insights.scope,
        total_tokens: insights.usage.total_tokens,
        org_cost_usd: insights.cost.total_usd,
        estimated_asset_usd: insights.estimated_asset_usd ?? null,
        api_key_id: insights.api_key_id || null,
        payload: insights,
        refreshed_at: insights.refreshed_at,
      }, { onConflict: 'asset_id,provider_slug,window_days' })
    if (snapshotError) {
      console.error('asset_usage_snapshots upsert failed', snapshotError.message)
    }

    const updated = await applyGovernanceInsights(supabase, connection, insights)

    await writeAudit(supabase, {
      org_id: asset.org_id,
      user_id: user.id,
      action: 'provider_insights_refreshed',
      entity_id: asset.id,
      changes: {
        _system_name: asset.name,
        provider_slug: providerSlug,
        connection_id: connection.id,
        window_days: insights.window_days,
        scope: insights.scope,
        api_key_id: insights.api_key_id || null,
        total_tokens: insights.usage.total_tokens,
        total_cost_usd: insights.cost.total_usd,
        partial: !!(insights.errors && insights.errors.length),
        usage_fetch_failed: usageFetchFailed(insights),
        admin_source: resolved.source,
      },
    })

    return json({
      ok: true,
      connection: updated,
      insights,
      partial: !!(insights.errors && insights.errors.length),
      usage_fetch_failed: usageFetchFailed(insights),
      admin_source: resolved.source,
    })
  } catch (err) {
    if (err instanceof Response) {
      const payload = await err.json().catch(() => ({ ok: false, error: 'Request failed.' }))
      return json(payload, err.status)
    }
    return json({ ok: false, error: err instanceof Error ? err.message : 'Request failed.' }, 500)
  }
})
