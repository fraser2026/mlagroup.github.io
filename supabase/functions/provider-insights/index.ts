/**
 * RegAnchor — Provider Insights (Phase 4b)
 * On-demand usage/cost snapshot via Admin API. No scheduled polling.
 */
import {
  applyGovernanceInsights,
  assertOrgAdmin,
  connectionHasSlot,
  corsHeaders,
  getAuthedUser,
  json,
  loadAsset,
  loadCatalogProvider,
  parseUuid,
  readConnectionSecret,
  writeAudit,
} from '../_shared/provider-connection.ts'
import { fetchProviderGovernanceInsights } from '../_shared/providers/index.ts'

function parseWindowDays(value: unknown): number {
  const days = Number(value)
  if (!Number.isFinite(days)) return 30
  return Math.min(90, Math.max(1, Math.floor(days)))
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

    const { data: connection, error: connError } = await supabase
      .from('provider_connections')
      .select('*')
      .eq('asset_id', asset.id)
      .eq('provider_slug', providerSlug)
      .neq('status', 'revoked')
      .maybeSingle()

    if (connError || !connection) {
      return json({ ok: false, error: 'No active provider connection for this asset.' }, 404)
    }

    if (!connectionHasSlot(connection, 'admin')) {
      return json({ ok: false, error: 'Connect a Governance admin key to refresh insights.' }, 400)
    }

    const adminSecret = await readConnectionSecret(supabase, connection.id, 'admin')
    if (!adminSecret) {
      return json({ ok: false, error: 'No governance admin credential stored.' }, 404)
    }

    const insights = await fetchProviderGovernanceInsights(providerSlug, adminSecret, windowDays)
    if (!insights) {
      return json({ ok: false, error: 'Insights are not available for this platform yet.' }, 400)
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
        total_tokens: insights.usage.total_tokens,
        total_cost_usd: insights.cost.total_usd,
        partial: !!(insights.errors && insights.errors.length),
      },
    })

    return json({
      ok: true,
      connection: updated,
      insights,
      partial: !!(insights.errors && insights.errors.length),
    })
  } catch (err) {
    if (err instanceof Response) {
      const payload = await err.json().catch(() => ({ ok: false, error: 'Request failed.' }))
      return json(payload, err.status)
    }
    return json({ ok: false, error: err instanceof Error ? err.message : 'Request failed.' }, 500)
  }
})
