/**
 * RegAnchor MCP HTTP endpoint (Streamable HTTP, JSON responses).
 * Auth: Bearer ra_mcp_at_… from mcp-auth device login.
 * verify_jwt: false — MCP access token is validated in-function.
 */
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, content-type, apikey, x-client-info, accept, mcp-session-id',
  'Access-Control-Expose-Headers': 'mcp-session-id, www-authenticate',
}

const SERVER_INFO = { name: 'reganchor', version: '1.0.0' }
const PROTOCOL_VERSION = '2025-03-26'

function mcpOauthBase(): string {
  return `${(Deno.env.get('SUPABASE_URL') || '').replace(/\/+$/, '')}/functions/v1/mcp-oauth`
}

function resourceMetadataUrl(): string {
  return `${mcpOauthBase()}/protected-resource`
}

function unauthorizedJson(message: string, id: JsonRpcId = null) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message }, id }), {
    status: 401,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'WWW-Authenticate':
        `Bearer FAKESECRET_g3h4i5j6k7l8m9n0o1p2", resource_metadata="${resourceMetadataUrl()}"`,
    },
  })
}

type JsonRpcId = string | number | null
type ToolResult = { content: Array<{ type: 'text'; text: string }>; structuredContent?: unknown; isError?: boolean }

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extraHeaders },
  })
}

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  )
}

function userClient(userJwt: string) {
  return createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || '',
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${userJwt}` } },
    },
  )
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function base64UrlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function mintUserJwt(userId: string, expiresSec = 3600): Promise<string> {
  const secret = Deno.env.get('SUPABASE_JWT_SECRET') || Deno.env.get('JWT_SECRET') || ''
  if (!secret) {
    throw new Error(
      'JWT signing secret is not configured on the mcp function (set edge secret JWT_SECRET to the project JWT Secret from Dashboard → Project Settings → API).',
    )
  }
  const now = Math.floor(Date.now() / 1000)
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64UrlEncode(JSON.stringify({
    sub: userId,
    role: 'authenticated',
    aud: 'authenticated',
    iss: 'supabase',
    iat: now,
    exp: now + expiresSec,
  }))
  const data = `${header}.${payload}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)))
  return `${data}.${base64UrlEncode(signature)}`
}

async function resolveMcpAccess(
  req: Request,
  opts: { mintJwt?: boolean } = {},
): Promise<{ userId: string; userJwt: string }> {
  const auth = req.headers.get('Authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!token.startsWith('ra_mcp_at_')) {
    throw new Error('Authorization required. Complete OAuth or device login to obtain a RegAnchor MCP access token.')
  }
  const supabase = serviceClient()
  const hash = await sha256(token)
  const { data: row } = await supabase
    .from('mcp_access_tokens')
    .select('id,user_id,expires_at,revoked_at')
    .eq('token_hash', hash)
    .maybeSingle()
  if (!row || row.revoked_at) throw new Error('Invalid MCP access token.')
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new Error('MCP access token expired. Refresh via mcp-auth action=refresh.')
  }
  // tools/list only needs a valid MCP token; mint JWT for tools/call (RLS).
  const mintJwt = opts.mintJwt !== false
  const userJwt = mintJwt ? await mintUserJwt(row.user_id) : ''
  return { userId: row.user_id, userJwt }
}

function toolSuccess(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  }
}

function toolFailure(error: unknown): ToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
  }
}

function assertQuery<T>(result: { data: T; error: { message: string } | null }, context: string): T {
  if (result.error) throw new Error(`${context}: ${result.error.message}`)
  return result.data
}

async function loadAsset(supabase: SupabaseClient, assetId: string) {
  const asset = assertQuery(
    await supabase.from('ai_systems').select('*').eq('id', assetId).is('deleted_at', null).maybeSingle(),
    'Could not load asset',
  )
  if (!asset) throw new Error('Asset not found or not visible to this user.')
  return asset
}

async function assertOrgAdmin(supabase: SupabaseClient, userId: string, orgId: string) {
  const membership = assertQuery(
    await supabase.from('org_members').select('role').eq('org_id', orgId).eq('user_id', userId).maybeSingle(),
    'Could not read organisation role',
  )
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    throw new Error('Only organisation owners and admins can run this tool.')
  }
}

