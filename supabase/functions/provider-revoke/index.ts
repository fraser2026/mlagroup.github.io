/**
 * RegAnchor — Provider Revoke (Phase 4a)
 * Revokes runtime API key, governance admin key, or both.
 */
import {
  applyCapabilityProfile,
  assertOrgAdmin,
  connectionHasSlot,
  corsHeaders,
  deleteConnectionSecret,
  getAuthedUser,
  json,
  loadAsset,
  loadCatalogProvider,
  parseCredentialSlot,
  parseUuid,
  readConnectionSecret,
  writeAudit,
} from '../_shared/provider-connection.ts'
import { probeProviderCapabilities } from '../_shared/providers/index.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  try {
    const { user, supabase } = await getAuthedUser(req)
    const body = await req.json().catch(() => ({}))
    const assetId = parseUuid(body.asset_id, 'Asset')
    const slotParam = String(body.credential_slot || 'all').trim().toLowerCase()
    const slot = slotParam === 'all' ? 'all' : parseCredentialSlot(slotParam)

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

    if (slot === 'all') {
      await deleteConnectionSecret(supabase, connection.id, 'all')
    } else {
      if (!connectionHasSlot(connection, slot)) {
        return json({ ok: false, error: `No ${slot} credential is stored for this connection.` }, 404)
      }
      await deleteConnectionSecret(supabase, connection.id, slot)
    }

    const refreshed = await supabase
      .from('provider_connections')
      .select('*')
      .eq('id', connection.id)
      .single()

    let updated = refreshed.data || connection
    const hasAny = !!(updated.credential_secret_id || updated.admin_credential_secret_id)
    const now = new Date().toISOString()

    if (!hasAny) {
      const { data: revoked } = await supabase
        .from('provider_connections')
        .update({
          status: 'revoked',
          last_error: null,
          admin_last_error: null,
          updated_at: now,
          metadata: {},
        })
        .eq('id', connection.id)
        .select('*')
        .single()
      updated = revoked || updated
    } else {
      const apiSecret = await readConnectionSecret(supabase, connection.id, 'api')
      const adminSecret = await readConnectionSecret(supabase, connection.id, 'admin')
      const profile = await probeProviderCapabilities(providerSlug, apiSecret, adminSecret)
      if (profile) {
        updated = await applyCapabilityProfile(supabase, updated, profile)
      }
      await supabase
        .from('provider_connections')
        .update({ status: 'connected', updated_at: now })
        .eq('id', connection.id)
    }

    await writeAudit(supabase, {
      org_id: asset.org_id,
      user_id: user.id,
      action: slot === 'admin' ? 'provider_admin_revoked' : 'provider_revoked',
      entity_id: asset.id,
      changes: {
        _system_name: asset.name,
        provider_slug: providerSlug,
        connection_id: connection.id,
        credential_slot: slot,
      },
    })

    return json({
      ok: true,
      mode: hasAny ? 'partial' : 'revoked',
      credential_slot: slot,
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
