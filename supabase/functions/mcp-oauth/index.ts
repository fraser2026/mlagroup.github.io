/**
 * RegAnchor MCP OAuth 2.1 authorization server (PKCE + DCR).
 * verify_jwt: false — public AS endpoints; consent uses portal user JWT.
 *
 * Paths under /functions/v1/mcp-oauth:
 *   GET  /                                AS metadata (also /.well-known/oauth-authorization-server)
 *   POST /register                        Dynamic Client Registration (RFC 7591)
 *   GET  /authorize                       Redirect to portal consent
 *   POST /consent                         Portal issues auth code (Bearer user JWT)
 *   POST /token                           authorization_code | refresh_token
 *   GET  /protected-resource              RFC 9728 PRM for the MCP resource
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const CODE_TTL_MS = 5 * 60 * 1000
const ACCESS_TTL_SEC = 60 * 60
const REFRESH_TTL_SEC = 30 * 24 * 60 * 60
const SCOPE = 'mcp:tools'

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extraHeaders },
  })
}

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  )
}

function publicOrigin(): string {
  return (Deno.env.get('REGANCHOR_PUBLIC_ORIGIN') || 'https://reganchor.com').replace(/\/+$/, '')
}

function supabaseUrl(): string {
  return (Deno.env.get('SUPABASE_URL') || '').replace(/\/+$/, '')
}

function issuer(): string {
  return `${supabaseUrl()}/functions/v1/mcp-oauth`
}

function mcpResource(): string {
  return `${supabaseUrl()}/functions/v1/mcp`
}

/** Accept Supabase MCP URL and branded host (mcp.reganchor.com). */
function allowedMcpResources(): string[] {
  const urls = [mcpResource(), 'https://mcp.reganchor.com/mcp']
  const extra = (Deno.env.get('MCP_PUBLIC_RESOURCE_URL') || '').trim().replace(/\/+$/, '')
  if (extra) urls.push(extra)
  return [...new Set(urls)]
}

function isAllowedMcpResource(resource: string): boolean {
  return allowedMcpResources().includes(String(resource || '').trim())
}

function base64Url(bytes: Uint8Array | string): string {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
  let binary = ''
  for (const byte of data) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function randomToken(prefix: string, byteLength = 32): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return `${prefix}${base64Url(bytes)}`
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return base64Url(new Uint8Array(digest))
}

function pathOf(req: Request): string {
  const url = new URL(req.url)
  // Supabase may pass full path /functions/v1/mcp-oauth/... or stripped.
  const marker = '/mcp-oauth'
  const idx = url.pathname.indexOf(marker)
  const rest = idx >= 0 ? url.pathname.slice(idx + marker.length) : url.pathname
  return rest.replace(/\/+$/, '') || '/'
}

function redirectAllowed(uri: string): boolean {
  const u = String(uri || '').trim()
  if (!u || u.length > 512) return false
  // Cursor desktop + agents (docs), legacy cursor://, VS Code, Claude, local dev.
  return (
    u === 'http://localhost:8787/callback' ||
    u === 'https://www.cursor.com/agents/mcp/oauth/callback' ||
    u.startsWith('cursor://') ||
    u.startsWith('cursor-dev://') ||
    u.startsWith('vscode://') ||
    u.startsWith('vscode-insiders://') ||
    /^https:\/\/claude\.ai(\/|$)/i.test(u) ||
    /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(u)
  )
}

/** Ensure the published Cursor static client exists (skips DCR for desktop Authenticate UI). */
async function ensureCursorStaticClient(supabase: ReturnType<typeof serviceClient>) {
  const clientId = 'ra_mcp_cid_cursor'
  const redirectUris = [
    'http://localhost:8787/callback',
    'https://www.cursor.com/agents/mcp/oauth/callback',
    'cursor://anysphere.cursor-mcp/oauth/callback',
  ]
  const { data } = await supabase
    .from('mcp_oauth_clients')
    .select('client_id')
    .eq('client_id', clientId)
    .maybeSingle()
  if (data?.client_id) return clientId
  await supabase.from('mcp_oauth_clients').insert({
    client_id: clientId,
    client_name: 'Cursor',
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_method: 'none',
  })
  return clientId
}

