/**
 * RegAnchor — Org Provider Test (Phase 3b)
 * Live verify organisation-scoped Governance Admin key.
 */
import {
  applyOrgProviderVerification,
  assertOrgMember,
  corsHeaders,
  getAuthedUser,
  json,
  loadCatalogProvider,
  loadOrgProviderCredential,
  orgCredentialHasAdmin,
  parseUuid,
  readOrgProviderSecret,
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

    if (!providerSlug) return json({ ok: false, error: 'Provider is required.' }, 400)

    await assertOrgMember(supabase, user.id, orgId)
    await loadCatalogProvider(supabase, providerSlug)

    const credential = await loadOrgProviderCredential(supabase, orgId, providerSlug)
    if (!credential || !orgCredentialHasAdmin(credential)) {
      return json({ ok: false, error: 'No organisation Admin key connected for this provider.' }, 404)
    }

    const secret = await readOrgProviderSecret(supabase, credential.id)
    if (!secret) {
      return json({ ok: false, error: 'No organisation Admin credential stored.' }, 404)
    }

    const verification = await verifyProviderCredential(providerSlug, 'admin', secret)
    const updated = await applyOrgProviderVerification(supabase, credential, verification)

    await writeAudit(supabase, {
      org_id: orgId,
      user_id: user.id,
      action: 'org_provider_admin_verified',
      entity_type: 'organisation',
      entity_id: orgId,
      changes: {
        provider_slug: providerSlug,
        credential_id: credential.id,
        verification_ok: verification.ok,
      },
    })

    if (!verification.ok) {
      return json({
        ok: false,
        error: verification.error || 'Admin key verification failed.',
        credential: {
          id: updated.id,
          status: updated.status,
          last_verified_at: updated.last_verified_at,
          last_error: updated.last_error,
          admin_credential_secret_id: updated.admin_credential_secret_id,
        },
      }, 400)
    }

    return json({
      ok: true,
      mode: 'live_api',
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
