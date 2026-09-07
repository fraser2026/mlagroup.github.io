/**
 * RegAnchor — Provider Connect
 * Asset runtime API key only (Phase 3b: Admin lives at Organisation → Providers).
 */
import {
  applyCapabilityProfile,
  applyProviderVerification,
  applyRuntimeAttribution,
  assertOrgAdmin,
  corsHeaders,
  getAuthedUser,
  getOrCreateConnection,
  json,
  loadAsset,
  loadCatalogProvider,
  parseCredentialSlot,
  parseUuid,
  readConnectionSecret,
  resolveAdminSecret,
  storeConnectionSecret,
  writeAudit,
} from '../_shared/provider-connection.ts'
import { probeProviderCapabilities, resolveProviderRuntimeAttribution, verifyProviderCredential } from '../_shared/providers/index.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  try {
    const { user, supabase } = await getAuthedUser(req)
    const body = await req.json().catch(() => ({}))
    const assetId = parseUuid(body.asset_id, 'Asset')
    const slot = parseCredentialSlot(body.credential_slot)
    const apiKey = String(body.api_key || '').trim()
    if (!apiKey) return json({ ok: false, error: 'API key is required.' }, 400)

    if (slot === 'admin') {
      return json({
        ok: false,
        error: 'Governance Admin keys are managed once per provider under Organisation → Providers.',
      }, 400)
    }

    const asset = await loadAsset(supabase, assetId)
    await assertOrgAdmin(supabase, user.id, asset.org_id)

    const providerSlug = String(body.provider_slug || asset.provider_slug || '').trim()
    if (!providerSlug) {
      return json({ ok: false, error: 'Set a platform on this asset before connecting.' }, 400)
    }

    const provider = await loadCatalogProvider(supabase, providerSlug)
    if (provider.auth_method !== 'api_key') {
      return json({ ok: false, error: 'This platform does not use API key authentication yet.' }, 400)
    }

    const verification = await verifyProviderCredential(providerSlug, 'api', apiKey)
    if (!verification.ok) {
      return json({
        ok: false,
        error: verification.error || 'API key could not be verified with the provider.',
        error_code: verification.error_code,
        mode: verification.mode,
        credential_slot: 'api',
      }, verification.error_code === 'rate_limited' ? 429 : 400)
    }

    const connection = await getOrCreateConnection(
      supabase,
      asset,
      providerSlug,
      provider.auth_method,
      user.id,
    )

    await storeConnectionSecret(supabase, connection.id, apiKey, 'api')

    const now = new Date().toISOString()
    await supabase.from('provider_connections').update({
      connected_by: user.id,
      connected_at: now,
      updated_at: now,
    }).eq('id', connection.id)

    const refreshed = await supabase
      .from('provider_connections')
      .select('*')
      .eq('id', connection.id)
      .single()

    const conn = refreshed.data || connection
    let updated = await applyProviderVerification(supabase, conn, verification, 'api')

    const apiSecret = await readConnectionSecret(supabase, connection.id, 'api')
    const { secret: adminSecret } = await resolveAdminSecret(
      supabase,
      asset.org_id,
      providerSlug,
      updated,
    )
    const profile = await probeProviderCapabilities(providerSlug, apiSecret, adminSecret)
    if (profile) {
      updated = await applyCapabilityProfile(supabase, updated, profile)
    }
    if (apiSecret && adminSecret) {
      const attribution = await resolveProviderRuntimeAttribution(providerSlug, adminSecret, apiSecret)
      updated = await applyRuntimeAttribution(supabase, updated, attribution)
    }

    await writeAudit(supabase, {
      org_id: asset.org_id,
      user_id: user.id,
      action: 'provider_connected',
      entity_id: asset.id,
      changes: {
        _system_name: asset.name,
        provider_slug: providerSlug,
        connection_id: connection.id,
        credential_slot: 'api',
        verification_mode: verification.mode,
        governance_tier: profile?.governance_tier || null,
        provider_request_id: verification.provider_request_id || null,
        admin_source: adminSecret ? 'resolved' : null,
      },
    })

    return json({
      ok: true,
      mode: verification.mode,
      credential_slot: 'api',
      governance_tier: profile?.governance_tier || null,
      capabilities: profile?.capabilities || null,
      connection: updated,
    })
  } catch (err) {
    if (err instanceof Response) {
      const payload = await err.json().catch(() => ({ ok: false, error: 'Request failed.' }))
      return json(payload, err.status)
    }
    return json({ ok: false, error: err instanceof Error ? err.message : 'Request failed.' }, 500)
  }
})