const TOOL_DEFS = [
  {
    name: 'list_assets',
    description: 'List AI systems and agents visible through RegAnchor RLS.',
    inputSchema: {
      type: 'object',
      properties: {
        org_id: { type: 'string', format: 'uuid' },
        asset_kind: { type: 'string', enum: ['system', 'agent'] },
        provider_slug: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
      },
    },
  },
  {
    name: 'get_asset',
    description: 'Get one AI asset by UUID.',
    inputSchema: {
      type: 'object',
      properties: { asset_id: { type: 'string', format: 'uuid' } },
      required: ['asset_id'],
    },
  },
  {
    name: 'connection_status',
    description: 'Runtime and organisation Admin connection status. Never returns secrets.',
    inputSchema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string', format: 'uuid' },
        provider_slug: { type: 'string' },
      },
      required: ['asset_id'],
    },
  },
  {
    name: 'refresh_insights',
    description: 'Refresh Anthropic Admin insights for an asset (owner/admin).',
    inputSchema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string', format: 'uuid' },
        provider_slug: { type: 'string' },
        window_days: { type: 'integer', minimum: 1, maximum: 90, default: 30 },
      },
      required: ['asset_id'],
    },
  },
  {
    name: 'list_controls',
    description: 'List control assignments, definitions, tasks, and evidence metadata for an asset.',
    inputSchema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string', format: 'uuid' },
        include_org_controls: { type: 'boolean', default: true },
      },
      required: ['asset_id'],
    },
  },
  {
    name: 'policy_context',
    description: 'List adopted policies and the current user acknowledgment state.',
    inputSchema: {
      type: 'object',
      properties: {
        org_id: { type: 'string', format: 'uuid' },
        include_content: { type: 'boolean', default: true },
      },
    },
  },
  {
    name: 'gateway_tokens_list',
    description: 'List gateway tokens for an Anthropic asset (owner/admin).',
    inputSchema: {
      type: 'object',
      properties: { asset_id: { type: 'string', format: 'uuid' } },
      required: ['asset_id'],
    },
  },
  {
    name: 'gateway_token_mint',
    description: 'Mint a gateway token for an Anthropic asset (owner/admin). Plaintext returned once.',
    inputSchema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string', format: 'uuid' },
        label: { type: 'string', minLength: 1, maxLength: 80 },
      },
      required: ['asset_id', 'label'],
    },
  },
  {
    name: 'gateway_token_revoke',
    description: 'Revoke a gateway token (owner/admin).',
    inputSchema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string', format: 'uuid' },
        token_id: { type: 'string', format: 'uuid' },
      },
      required: ['asset_id', 'token_id'],
    },
  },
]