function asMetadata() {
  const base = issuer()
  return {
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE],
    resource_indicator_parameter_supported: true,
  }
}

function protectedResourceMetadata() {
  return {
    resource: mcpResource(),
    authorization_servers: [issuer()],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
  }
}

async function getBearerUser(req: Request) {
  const auth = req.headers.get('Authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!token || token.startsWith('ra_mcp_')) {
    throw new Response(JSON.stringify({ error: 'invalid_request', error_description: 'Sign in required.' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const supabase = serviceClient()
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) {
    throw new Response(JSON.stringify({ error: 'invalid_token', error_description: 'Sign in required.' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  return { user, supabase }
}

async function issueTokenPair(
  supabase: ReturnType<typeof serviceClient>,
  userId: string,
  orgId: string | null,
  clientName: string,
  label: string,
  resource: string | null,
) {
  const refreshPlain = randomToken('ra_mcp_rt_')
  const accessPlain = randomToken('ra_mcp_at_')
  const now = Date.now()
  const { data: refreshRow, error: refreshError } = await supabase
    .from('mcp_refresh_tokens')
    .insert({
      user_id: userId,
      org_id: orgId,
      token_hash: await sha256Hex(refreshPlain),
      label,
      client_name: clientName,
      resource,
      expires_at: new Date(now + REFRESH_TTL_SEC * 1000).toISOString(),
    })
    .select('id')
    .single()
  if (refreshError || !refreshRow) throw new Error(refreshError?.message || 'Could not issue refresh token.')

  const { error: accessError } = await supabase.from('mcp_access_tokens').insert({
    user_id: userId,
    refresh_token_id: refreshRow.id,
    token_hash: await sha256Hex(accessPlain),
    expires_at: new Date(now + ACCESS_TTL_SEC * 1000).toISOString(),
  })
  if (accessError) throw new Error(accessError.message)

  return {
    token_type: 'Bearer',
    access_token: accessPlain,
    expires_in: ACCESS_TTL_SEC,
    refresh_token: refreshPlain,
    scope: SCOPE,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const path = pathOf(req)
    const supabase = serviceClient()

    if (
      req.method === 'GET' &&
      (path === '/' ||
        path === '/.well-known/oauth-authorization-server' ||
        path.endsWith('/.well-known/oauth-authorization-server'))
    ) {
      await ensureCursorStaticClient(supabase)
      return json(asMetadata())
    }

    if (
      req.method === 'GET' &&
      (path === '/protected-resource' ||
        path === '/.well-known/oauth-protected-resource' ||
        path.endsWith('/.well-known/oauth-protected-resource'))
    ) {
      return json(protectedResourceMetadata())
    }

    if (req.method === 'POST' && path === '/register') {
      const body = await req.json().catch(() => ({}))
      const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : []
      if (!redirectUris.length || !redirectUris.every(redirectAllowed)) {
        return json({
          error: 'invalid_redirect_uri',
          error_description: 'redirect_uris must be Cursor/VS Code/Claude/localhost callbacks only.',
        }, 400)
      }
      const clientId = randomToken('ra_mcp_cid_', 16)
      const clientName = String(body.client_name || 'MCP client').trim().slice(0, 120) || 'MCP client'
      const { error } = await supabase.from('mcp_oauth_clients').insert({
        client_id: clientId,
        client_name: clientName,
        redirect_uris: redirectUris,
        grant_types: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_method: 'none',
      })
      if (error) return json({ error: 'server_error', error_description: error.message }, 500)
      return json({
        client_id: clientId,
        client_name: clientName,
        redirect_uris: redirectUris,
        grant_types: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_method: 'none',
        response_types: ['code'],
      }, 201)
    }

    if (req.method === 'GET' && path === '/authorize') {
      const url = new URL(req.url)
      const clientId = String(url.searchParams.get('client_id') || '').trim()
      const redirectUri = String(url.searchParams.get('redirect_uri') || '').trim()
      const responseType = String(url.searchParams.get('response_type') || '').trim()
      const codeChallenge = String(url.searchParams.get('code_challenge') || '').trim()
      const method = String(url.searchParams.get('code_challenge_method') || 'S256').trim()
      const state = String(url.searchParams.get('state') || '')
      const resource = String(url.searchParams.get('resource') || mcpResource()).trim()
      const scope = String(url.searchParams.get('scope') || SCOPE).trim() || SCOPE

      if (responseType !== 'code') {
        return json({ error: 'unsupported_response_type' }, 400)
      }
      if (method !== 'S256' || codeChallenge.length < 43) {
        return json({ error: 'invalid_request', error_description: 'PKCE S256 code_challenge required.' }, 400)
      }
      if (!redirectAllowed(redirectUri)) {
        return json({ error: 'invalid_request', error_description: 'redirect_uri not allowed.' }, 400)
      }
      const { data: client } = await supabase
        .from('mcp_oauth_clients')
        .select('client_id,redirect_uris,revoked_at,client_name')
        .eq('client_id', clientId)
        .maybeSingle()
      if (!client || client.revoked_at) {
        return json({ error: 'invalid_client' }, 400)
      }
      const uris = Array.isArray(client.redirect_uris) ? client.redirect_uris : []
      if (!uris.includes(redirectUri)) {
        return json({ error: 'invalid_request', error_description: 'redirect_uri not registered.' }, 400)
      }
      if (resource && !isAllowedMcpResource(resource)) {
        return json({ error: 'invalid_target', error_description: 'resource must be the RegAnchor MCP URL.' }, 400)
      }

      const qs = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
        resource: resource || mcpResource(),
        scope,
        client_name: client.client_name || 'MCP client',
      })
      // Use query string (not hash): many clients drop fragments on HTTP redirects.
      const portal = `${publicOrigin()}/portal.html?mcp_oauth=1&${qs.toString()}`
      return Response.redirect(portal, 302)
    }

    if (req.method === 'POST' && path === '/consent') {
      const { user, supabase: admin } = await getBearerUser(req)
      const body = await req.json().catch(() => ({}))
      const clientId = String(body.client_id || '').trim()
      const redirectUri = String(body.redirect_uri || '').trim()
      const codeChallenge = String(body.code_challenge || '').trim()
      const state = String(body.state || '')
      const resource = String(body.resource || mcpResource()).trim()
      const scope = String(body.scope || SCOPE).trim() || SCOPE
      const orgId = body.org_id ? String(body.org_id).trim() : null
      const deny = Boolean(body.deny)

      if (deny) {
        const err = new URL(redirectUri)
        err.searchParams.set('error', 'access_denied')
        if (state) err.searchParams.set('state', state)
        return json({ ok: true, redirect_to: err.toString() })
      }

      const { data: client } = await admin
        .from('mcp_oauth_clients')
        .select('client_id,redirect_uris,revoked_at,client_name')
        .eq('client_id', clientId)
        .maybeSingle()
      if (!client || client.revoked_at) return json({ error: 'invalid_client' }, 400)
      const uris = Array.isArray(client.redirect_uris) ? client.redirect_uris : []
      if (!uris.includes(redirectUri) || !redirectAllowed(redirectUri)) {
        return json({ error: 'invalid_request', error_description: 'redirect_uri not registered.' }, 400)
      }
      if (orgId) {
        const { data: membership } = await admin
          .from('org_members')
          .select('role')
          .eq('org_id', orgId)
          .eq('user_id', user.id)
          .maybeSingle()
        if (!membership) return json({ error: 'access_denied', error_description: 'Not a member of that organisation.' }, 403)
      }
      if (resource && !isAllowedMcpResource(resource)) {
        return json({ error: 'invalid_target', error_description: 'resource must be the RegAnchor MCP URL.' }, 400)
      }

      const code = randomToken('ra_mcp_ac_', 24)
      const { error } = await admin.from('mcp_oauth_codes').insert({
        code_hash: await sha256Hex(code),
        client_id: clientId,
        user_id: user.id,
        org_id: orgId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        resource,
        scope,
        state: state || null,
        expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
      })
      if (error) return json({ error: 'server_error', error_description: error.message }, 500)

      const next = new URL(redirectUri)
      next.searchParams.set('code', code)
      if (state) next.searchParams.set('state', state)
      return json({ ok: true, redirect_to: next.toString(), client_name: client.client_name })
    }

    if (req.method === 'POST' && path === '/token') {
      const contentType = req.headers.get('content-type') || ''
      let body: Record<string, string> = {}
      if (contentType.includes('application/json')) {
        const raw = await req.json().catch(() => ({}))
        for (const [k, v] of Object.entries(raw || {})) body[k] = String(v ?? '')
      } else {
        const text = await req.text()
        const params = new URLSearchParams(text)
        params.forEach((v, k) => {
          body[k] = v
        })
      }

      const grantType = String(body.grant_type || '').trim()
      const clientId = String(body.client_id || '').trim()

      const { data: client } = await supabase
        .from('mcp_oauth_clients')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle()
      if (!client || client.revoked_at) {
        return json({ error: 'invalid_client' }, 401)
      }

      if (grantType === 'authorization_code') {
        const code = String(body.code || '').trim()
        const redirectUri = String(body.redirect_uri || '').trim()
        const verifier = String(body.code_verifier || '').trim()
        const resource = String(body.resource || '').trim()
        if (!code || !redirectUri || !verifier) {
          return json({ error: 'invalid_request' }, 400)
        }
        const expected = await sha256Base64Url(verifier)
        const { data: row } = await supabase
          .from('mcp_oauth_codes')
          .select('*')
          .eq('code_hash', await sha256Hex(code))
          .maybeSingle()
        if (!row || row.consumed_at) return json({ error: 'invalid_grant' }, 400)
        if (new Date(row.expires_at).getTime() <= Date.now()) {
          return json({ error: 'invalid_grant', error_description: 'code expired' }, 400)
        }
        if (row.client_id !== clientId || row.redirect_uri !== redirectUri) {
          return json({ error: 'invalid_grant' }, 400)
        }
        if (row.code_challenge !== expected) {
          return json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400)
        }
        if (resource && row.resource && resource !== row.resource) {
          return json({ error: 'invalid_target' }, 400)
        }

        await supabase
          .from('mcp_oauth_codes')
          .update({ consumed_at: new Date().toISOString() })
          .eq('id', row.id)

        const tokens = await issueTokenPair(
          supabase,
          row.user_id,
          row.org_id,
          client.client_name || 'OAuth client',
          `OAuth (${client.client_name || clientId})`,
          row.resource || resource || mcpResource(),
        )
        return json(tokens)
      }

      if (grantType === 'refresh_token') {
        const refreshToken = String(body.refresh_token || '').trim()
        if (!refreshToken.startsWith('ra_mcp_rt_')) {
          return json({ error: 'invalid_grant' }, 400)
        }
        const hash = await sha256Hex(refreshToken)
        const { data: row } = await supabase
          .from('mcp_refresh_tokens')
          .select('*')
          .eq('token_hash', hash)
          .is('revoked_at', null)
          .maybeSingle()
        if (!row) return json({ error: 'invalid_grant' }, 400)
        if (new Date(row.expires_at).getTime() <= Date.now()) {
          return json({ error: 'invalid_grant', error_description: 'refresh expired' }, 400)
        }

        await supabase.from('mcp_refresh_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', row.id)
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
          row.label || 'OAuth refresh',
          row.resource,
        )
        return json(tokens)
      }

      return json({ error: 'unsupported_grant_type' }, 400)
    }

    return json({ error: 'not_found', path }, 404)
  } catch (error) {
    if (error instanceof Response) return error
    return json({
      error: 'server_error',
      error_description: error instanceof Error ? error.message : 'Request failed.',
    }, 500)
  }
})
