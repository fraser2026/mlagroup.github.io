/**
 * RegAnchor — Org Provider Connect (Phase 3b)
 * Connect / replace organisation-scoped Governance Admin key (once per provider).
 */
import {
  applyOrgProviderVerification,
  assertOrgAdmin,
  corsHeaders,
  getAuthedUser,
  getOrCreateOrgProviderCredential,
  json,
  loadCatalogProvider,
  parseUuid,
  storeOrgProviderSecret,
  writeAudit,
} from '../_shared/provider-connection.ts'
import { verifyProviderCredential } from '../_shared/providers/index.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  try {
    const { user, supabase } = await getAuthedUser(req)
    const body = await req.json().catch(() => ({}))
    const orgId = parseUuid(body.org_id, 'Organisation')
    const providerSlug = String(body.provider_slug || '').trim()
    const apiKey = String(body.api_key || '').trim()

    if (!providerSlug) return json({ ok: false, error: 'Provider is required.' }, 400)
    if (!apiKey) return json({ ok: false, error: 'Admin API key is required.' }, 400)

    await assertOrgAdmin(supabase, user.id, orgId)

    const provider = await loadCatalogProvider(supabase, providerSlug)
    if (provider.auth_method !== 'api_key') {
      return json({ ok: false, error: 'This platform does not use API key authentication yet.' }, 400)
    }

    const verification = await verifyProviderCredential(providerSlug, 'admin', apiKey)
    if (!verification.ok) {
      return json({
        ok: false,
        error: verification.error || 'Admin API key could not be verified with the provider.',
        error_code: verification.error_code,
        mode: verification.mode,
      }, verification.error_code === 'rate_limited' ? 429 : 400)
    }

    const credential = await getOrCreateOrgProviderCredential(
      supabase,
      orgId,
      providerSlug,
      user.id,
    )

    await storeOrgProviderSecret(supabase, credential.id, apiKey)

    const now = new Date().toISOString()
    await supabase
      .from('org_provider_credentials')
      .update({
        connected_by: user.id,
        connected_at: now,
        updated_at: now,
      })
      .eq('id', credential.id)

    const refreshed = await supabase
      .from('org_provider_credentials')
      .select('*')
      .eq('id', credential.id)
      .single()

    const updated = await applyOrgProviderVerification(
      supabase,
      refreshed.data || credential,
      verification,
    )

    await writeAudit(supabase, {
      org_id: orgId,
      user_id: user.id,
      action: 'org_provider_admin_connected',
      entity_type: 'organisation',
      entity_id: orgId,
      changes: {
        provider_slug: providerSlug,
        credential_id: credential.id,
        verification_mode: verification.mode,
        provider_request_id: verification.provider_request_id || null,
        provider_name: provider.name,
      },
    })

    return json({
      ok: true,
      mode: verification.mode,
      credential: {
        id: updated.id,
        org_id: updated.org_id,
        provider_slug: updated.provider_slug,
        status: updated.status,
        admin_credential_secret_id: updated.admin_credential_secret_id,
        connected_at: updated.connected_at,
        last_verified_at: updated.last_verified_at,
        last_error: updated.last_error,
        metadata: updated.metadata,
      },
    })
  } catch (err) {
    if (err instanceof Response) {
      const payload = await err.json().catch(() => ({ ok: false, error: 'Request failed.' }))
      return json(payload, err.status)
    }
    return json({ ok: false, error: err instanceof Error ? err.message : 'Request failed.' }, 500)
  }
})
