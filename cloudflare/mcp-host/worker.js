/**
 * Cloudflare Worker: mcp.reganchor.com
 *
 * Cursor often opens `{origin}/authorize` (not the full path issuer).
 * So this host uses a PATHLESS issuer: https://mcp.reganchor.com
 * with /authorize /token /register at the apex — then proxies to Supabase.
 *
 * Also serves /.well-known/* (impossible on *.supabase.co).
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const supabase = (env.SUPABASE_URL || '').replace(/\/+$/, '')
    const anon = env.SUPABASE_ANON_KEY || ''
    const origin = url.origin
    const resource = env.PUBLIC_MCP_RESOURCE || `${origin}/mcp`
    const issuer = env.PUBLIC_OAUTH_ISSUER || origin

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors() })
    }

    // --- OAuth discovery (apex) ---
    if (
      url.pathname === '/.well-known/oauth-protected-resource' ||
      url.pathname.startsWith('/.well-known/oauth-protected-resource/')
    ) {
      return json(prm(resource, issuer))
    }
    if (
      url.pathname === '/.well-known/oauth-authorization-server' ||
      url.pathname.startsWith('/.well-known/oauth-authorization-server/')
    ) {
      return json(asMetadata(issuer))
    }

    if (url.pathname === '/' || url.pathname === '/health') {
      return json({ ok: true, name: 'reganchor-mcp', mcp: resource, oauth: issuer })
    }

    // --- OAuth AS endpoints at apex (Cursor-compatible) ---
    if (url.pathname === '/authorize' || url.pathname.startsWith('/authorize?')) {
      return proxy(`${supabase}/functions/v1/mcp-oauth/authorize${url.search}`, request, anon, false)
    }
    if (url.pathname === '/token') {
      return proxy(`${supabase}/functions/v1/mcp-oauth/token`, request, anon, false)
    }
    if (url.pathname === '/register') {
      return proxy(`${supabase}/functions/v1/mcp-oauth/register`, request, anon, false)
    }
    if (url.pathname === '/consent') {
      return proxy(`${supabase}/functions/v1/mcp-oauth/consent`, request, anon, false)
    }
    if (url.pathname === '/protected-resource') {
      return json(prm(resource, issuer))
    }

    // --- MCP resource ---
    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
      const rest = url.pathname.slice('/mcp'.length) || ''
      if (rest.includes('.well-known/oauth-protected-resource')) {
        return json(prm(resource, issuer))
      }
      const target = `${supabase}/functions/v1/mcp${rest === '/' ? '' : rest}${url.search}`
      return proxy(target, request, anon, true, resource)
    }

    // Legacy /v1/* aliases
    if (url.pathname.startsWith('/v1/oauth')) {
      const rest = url.pathname.slice('/v1/oauth'.length) || ''
      if (!rest || rest === '/') return json(asMetadata(issuer))
      return proxy(`${supabase}/functions/v1/mcp-oauth${rest}${url.search}`, request, anon, false)
    }
    if (url.pathname.startsWith('/v1/mcp')) {
      const rest = url.pathname.slice('/v1/mcp'.length) || ''
      return proxy(`${supabase}/functions/v1/mcp${rest}${url.search}`, request, anon, true, resource)
    }

    return json({ error: 'not_found', hint: 'Use /mcp and /authorize on this host' }, 404)
  },
}

function prm(resource, issuer) {
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: ['mcp:tools'],
    bearer_methods_supported: ['header'],
  }
}

function asMetadata(issuer) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp:tools'],
    resource_indicator_parameter_supported: true,
  }
}

async function proxy(target, request, anon, injectApiKey, resource) {
  const headers = new Headers(request.headers)
  headers.delete('host')
  if (injectApiKey && anon && !headers.has('apikey')) headers.set('apikey', anon)
  const init = { method: request.method, headers, redirect: 'manual' }
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body
  const res = await fetch(target, init)
  const out = new Headers(res.headers)
  out.set('access-control-allow-origin', '*')
  out.set('access-control-expose-headers', 'www-authenticate, mcp-session-id, location')
  const www = out.get('www-authenticate')
  if (www && resource) {
    const prmUrl = `${new URL(resource).origin}/.well-known/oauth-protected-resource`
    out.set(
      'www-authenticate',
      www.replace(/resource_metadata="[^"]*"/, `resource_metadata="${prmUrl}"`),
    )
  }
  return new Response(res.body, { status: res.status, headers: out })
}

function cors() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers':
      'authorization, content-type, apikey, accept, mcp-session-id',
    'access-control-expose-headers': 'www-authenticate, mcp-session-id, location',
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...cors() },
  })
}
