/**
 * RegAnchor — Provider Insights Sync
 * Cron-friendly, bounded refresh of connected asset usage snapshots.
 */
import {
  applyGovernanceInsights,
  applyRuntimeAttribution,
  assertOrgAdmin,
  attributionFromConnection,
  corsHeaders,
  getAuthedUser,
  getServiceClient,
  json,
  parseUuid,
  readConnectionSecret,
  resolveAdminSecret,
} from '../_shared/provider-connection.ts'
import {
  fetchProviderGovernanceInsights,
  resolveProviderRuntimeAttribution,
} from '../_shared/providers/index.ts'

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

function cronAuthorized(req: Request): boolean {
  const dedicated = Deno.env.get('PROVIDER_INSIGHTS_SYNC_SECRET') || ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const cronHeader = req.headers.get('x-cron-secret') || ''
  const apiKey = req.headers.get('apikey') || ''
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  return !!(
    (dedicated && cronHeader === dedicated) ||
    (serviceRole && (apiKey === serviceRole || bearer === serviceRole))
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  try {
    const body = await req.json().catch(() => ({}))
    const isCron = cronAuthorized(req)
    const windowDays = boundedInt(body.window_days, 30, 1, 90)
    const batchSize = boundedInt(body.batch_size, 10, 1, 25)
    const scanLimit = batchSize * 5
    let orgId: string | null = body.org_id ? parseUuid(body.org_id, 'Organisation') : null
    let supabase = await getServiceClient()

    if (!isCron) {
      const auth = await getAuthedUser(req)
      supabase = auth.supabase
      if (!orgId) return json({ ok: false, error: 'Organisation is required.' }, 400)
      await assertOrgAdmin(supabase, auth.user.id, orgId)
    }

    let connectionQuery = supabase
      .from('provider_connections')
      .select('id,org_id,asset_id,provider_slug,status,credential_secret_id,admin_credential_secret_id,runtime_api_key_id,runtime_workspace_id,metadata,updated_at')
      .eq('status', 'connected')
      .not('credential_secret_id', 'is', null)
      .order('updated_at', { ascending: true })
      .limit(scanLimit)
    if (orgId) connectionQuery = connectionQuery.eq('org_id', orgId)

    const { data: connections, error: connectionError } = await connectionQuery
    if (connectionError) throw new Error(connectionError.message)
    if (!connections?.length) {
      return json({ ok: true, processed: 0, skipped_recent: 0, missing_admin: 0, failed: 0 })
    }

    const assetIds = [...new Set(connections.map((connection) => connection.asset_id))]
    const [{ data: assets, error: assetError }, { data: recent, error: recentError }] = await Promise.all([
      supabase
        .from('ai_systems')
        .select('id,org_id,name,provider_slug')
        .in('id', assetIds)
        .is('deleted_at', null),
      supabase
        .from('asset_usage_snapshots')
        .select('asset_id,provider_slug,refreshed_at')
        .in('asset_id', assetIds)
        .eq('window_days', windowDays),
    ])
    if (assetError) throw new Error(assetError.message)
    if (recentError) throw new Error(recentError.message)

    const assetById = new Map((assets || []).map((asset) => [asset.id, asset]))
    const newestByConnection = new Map<string, number>()
    for (const snapshot of recent || []) {
      const key = `${snapshot.asset_id}:${snapshot.provider_slug}`
      const at = new Date(snapshot.refreshed_at).getTime()
      if (at > (newestByConnection.get(key) || 0)) newestByConnection.set(key, at)
    }

    const freshnessCutoff = Date.now() - 6 * 60 * 60 * 1000
    const outcomes: Array<Record<string, unknown>> = []
    let attempted = 0
    let processed = 0
    let skippedRecent = 0
    let missingAdmin = 0
    let failed = 0

    for (const initialConnection of connections) {
      if (attempted >= batchSize) break
      const asset = assetById.get(initialConnection.asset_id)
      if (!asset) continue

      const recentAt = newestByConnection.get(`${asset.id}:${initialConnection.provider_slug}`) || 0
      if (recentAt >= freshnessCutoff) {
        skippedRecent++
        continue
      }
      attempted++

      try {
        const resolved = await resolveAdminSecret(
          supabase,
          initialConnection.org_id,
          initialConnection.provider_slug,
          initialConnection,
        )
        if (!resolved.secret) {
          missingAdmin++
          outcomes.push({ asset_id: asset.id, status: 'missing_admin' })
          continue
        }

        let connection = initialConnection
        let attribution = attributionFromConnection(connection)
        const runtimeSecret = await readConnectionSecret(supabase, connection.id, 'api')
        if (runtimeSecret) {
          const matched = await resolveProviderRuntimeAttribution(
            connection.provider_slug,
            resolved.secret,
            runtimeSecret,
          )
          if (matched) {
            connection = await applyRuntimeAttribution(supabase, connection, matched)
            attribution = matched
          }
        }

        const insights = await fetchProviderGovernanceInsights(
          connection.provider_slug,
          resolved.secret,
          windowDays,
          attribution,
        )
        if (!insights) throw new Error('Insights are not available for this provider.')

        const { error: snapshotError } = await supabase
          .from('asset_usage_snapshots')
          .upsert({
            org_id: asset.org_id,
            asset_id: asset.id,
            provider_slug: connection.provider_slug,
            window_days: insights.window_days,
            scope: insights.scope,
            total_tokens: insights.usage.total_tokens,
            org_cost_usd: insights.cost.total_usd,
            estimated_asset_usd: insights.estimated_asset_usd ?? null,
            api_key_id: insights.api_key_id || null,
            payload: insights,
            refreshed_at: insights.refreshed_at,
          }, { onConflict: 'asset_id,provider_slug,window_days' })
        if (snapshotError) throw new Error(snapshotError.message)

        await applyGovernanceInsights(supabase, connection, insights)
        processed++
        outcomes.push({
          asset_id: asset.id,
          status: 'refreshed',
          scope: insights.scope,
          total_tokens: insights.usage.total_tokens,
          partial: !!insights.errors?.length,
        })
      } catch (err) {
        failed++
        outcomes.push({
          asset_id: asset.id,
          status: 'error',
          error: err instanceof Error ? err.message : 'Refresh failed.',
        })
      }
    }

    return json({
      ok: true,
      attempted,
      processed,
      skipped_recent: skippedRecent,
      missing_admin: missingAdmin,
      failed,
      window_days: windowDays,
      outcomes,
    })
  } catch (err) {
    if (err instanceof Response) {
      const payload = await err.json().catch(() => ({ ok: false, error: 'Request failed.' }))
      return json(payload, err.status)
    }
    return json({ ok: false, error: err instanceof Error ? err.message : 'Request failed.' }, 500)
  }
})
