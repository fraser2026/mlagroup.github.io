/**
 * RegAnchor — Provider Test
 * Live verification + capability probe. Runtime from asset; Admin from org (legacy asset fallback).
 */
import {
  applyCapabilityProfile,
  applyOrgProviderVerification,
  applyProviderVerification,
  applyRuntimeAttribution,
  assertOrgMember,
  connectionHasSlot,
  corsHeaders,
  getAuthedUser,
  json,
  loadAsset,
  loadCatalogProvider,
  loadOrgProviderCredential,
  orgCredentialHasAdmin,
  parseCredentialSlot,
  parseUuid,
  readConnectionSecret,
  readOrgProviderSecret,
  resolveAdminSecret,
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

    const orgCredential = await loadOrgProviderCredential(supabase, asset.org_id, providerSlug)
    const hasOrgAdmin = orgCredentialHasAdmin(orgCredential)
    const hasAssetAdmin = connectionHasSlot(connection, 'admin')
    const hasApi = connectionHasSlot(connection, 'api')

    if (probeAll) {
      if (!hasApi && !hasOrgAdmin && !hasAssetAdmin) {
        return json({ ok: false, error: 'No stored credentials to verify.' }, 404)
      }
    } else if (slot === 'admin') {
      if (!hasOrgAdmin && !hasAssetAdmin) {
        return json({ ok: false, error: 'No Admin credential stored. Connect one under Organisation → Providers.' }, 404)
      }
    } else if (!hasApi) {
      return json({ ok: false, error: 'No runtime API key stored for this asset.' }, 404)
    }

    let updated = connection
    let lastVerificationOk = true
    let lastError: string | undefined
    let orgUpdated = orgCredential

    if (probeAll || slot === 'api') {
      if (hasApi) {
        const secret = await readConnectionSecret(supabase, connection.id, 'api')
        if (!secret) {
          lastVerificationOk = false
          lastError = 'No api credential stored.'
        } else {
          const verification = await verifyProviderCredential(providerSlug, 'api', secret)
          updated = await applyProviderVerification(supabase, updated, verification, 'api')
          if (!verification.ok) {
            lastVerificationOk = false
            lastError = verification.error
          }
        }
      }
    }

    if (probeAll || slot === 'admin') {
      if (hasOrgAdmin && orgCredential) {
        const secret = await readOrgProviderSecret(supabase, orgCredential.id)
        if (!secret) {
          lastVerificationOk = false
          lastError = 'No organisation Admin credential stored.'
        } else {
          const verification = await verifyProviderCredential(providerSlug, 'admin', secret)
          orgUpdated = await applyOrgProviderVerification(supabase, orgCredential, verification)
          if (!verification.ok) {
            lastVerificationOk = false
            lastError = verification.error
          }
        }
      } else if (hasAssetAdmin) {
        const secret = await readConnectionSecret(supabase, connection.id, 'admin')
        if (!secret) {
          lastVerificationOk = false
          lastError = 'No admin credential stored.'
        } else {
          const verification = await verifyProviderCredential(providerSlug, 'admin', secret)
          updated = await applyProviderVerification(supabase, updated, verification, 'admin')
          if (!verification.ok) {
            lastVerificationOk = false
            lastError = verification.error
          }
        }
      }
    }

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
      action: 'provider_verified',
      entity_id: asset.id,
      changes: {
        _system_name: asset.name,
        provider_slug: providerSlug,
        connection_id: connection.id,
        credential_slot: probeAll ? 'all' : slot,
        verification_ok: lastVerificationOk,
        governance_tier: profile?.governance_tier || null,
        admin_source: adminSecret ? (hasOrgAdmin ? 'org' : 'asset') : null,
      },
    })

    if (!lastVerificationOk) {
      return json({
        ok: false,
        error: lastError || 'Provider verification failed.',
        connection: updated,
        org_credential: orgUpdated,
        capabilities: profile,
        governance_tier: profile?.governance_tier || null,
      }, 400)
    }

    return json({
      ok: true,
      mode: 'live_api',
      connection: updated,
      org_credential: orgUpdated,
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
