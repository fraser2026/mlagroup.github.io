/**
 * RegAnchor MCP auth — device start / approve / token exchange.
 * verify_jwt: false (device_start + device_token are public; approve uses user JWT in-function).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
}

const DEVICE_TTL_MS = 15 * 60 * 1000
const ACCESS_TTL_SEC = 60 * 60
const REFRESH_TTL_SEC = 30 * 24 * 60 * 60
const VERIFICATION_PATH = '/portal.html#mcp-device'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  )
}

function verificationUri(): string {
  const configured = (Deno.env.get('REGANCHOR_PUBLIC_ORIGIN') || 'https://reganchor.com').replace(/\/+$/, '')
  return `${configured}${VERIFICATION_PATH}`
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function randomToken(prefix: string, byteLength = 32): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return `${prefix}${base64Url(bytes)}`
}

function randomUserCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const pick = () => alphabet[crypto.getRandomValues(new Uint8Array(1))[0] % alphabet.length]
  return `${pick()}${pick()}${pick()}${pick()}-${pick()}${pick()}${pick()}${pick()}`
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function getBearerUser(req: Request) {
  const auth = req.headers.get('Authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!token || token.startsWith('ra_mcp_')) {
    throw new Response(JSON.stringify({ ok: false, error: 'Sign in required.' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const supabase = serviceClient()
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) {
    throw new Response(JSON.stringify({ ok: false, error: 'Sign in required.' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  return { user, supabase, userJwt: token }
}

async function issueTokenPair(
  supabase: ReturnType<typeof serviceClient>,
  userId: string,
  orgId: string | null,
  clientName: string,
  label: string,
  resource: string | null = null,
) {
  const refreshPlain = randomToken('ra_mcp_rt_')
  const accessPlain = randomToken('ra_mcp_at_')
  const now = Date.now()
  const refreshHash = await sha256(refreshPlain)
  const accessHash = await sha256(accessPlain)

  const insertRow: Record<string, unknown> = {
    user_id: userId,
    org_id: orgId,
    token_hash: refreshHash,
    label,
    client_name: clientName,
    expires_at: new Date(now + REFRESH_TTL_SEC * 1000).toISOString(),
  }
  if (resource) insertRow.resource = resource

  const { data: refreshRow, error: refreshError } = await supabase
    .from('mcp_refresh_tokens')
    .insert(insertRow)
    .select('id,expires_at')
    .single()
  if (refreshError || !refreshRow) throw new Error(refreshError?.message || 'Could not issue refresh token.')

  const { error: accessError } = await supabase.from('mcp_access_tokens').insert({
    user_id: userId,
    refresh_token_id: refreshRow.id,
    token_hash: accessHash,
    expires_at: new Date(now + ACCESS_TTL_SEC * 1000).toISOString(),
  })
  if (accessError) throw new Error(accessError.message)

  return {
    token_type: 'Bearer',
    access_token: accessPlain,
    expires_in: ACCESS_TTL_SEC,
    refresh_token: refreshPlain,
    refresh_expires_in: REFRESH_TTL_SEC,
    scope: 'mcp:tools',
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  try {
    const body = await req.json().catch(() => ({}))
    const action = String(body.action || '').trim().toLowerCase()
    const supabase = serviceClient()

    if (action === 'device_start') {
      const clientName = String(body.client_name || 'mcp-client').trim().slice(0, 80) || 'mcp-client'
      const deviceCode = randomToken('ra_mcp_dc_', 24)
      const userCode = randomUserCode()
      const expiresAt = new Date(Date.now() + DEVICE_TTL_MS).toISOString()
      const { error } = await supabase.from('mcp_device_codes').insert({
        device_code_hash: await sha256(deviceCode),
        user_code: userCode,
        status: 'pending',
        client_name: clientName,
        expires_at: expiresAt,
      })
      if (error) return json({ ok: false, error: error.message }, 500)
      return json({
        ok: true,
        device_code: deviceCode,
        user_code: userCode,
        verification_uri: verificationUri(),
        verification_uri_complete: `${verificationUri()}?code=${encodeURIComponent(userCode)}`,
        expires_in: Math.floor(DEVICE_TTL_MS / 1000),
        interval: 5,
      })
    }

    if (action === 'device_approve') {
      const { user, supabase: admin } = await getBearerUser(req)
      const userCode = String(body.user_code || '').trim().toUpperCase()
      if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(userCode)) {
        return json({ ok: false, error: 'Enter the code in the form ABCD-EFGH.' }, 400)
      }
      const orgId = body.org_id ? String(body.org_id).trim() : null
      if (orgId) {
        const { data: membership } = await admin
          .from('org_members')
          .select('role')
          .eq('org_id', orgId)
          .eq('user_id', user.id)
          .maybeSingle()
        if (!membership) return json({ ok: false, error: 'You are not a member of that organisation.' }, 403)
      }

      const { data: row } = await admin
        .from('mcp_device_codes')
        .select('*')
        .eq('user_code', userCode)
        .eq('status', 'pending')
        .maybeSingle()
      if (!row) return json({ ok: false, error: 'Code not found or already used.' }, 404)
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        await admin.from('mcp_device_codes').update({ status: 'expired' }).eq('id', row.id)
        return json({ ok: false, error: 'This code has expired. Start login again.' }, 410)
      }

      const { error } = await admin
        .from('mcp_device_codes')
        .update({
          status: 'approved',
          user_id: user.id,
          org_id: orgId,
          approved_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .eq('status', 'pending')
      if (error) return json({ ok: false, error: error.message }, 500)
      return json({ ok: true, approved: true, client_name: row.client_name })
    }

    if (action === 'device_token') {
      const deviceCode = String(body.device_code || '').trim()
      if (!deviceCode.startsWith('ra_mcp_dc_')) {
        return json({ ok: false, error: 'device_code is required.' }, 400)
      }
      const hash = await sha256(deviceCode)
      const { data: row } = await supabase
        .from('mcp_device_codes')
        .select('*')
        .eq('device_code_hash', hash)
        .maybeSingle()
      if (!row) return json({ ok: false, error: 'Unknown device code.' }, 404)
      if (row.status === 'pending') {
        if (new Date(row.expires_at).getTime() <= Date.now()) {
          await supabase.from('mcp_device_codes').update({ status: 'expired' }).eq('id', row.id)
          return json({ ok: false, error: 'expired_token', message: 'Device code expired.' }, 410)
        }
        return json({ ok: false, error: 'authorization_pending', message: 'Waiting for user approval.' }, 400)
      }
      if (row.status === 'denied') return json({ ok: false, error: 'access_denied' }, 403)
      if (row.status === 'expired') return json({ ok: false, error: 'expired_token' }, 410)
      if (row.status === 'consumed') return json({ ok: false, error: 'Device code already used.' }, 409)
      if (row.status !== 'approved' || !row.user_id) {
        return json({ ok: false, error: 'Device code is not approved.' }, 400)
      }

      const tokens = await issueTokenPair(
        supabase,
        row.user_id,
        row.org_id,
        row.client_name,
        `Device login (${row.client_name})`,
      )
      await supabase
        .from('mcp_device_codes')
        .update({ status: 'consumed', consumed_at: new Date().toISOString() })
        .eq('id', row.id)
      return json({ ok: true, ...tokens })
    }

    if (action === 'refresh') {
      const refreshToken = String(body.refresh_token || '').trim()
      if (!refreshToken.startsWith('ra_mcp_rt_')) {
        return json({ ok: false, error: 'refresh_token is required.' }, 400)
      }
      const hash = await sha256(refreshToken)
      const { data: row } = await supabase
        .from('mcp_refresh_tokens')
        .select('*')
        .eq('token_hash', hash)
        .is('revoked_at', null)
        .maybeSingle()
      if (!row) return json({ ok: false, error: 'Invalid refresh token.' }, 401)
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        return json({ ok: false, error: 'Refresh token expired.' }, 401)
      }

      await supabase
        .from('mcp_refresh_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', row.id)
      await supabase
        .from('mcp_access_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('refresh_token_id', row.id)
        .is('revoked_at', null)

      const tokens = await issueTokenPair(
        supabase,
        row.user_id,
        row.org_id,
        row.client_name,
        row.label || 'MCP refresh',
        row.resource || null,
      )
      await supabase
        .from('mcp_refresh_tokens')
        .update({ last_used_at: new Date().toISOString() })
        .eq('token_hash', await sha256(tokens.refresh_token))
      return json({ ok: true, ...tokens })
    }

    if (action === 'portal_issue') {
      const { user, supabase: admin } = await getBearerUser(req)
      const clientName = String(body.client_name || 'portal-connect').trim().slice(0, 80) || 'portal-connect'
      const label = String(body.label || `Portal connect (${clientName})`).trim().slice(0, 80)
      const orgId = body.org_id ? String(body.org_id).trim() : null
      if (orgId) {
        const { data: membership } = await admin
          .from('org_members')
          .select('role')
          .eq('org_id', orgId)
          .eq('user_id', user.id)
          .maybeSingle()
        if (!membership) return json({ ok: false, error: 'You are not a member of that organisation.' }, 403)
      }
      const tokens = await issueTokenPair(admin, user.id, orgId, clientName, label)
      return json({ ok: true, ...tokens })
    }

    if (action === 'sessions_list') {
      const { user, supabase: admin } = await getBearerUser(req)
      const { data, error } = await admin
        .from('mcp_refresh_tokens')
        .select('id,label,client_name,created_at,expires_at,revoked_at,last_used_at,resource')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) return json({ ok: false, error: error.message }, 500)
      return json({ ok: true, sessions: data || [] })
    }

    if (action === 'revoke_session') {
      const { user, supabase: admin } = await getBearerUser(req)
      const sessionId = String(body.session_id || '').trim()
      if (!sessionId) return json({ ok: false, error: 'session_id is required.' }, 400)
      const now = new Date().toISOString()
      const { data: row } = await admin
        .from('mcp_refresh_tokens')
        .update({ revoked_at: now })
        .eq('id', sessionId)
        .eq('user_id', user.id)
        .is('revoked_at', null)
        .select('id')
        .maybeSingle()
      if (!row?.id) return json({ ok: false, error: 'Session not found or already revoked.' }, 404)
      await admin
        .from('mcp_access_tokens')
        .update({ revoked_at: now })
        .eq('refresh_token_id', row.id)
        .is('revoked_at', null)
      return json({ ok: true, revoked: true })
    }

    if (action === 'revoke') {
      const { user, supabase: admin } = await getBearerUser(req)
      const refreshToken = String(body.refresh_token || '').trim()
      if (refreshToken.startsWith('ra_mcp_rt_')) {
        const hash = await sha256(refreshToken)
        const now = new Date().toISOString()
        const { data: row } = await admin
          .from('mcp_refresh_tokens')
          .update({ revoked_at: now })
          .eq('token_hash', hash)
          .eq('user_id', user.id)
          .is('revoked_at', null)
          .select('id')
          .maybeSingle()
        if (row?.id) {
          await admin
            .from('mcp_access_tokens')
            .update({ revoked_at: now })
            .eq('refresh_token_id', row.id)
            .is('revoked_at', null)
        }
        return json({ ok: true, revoked: true })
      }
      return json({ ok: false, error: 'refresh_token is required.' }, 400)
    }

    return json({
      ok: false,
      error: 'action must be device_start, device_approve, device_token, portal_issue, sessions_list, revoke_session, refresh, or revoke.',
    }, 400)
  } catch (error) {
    if (error instanceof Response) return error
    return json({ ok: false, error: error instanceof Error ? error.message : 'Request failed.' }, 500)
  }
})