async function callEdge(
  userJwt: string,
  name: string,
  body: Record<string, unknown>,
) {
  const base = (Deno.env.get('SUPABASE_URL') || '').replace(/\/+$/, '')
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || ''
  const response = await fetch(`${base}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userJwt}`,
      apikey: anon,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error || payload.message || `${name} failed (${response.status})`)
  }
  return payload
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: { userId: string; userJwt: string; supabase: SupabaseClient },
): Promise<ToolResult> {
  try {
    const { supabase, userId, userJwt } = ctx
    if (name === 'list_assets') {
      const limit = Math.min(200, Math.max(1, Number(args.limit) || 100))
      let query = supabase.from('ai_systems').select('*').is('deleted_at', null).order('updated_at', { ascending: false }).limit(limit)
      if (args.org_id) query = query.eq('org_id', String(args.org_id))
      if (args.asset_kind) query = query.eq('asset_kind', String(args.asset_kind))
      if (args.provider_slug) query = query.eq('provider_slug', String(args.provider_slug))
      const assets = assertQuery(await query, 'Could not list assets') || []
      return toolSuccess({ count: assets.length, assets })
    }
    if (name === 'get_asset') {
      return toolSuccess({ asset: await loadAsset(supabase, String(args.asset_id)) })
    }
    if (name === 'connection_status') {
      const asset = await loadAsset(supabase, String(args.asset_id))
      const provider = String(args.provider_slug || asset.provider_slug || '').trim()
      if (!provider) throw new Error('No provider is configured on this asset.')
      const [runtime, organisationAdmin, membership] = await Promise.all([
        assertQuery(
          await supabase.from('provider_connections').select(
            'id,org_id,asset_id,provider_slug,status,auth_method,connected_by,connected_at,last_verified_at,last_error,metadata,created_at,updated_at,runtime_api_key_id,runtime_workspace_id',
          ).eq('asset_id', asset.id).eq('provider_slug', provider).neq('status', 'revoked').maybeSingle(),
          'Could not read runtime connection',
        ),
        assertQuery(
          await supabase.from('org_provider_credentials').select(
            'id,org_id,provider_slug,status,connected_by,connected_at,last_verified_at,last_error,metadata,created_at,updated_at',
          ).eq('org_id', asset.org_id).eq('provider_slug', provider).neq('status', 'revoked').maybeSingle(),
          'Could not read organisation provider connection',
        ),
        assertQuery(
          await supabase.from('org_members').select('role').eq('org_id', asset.org_id).eq('user_id', userId).maybeSingle(),
          'Could not read organisation role',
        ),
      ])
      return toolSuccess({
        asset: { id: asset.id, name: asset.name, org_id: asset.org_id, provider_slug: provider },
        runtime_connection: runtime,
        organisation_provider_admin: organisationAdmin,
        user_access: {
          role: membership?.role || null,
          is_org_admin: ['owner', 'admin'].includes(membership?.role || ''),
        },
      })
    }
    if (name === 'refresh_insights') {
      const asset = await loadAsset(supabase, String(args.asset_id))
      await assertOrgAdmin(supabase, userId, asset.org_id)
      const payload = await callEdge(userJwt, 'provider-insights', {
        asset_id: asset.id,
        provider_slug: args.provider_slug || asset.provider_slug,
        window_days: Number(args.window_days) || 30,
      })
      return toolSuccess(payload)
    }
    if (name === 'list_controls') {
      const asset = await loadAsset(supabase, String(args.asset_id))
      const includeOrg = args.include_org_controls !== false
      let assignmentsQuery = supabase.from('control_assignments').select('*').eq('org_id', asset.org_id)
      assignmentsQuery = includeOrg
        ? assignmentsQuery.or(`system_id.eq.${asset.id},system_id.is.null`)
        : assignmentsQuery.eq('system_id', asset.id)
      const assignments = assertQuery(await assignmentsQuery.order('updated_at', { ascending: false }), 'Could not read control assignments') || []
      if (!assignments.length) return toolSuccess({ asset: { id: asset.id, name: asset.name }, count: 0, controls: [] })
      const controlIds = [...new Set(assignments.map((row: { control_id: string }) => row.control_id).filter(Boolean))]
      const assignmentIds = assignments.map((row: { id: string }) => row.id)
      const [controls, tasks, evidence] = await Promise.all([
        assertQuery(await supabase.from('governance_controls').select('*').in('id', controlIds), 'Could not read control definitions') || [],
        assertQuery(await supabase.from('control_tasks').select('*').in('control_id', controlIds).order('display_order'), 'Could not read control tasks') || [],
        assertQuery(
          await supabase.from('evidence_uploads').select(
            'id,control_assignment_id,org_id,system_id,file_name,file_type,file_size,uploaded_by,uploaded_at',
          ).in('control_assignment_id', assignmentIds).order('uploaded_at', { ascending: false }),
          'Could not read control evidence',
        ) || [],
      ])
      const records = assignments.map((assignment: { id: string; control_id: string }) => ({
        assignment,
        control: controls.find((row: { id: string }) => row.id === assignment.control_id) || null,
        tasks: tasks.filter((row: { control_id: string }) => row.control_id === assignment.control_id),
        evidence: evidence.filter((row: { control_assignment_id: string }) => row.control_assignment_id === assignment.id),
      }))
      return toolSuccess({ asset: { id: asset.id, name: asset.name, org_id: asset.org_id }, count: records.length, controls: records })
    }
    if (name === 'policy_context') {
      const includeContent = args.include_content !== false
      const policyColumns = includeContent
        ? '*'
        : 'id,org_id,title,description,version,category,requires_acknowledgment,acknowledgment_frequency,linked_control_id,published_at,created_at,updated_at'
      let policyQuery = supabase.from('policy_documents').select(policyColumns).eq('is_active', true).not('published_at', 'is', null).order('created_at', { ascending: true })
      let acknowledgmentQuery = supabase.from('policy_acknowledgments').select('policy_id,org_id,version_acknowledged,acknowledged_at').eq('user_id', userId)
      if (args.org_id) {
        policyQuery = policyQuery.eq('org_id', String(args.org_id))
        acknowledgmentQuery = acknowledgmentQuery.eq('org_id', String(args.org_id))
      }
      const policies = assertQuery(await policyQuery, 'Could not read adopted policies') || []
      const acknowledgments = assertQuery(await acknowledgmentQuery, 'Could not read policy acknowledgments') || []
      const records = policies.map((policy: { id: string; version: string }) => {
        const acknowledgment = acknowledgments.find(
          (row: { policy_id: string; version_acknowledged: string }) =>
            row.policy_id === policy.id && row.version_acknowledged === policy.version,
        )
        return {
          ...policy,
          current_user_acknowledgment: acknowledgment || null,
          current_user_acknowledged: Boolean(acknowledgment),
        }
      })
      return toolSuccess({ count: records.length, policies: records })
    }
    if (name === 'gateway_tokens_list') {
      const asset = await loadAsset(supabase, String(args.asset_id))
      await assertOrgAdmin(supabase, userId, asset.org_id)
      return toolSuccess(await callEdge(userJwt, 'asset-gateway-token', { action: 'list', asset_id: asset.id }))
    }
    if (name === 'gateway_token_mint') {
      const asset = await loadAsset(supabase, String(args.asset_id))
      await assertOrgAdmin(supabase, userId, asset.org_id)
      return toolSuccess(await callEdge(userJwt, 'asset-gateway-token', {
        action: 'mint',
        asset_id: asset.id,
        label: String(args.label || '').trim(),
      }))
    }
    if (name === 'gateway_token_revoke') {
      const asset = await loadAsset(supabase, String(args.asset_id))
      await assertOrgAdmin(supabase, userId, asset.org_id)
      return toolSuccess(await callEdge(userJwt, 'asset-gateway-token', {
        action: 'revoke',
        asset_id: asset.id,
        token_id: String(args.token_id),
      }))
    }
    return toolFailure(`Unknown tool: ${name}`)
  } catch (error) {
    return toolFailure(error)
  }
}

