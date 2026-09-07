/**
 * RegAnchor — Asset gateway token lifecycle.
 * Plaintext capabilities are returned only by mint and never persisted.
 */
import {
  assertOrgAdmin,
  corsHeaders,
  getAuthedUser,
  json,
  loadAsset,
  parseUuid,
  writeAudit,
} from '../_shared/provider-connection.ts'

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function publicToken(row: Record<string, unknown>) {
  return {
    id: row.id,
    label: row.label,
    created_at: row.created_at,
    revoked_at: row.revoked_at,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  try {
    const { user, supabase } = await getAuthedUser(req)
    const body = await req.json().catch(() => ({}))
    const assetId = parseUuid(body.asset_id, 'Asset')
    const action = String(body.action || 'list').trim().toLowerCase()
    const asset = await loadAsset(supabase, assetId)
    await assertOrgAdmin(supabase, user.id, asset.org_id)

    if (asset.provider_slug !== 'anthropic') {
      return json({ ok: false, error: 'Gateway tokens are available only for Anthropic assets.' }, 400)
    }

    if (action === 'list') {
      const { data, error } = await supabase
        .from('asset_gateway_tokens')
        .select('id,label,created_at,revoked_at')
        .eq('asset_id', asset.id)
        .order('created_at', { ascending: false })
      if (error) return json({ ok: false, error: error.message }, 500)
      return json({ ok: true, tokens: (data || []).map(publicToken) })
    }

    if (action === 'mint') {
      const { data: connection } = await supabase
        .from('provider_connections')
        .select('id,credential_secret_id,status')
        .eq('asset_id', asset.id)
        .eq('provider_slug', 'anthropic')
        .eq('status', 'connected')
        .maybeSingle()
      if (!connection?.credential_secret_id) {
        return json({ ok: false, error: 'Connect and verify an Anthropic runtime API key before minting a gateway token.' }, 400)
      }

      const { count } = await supabase
        .from('asset_gateway_tokens')
        .select('id', { count: 'exact', head: true })
        .eq('asset_id', asset.id)
        .is('revoked_at', null)
      if ((count || 0) >= 20) {
        return json({ ok: false, error: 'Revoke an existing token before minting another.' }, 400)
      }

      const label = String(body.label || 'Gateway token').trim()
      if (!label || label.length > 80) {
        return json({ ok: false, error: 'Token label must be between 1 and 80 characters.' }, 400)
      }
      const random = new Uint8Array(32)
      crypto.getRandomValues(random)
      const token = `ra_gw_${base64Url(random)}`
      const tokenHash = await sha256(token)
      const { data, error } = await supabase
        .from('asset_gateway_tokens')
        .insert({
          org_id: asset.org_id,
          asset_id: asset.id,
          token_hash: tokenHash,
          label,
          created_by: user.id,
        })
        .select('id,label,created_at,revoked_at')
        .single()
      if (error || !data) return json({ ok: false, error: error?.message || 'Could not mint gateway token.' }, 500)

      await writeAudit(supabase, {
        org_id: asset.org_id,
        user_id: user.id,
        action: 'asset_gateway_token_minted',
        entity_id: asset.id,
        changes: { _system_name: asset.name, token_id: data.id, label },
      })
      return json({ ok: true, token, token_record: publicToken(data), show_once: true }, 201)
    }

    if (action === 'revoke') {
      const tokenId = parseUuid(body.token_id, 'Token')
      const now = new Date().toISOString()
      const { data, error } = await supabase
        .from('asset_gateway_tokens')
        .update({ revoked_at: now })
        .eq('id', tokenId)
        .eq('asset_id', asset.id)
        .is('revoked_at', null)
        .select('id,label,created_at,revoked_at')
        .maybeSingle()
      if (error) return json({ ok: false, error: error.message }, 500)
      if (!data) return json({ ok: false, error: 'Active gateway token not found.' }, 404)

      await writeAudit(supabase, {
        org_id: asset.org_id,
        user_id: user.id,
        action: 'asset_gateway_token_revoked',
        entity_id: asset.id,
        changes: { _system_name: asset.name, token_id: data.id, label: data.label },
      })
      return json({ ok: true, token_record: publicToken(data) })
    }

    return json({ ok: false, error: 'Action must be list, mint, or revoke.' }, 400)
  } catch (error) {
    if (error instanceof Response) {
      const payload = await error.json().catch(() => ({ ok: false, error: 'Request failed.' }))
      return json(payload, error.status)
    }
    return json({ ok: false, error: error instanceof Error ? error.message : 'Request failed.' }, 500)
  }
})
