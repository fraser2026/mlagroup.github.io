/**
 * RegAnchor — Org Provider Revoke (Phase 3b)
 * Revoke organisation-scoped Governance Admin key.
 */
import {
  assertOrgAdmin,
  corsHeaders,
  deleteOrgProviderSecret,
  getAuthedUser,
  json,
  loadCatalogProvider,
  loadOrgProviderCredential,
  orgCredentialHasAdmin,
  parseUuid,
  writeAudit,
} from '../_shared/provider-connection.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  try {
    const { user, supabase } = await getAuthedUser(req)
    const body = await req.json().catch(() => ({}))
    const orgId = parseUuid(body.org_id, 'Organisation')
    const providerSlug = String(body.provider_slug || '').trim()

    if (!providerSlug) return json({ ok: false, error: 'Provider is required.' }, 400)

    await assertOrgAdmin(supabase, user.id, orgId)
    await loadCatalogProvider(supabase, providerSlug)

    const credential = await loadOrgProviderCredential(supabase, orgId, providerSlug)
    if (!credential || !orgCredentialHasAdmin(credential)) {
      return json({ ok: false, error: 'No organisation Admin key connected for this provider.' }, 404)
    }

    await deleteOrgProviderSecret(supabase, credential.id)

    const now = new Date().toISOString()
    const { data: revoked } = await supabase
      .from('org_provider_credentials')
      .update({
        status: 'revoked',
        last_error: null,
        updated_at: now,
        metadata: {},
      })
      .eq('id', credential.id)
      .select('*')
      .single()

    await writeAudit(supabase, {
      org_id: orgId,
      user_id: user.id,
      action: 'org_provider_admin_revoked',
      entity_type: 'organisation',
      entity_id: orgId,
      changes: {
        provider_slug: providerSlug,
        credential_id: credential.id,
      },
    })

    return json({
      ok: true,
      mode: 'revoked',
      credential: revoked || { id: credential.id, status: 'revoked' },
    })
  } catch (err) {
    if (err instanceof Response) {
      const payload = await err.json().catch(() => ({ ok: false, error: 'Request failed.' }))
      return json(payload, err.status)
    }
    return json({ ok: false, error: err instanceof Error ? err.message : 'Request failed.' }, 500)
  }
})