async function handleRpc(
  message: Record<string, unknown>,
  ctx: { userId: string; userJwt: string; supabase: SupabaseClient } | null,
) {
  const id = (message.id ?? null) as JsonRpcId
  const method = String(message.method || '')
  const params = (message.params || {}) as Record<string, unknown>

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    })
  }
  if (method === 'notifications/initialized' || method === 'initialized') {
    return null
  }
  if (method === 'ping') {
    return rpcResult(id, {})
  }
  if (!ctx) {
    return rpcError(id, -32001, 'Unauthorized')
  }
  if (method === 'tools/list') {
    return rpcResult(id, { tools: TOOL_DEFS })
  }
  if (method === 'tools/call') {
    const name = String(params.name || '')
    const args = (params.arguments || {}) as Record<string, unknown>
    const result = await executeTool(name, args, ctx)
    return rpcResult(id, result)
  }
  return rpcError(id, -32601, `Method not found: ${method}`)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  if (req.method === 'GET') {
    const url = new URL(req.url)
    if (
      url.pathname.endsWith('/.well-known/oauth-protected-resource') ||
      url.searchParams.get('resource_metadata') === '1'
    ) {
      return json({
        resource: `${(Deno.env.get('SUPABASE_URL') || '').replace(/\/+$/, '')}/functions/v1/mcp`,
        authorization_servers: [mcpOauthBase()],
        scopes_supported: ['mcp:tools'],
        bearer_methods_supported: ['header'],
      })
    }
    return json({
      ok: true,
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
      transport: 'streamable-http-json',
      authorization: {
        protected_resource_metadata: resourceMetadataUrl(),
        authorization_server: mcpOauthBase(),
      },
      docs: 'https://reganchor.com — see docs/MCP-CONNECT.md',
    })
  }

  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  try {
    const body = await req.json()
    let ctx: { userId: string; userJwt: string; supabase: SupabaseClient } | null = null
    const method = String(body?.method || '')
    const authHeader = req.headers.get('Authorization') || ''
    const hasMcpBearer = /Bearer\s+ra_mcp_at_/i.test(authHeader)
    // Notifications may be unauthenticated. Everything else (including initialize)
    // requires an MCP access token so Cursor receives a 401 + WWW-Authenticate
    // challenge and can start OAuth (apex /.well-known on supabase.co is not ours).
    const isNotification =
      method === 'notifications/initialized' ||
      method === 'initialized' ||
      method === 'notifications/cancelled'
    if (!isNotification) {
      if (!hasMcpBearer) {
        return unauthorizedJson(
          'Authorization required. Sign in via OAuth or device login to use RegAnchor MCP.',
          (body?.id ?? null) as JsonRpcId,
        )
      }
      // Validate token always; mint user JWT only for RLS-backed tool calls.
      const resolved = await resolveMcpAccess(req, { mintJwt: method === 'tools/call' })
      ctx = {
        ...resolved,
        supabase: resolved.userJwt ? userClient(resolved.userJwt) : serviceClient(),
      }
    }

    if (Array.isArray(body)) {
      const results = []
      for (const item of body) {
        const out = await handleRpc(item, ctx)
        if (out) results.push(out)
      }
      if (!results.length) return new Response(null, { status: 202, headers: corsHeaders })
      return json(results.length === 1 ? results[0] : results)
    }

    const out = await handleRpc(body, ctx)
    if (!out) return new Response(null, { status: 202, headers: corsHeaders })
    const sessionHeaders: Record<string, string> = {}
    if (method === 'initialize' && ctx) {
      sessionHeaders['Mcp-Session-Id'] = crypto.randomUUID()
    }
    return json(out, 200, sessionHeaders)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed.'
    if (/token|Unauthorized|Sign in|expired|Invalid MCP/i.test(message)) {
      return unauthorizedJson(message)
    }
    return json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }, 500)
  }
})
