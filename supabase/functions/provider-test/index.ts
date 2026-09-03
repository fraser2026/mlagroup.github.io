/**
 * RegAnchor — Provider Test (Phase 4a)
 * Live verification + capability probe for runtime and admin credential slots.
 */
import {
  applyCapabilityProfile,
  applyProviderVerification,
  applyRuntimeAttribution,
  assertOrgMember,
  connectionHasSlot,
  corsHeaders,
  getAuthedUser,
  json,
  loadAsset,
  loadCatalogProvider,
  parseCredentialSlot,
  parseUuid,
  readConnectionSecret,
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
    const slot = parseCredentialSlot(body.credential_slot || 'api')
    const probeAll = body.probe_all === true

    const asset = await loadAsset(supabase, assetId)
    await assertOrgMember(supabase, user.id, asset.org_id)

    const providerSlug = String(body.provider_slug || asset.provider_slug || '').trim()
    if (!providerSlug) {
      return json({ ok: false, error: 'No platform set on this asset.' }, 400)
    }

    const provider = await loadCatalogProvider(supabase, providerSlug)

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

    const slotsToTest = probeAll
      ? (['api', 'admin'] as const).filter((s) => connectionHasSlot(connection, s))
      : [slot]

    if (!slotsToTest.length) {
      return json({ ok: false, error: 'No stored credentials to verify for this slot.' }, 404)
    }

    let updated = connection
    let lastVerificationOk = true
    let lastError: string | undefined

    for (const testSlot of slotsToTest) {
      const secret = await readConnectionSecret(supabase, connection.id, testSlot)
      if (!secret) {
        lastVerificationOk = false
        lastError = `No ${testSlot} credential stored.`
        continue
      }

      const verification = await verifyProviderCredential(providerSlug, testSlot, secret)
      updated = await applyProviderVerification(supabase, updated, verification, testSlot)
      if (!verification.ok) {
        lastVerificationOk = false
        lastError = verification.error
      }
    }

    const apiSecret = await readConnectionSecret(supabase, connection.id, 'api')
    const adminSecret = await readConnectionSecret(supabase, connection.id, 'admin')
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
      action: 'provider_verified',
      entity_id: asset.id,
      changes: {
        _system_name: asset.name,
        provider_slug: providerSlug,
        connection_id: connection.id,
        credential_slot: probeAll ? 'all' : slot,
        verification_ok: lastVerificationOk,
        governance_tier: profile?.governance_tier || null,
      },
    })

    if (!lastVerificationOk) {
      return json({
        ok: false,
        error: lastError || 'Provider verification failed.',
        connection: updated,
        capabilities: profile,
        governance_tier: profile?.governance_tier || null,
      }, 400)
    }

    return json({
      ok: true,
      mode: 'live_api',
      connection: updated,
      capabilities: profile,
      governance_tier: profile?.governance_tier || null,
    })
  } catch (err) {
    if (err instanceof Response) {
      const payload = await err.json().catch(() => ({ ok: false, error: 'Request failed.' }))
      return json(payload, err.status)
    }
    return json({ ok: false, error: err instanceof Error ? err.message : 'Request failed.' }, 500)
  }
})
