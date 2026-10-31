/**
 * RegAnchor — Governed Anthropic Messages gateway (self-contained deploy).
 * Authenticates an asset capability, resolves the Vault runtime key, routes
 * through Cloudflare AI Gateway when the organisation is enrolled, and records
 * every request (allowed, blocked or failed) in gateway_request_events.
 * Prompt and response content are stored only for organisations that opt in,
 * in the private gateway-content bucket; Cloudflare never keeps payloads.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, content-type, anthropic-version, anthropic-beta, x-reganchor-gateway-token',
  'Access-Control-Expose-Headers': 'x-reganchor-event-id, request-id',
}

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_CAPTURED_RESPONSE_BYTES = 8 * 1024 * 1024
const CONTENT_BUCKET = 'gateway-content'

const AIG_ACCOUNT_ID = Deno.env.get('CF_AIG_ACCOUNT_ID') || '40074a03408bb2b183c964e22d1e2bea'
const AIG_GATEWAY_ID = Deno.env.get('CF_AIG_GATEWAY_ID') || 'reganchor-governance'
const AIG_TOKEN = Deno.env.get('CF_AIG_TOKEN') || ''
const AIG_MESSAGES_URL =
  `https://gateway.ai.cloudflare.com/v1/${AIG_ACCOUNT_ID}/${AIG_GATEWAY_ID}/anthropic/v1/messages`
const ENVIRONMENT = Deno.env.get('GATEWAY_ENVIRONMENT') || 'production'

type Supabase = ReturnType<typeof getServiceClient>

type Route = 'ai_gateway' | 'direct' | 'direct_fallback' | 'none'

type Outcome =
  | 'success'
  | 'blocked_dlp_request'
  | 'blocked_dlp_response'
  | 'blocked_budget'
  | 'blocked_unpriced_model'
  | 'rate_limited'
  | 'provider_error'
  | 'gateway_error'
  | 'client_aborted'
  | 'stream_error'

type GatewaySettings = {
  route_via_ai_gateway: boolean
  fail_mode: 'open' | 'closed'
  capture_content: boolean
}

type UsageDetail = {
  model: string
  input_tokens: number
  output_tokens: number
  cache_write_5m_tokens: number
  cache_write_1h_tokens: number
  cache_read_tokens: number
  thinking_tokens: number
  web_search_requests: number
  web_fetch_requests: number
  code_execution_requests: number
  service_tier: string | null
  inference_geo: string | null
  speed: string | null
}

type EventContext = {
  id: string
  orgId: string
  assetId: string
  tokenId: string
  providerApiKeyId: string | null
  requestModel: string
  streamed: boolean
  route: Route
  startedAt: number
  latencyMs: number | null
  captureContent: boolean
  rawRequest: string
}

type EventResult = {
  outcome: Outcome
  httpStatus: number | null
  errorType?: string | null
  errorCode?: string | null
  usage: UsageDetail
  providerRequestId?: string | null
  aigLogId?: string | null
  dlp?: DlpHeader | null
  responseContent?: string | null
}

type DlpHeader = { action?: string; findings?: unknown[] }

type Enforcement = {
  allowed: boolean
  reason?: 'budget_reached' | 'unpriced_model'
  scope?: 'agent' | 'organisation'
}

const DEFAULT_SETTINGS: GatewaySettings = {
  route_via_ai_gateway: false,
  fail_mode: 'open',
  capture_content: false,
}

let partitionsCheckedAt = 0

function json(body: unknown, status = 200, extra?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...(extra || {}) },
  })
}

function anthropicError(type: string, message: string, status: number, eventId?: string) {
  return json(
    { type: 'error', error: { type, message } },
    status,
    eventId ? { 'x-reganchor-event-id': eventId } : undefined,
  )
}

function getServiceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  )
}

function edgeRuntime() {
  return (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime
}

function hasWaitUntil(): boolean {
  return typeof edgeRuntime()?.waitUntil === 'function'
}

function background(task: Promise<unknown>) {
  const runtime = edgeRuntime()
  if (runtime?.waitUntil) runtime.waitUntil(task)
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function gatewayToken(req: Request): string {
  const authorization = req.headers.get('Authorization') || ''
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || ''
  return bearer || (req.headers.get('x-reganchor-gateway-token') || '').trim()
}

async function readApiSecret(supabase: Supabase, connectionId: string) {
  const { data, error } = await supabase.rpc('provider_connection_read_secret', {
    p_connection_id: connectionId,
    p_slot: 'api',
  })
  if (error) throw error
  return data ? String(data) : null
}

async function loadSettings(supabase: Supabase, orgId: string): Promise<GatewaySettings> {
  const { data, error } = await supabase
    .from('org_gateway_settings')
    .select('route_via_ai_gateway,fail_mode,capture_content')
    .eq('org_id', orgId)
    .maybeSingle()
  if (error) {
    console.error('gateway settings read failed', error.message)
    return DEFAULT_SETTINGS
  }
  if (!data) return DEFAULT_SETTINGS
  return {
    route_via_ai_gateway: data.route_via_ai_gateway === true,
    fail_mode: data.fail_mode === 'closed' ? 'closed' : 'open',
    capture_content: data.capture_content === true,
  }
}

/** Null when the check could not run; the organisation's fail mode then decides. */
async function checkEnforcement(
  supabase: Supabase,
  orgId: string,
  assetId: string,
  model: string,
): Promise<Enforcement | null> {
  const { data, error } = await supabase.rpc('gateway_enforcement_check', {
    p_org_id: orgId,
    p_asset_id: assetId,
    p_model: model,
  })
  if (error || !data || typeof data !== 'object' || typeof (data as Enforcement).allowed !== 'boolean') {
    console.error('gateway enforcement check failed', error?.message || 'no result')
    return null
  }
  return data as Enforcement
}

function enforcementMessage(enforcement: Enforcement, model: string): string {
  if (enforcement.reason === 'unpriced_model') {
    return `RegAnchor has no verified price for ${model.slice(0, 100)}, so its spend cannot be measured against a ` +
      'blocking budget. Use a priced model, or ask an owner or admin to set the budget to monitor only.'
  }
  const who = enforcement.scope === 'organisation'
    ? 'Your organisation has reached its monthly AI budget'
    : 'This agent has reached its monthly budget'
  return `${who} in RegAnchor. New requests are refused until an owner or admin raises the budget or lifts the ` +
    'block, or the month ends (UTC).'
}

function ensurePartitions(supabase: Supabase) {
  const now = Date.now()
  if (now - partitionsCheckedAt < 6 * 60 * 60 * 1000) return
  partitionsCheckedAt = now
  background(
    Promise.resolve(supabase.rpc('gateway_events_ensure_partitions', { p_months_ahead: 3 })).then(({ error }) => {
      if (error) console.error('gateway partition check failed', error.message)
    }),
  )
}

function providerHeaders(req: Request, apiKey: string): Headers {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': req.headers.get('anthropic-version') || ANTHROPIC_VERSION,
  })
  const beta = req.headers.get('anthropic-beta')
  if (beta) headers.set('anthropic-beta', beta)
  return headers
}

function aiGatewayHeaders(req: Request, apiKey: string, ctx: EventContext): Headers {
  const headers = providerHeaders(req, apiKey)
  headers.set('cf-aig-authorization', `Bearer ${AIG_TOKEN}`)
  headers.set('cf-aig-collect-log-payload', 'false')
  headers.set('cf-aig-metadata', JSON.stringify({
    org_id: ctx.orgId,
    asset_id: ctx.assetId,
    token_id: ctx.tokenId,
    event_id: ctx.id,
    environment: ENVIRONMENT,
  }))
  return headers
}

function responseHeaders(upstream: Response, eventId: string): Headers {
  const headers = new Headers(corsHeaders)
  headers.set('Content-Type', upstream.headers.get('content-type') || 'application/json')
  headers.set('x-reganchor-event-id', eventId)
  for (const name of ['request-id', 'x-request-id', 'retry-after', 'cache-control']) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  upstream.headers.forEach((value, name) => {
    if (name.toLowerCase().startsWith('anthropic-ratelimit-')) headers.set(name, value)
  })
  return headers
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function emptyUsage(model: string): UsageDetail {
  return {
    model,
    input_tokens: 0,
    output_tokens: 0,
    cache_write_5m_tokens: 0,
    cache_write_1h_tokens: 0,
    cache_read_tokens: 0,
    thinking_tokens: 0,
    web_search_requests: 0,
    web_fetch_requests: 0,
    code_execution_requests: 0,
    service_tier: null,
    inference_geo: null,
    speed: null,
  }
}

/**
 * Merge an Anthropic usage block. Streaming deltas carry cumulative counts, so
 * the larger value always wins. Cache writes without a TTL breakdown use the
 * provider default (5 minutes).
 */
function mergeUsage(target: UsageDetail, raw: unknown) {
  if (!raw || typeof raw !== 'object') return
  const u = raw as Record<string, unknown>
  const creation = (u.cache_creation && typeof u.cache_creation === 'object')
    ? u.cache_creation as Record<string, unknown>
    : {}
  const server = (u.server_tool_use && typeof u.server_tool_use === 'object')
    ? u.server_tool_use as Record<string, unknown>
    : {}
  const outputDetails = (u.output_tokens_details && typeof u.output_tokens_details === 'object')
    ? u.output_tokens_details as Record<string, unknown>
    : {}

  const write1h = numberValue(creation.ephemeral_1h_input_tokens)
  const write5mReported = numberValue(creation.ephemeral_5m_input_tokens)
  const writeTotal = numberValue(u.cache_creation_input_tokens)
  const write5m = Math.max(write5mReported, writeTotal - write1h)

  target.input_tokens = Math.max(target.input_tokens, numberValue(u.input_tokens))
  target.output_tokens = Math.max(target.output_tokens, numberValue(u.output_tokens))
  target.cache_write_5m_tokens = Math.max(target.cache_write_5m_tokens, write5m)
  target.cache_write_1h_tokens = Math.max(target.cache_write_1h_tokens, write1h)
  target.cache_read_tokens = Math.max(target.cache_read_tokens, numberValue(u.cache_read_input_tokens))
  target.thinking_tokens = Math.max(target.thinking_tokens, numberValue(outputDetails.thinking_tokens))
  target.web_search_requests = Math.max(target.web_search_requests, numberValue(server.web_search_requests))
  target.web_fetch_requests = Math.max(target.web_fetch_requests, numberValue(server.web_fetch_requests))
  target.code_execution_requests = Math.max(
    target.code_execution_requests,
    numberValue(server.code_execution_requests),
  )
  target.service_tier = stringValue(u.service_tier) || target.service_tier
  target.inference_geo = stringValue(u.inference_geo) || target.inference_geo
  target.speed = stringValue(u.speed) || target.speed
}

function parseDlp(upstream: Response): DlpHeader | null {
  const raw = upstream.headers.get('cf-aig-dlp')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as DlpHeader
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/**
 * Errors raised by AI Gateway itself (not by Anthropic) come without an
 * Anthropic request-id and use Cloudflare's error envelope.
 */
function aiGatewayErrorCode(upstream: Response, body: string): number | null {
  if (upstream.headers.get('request-id')) return null
  try {
    const parsed = JSON.parse(body) as { error?: Array<{ code?: number }> | { code?: number } }
    const errors = Array.isArray(parsed.error) ? parsed.error : parsed.error ? [parsed.error] : []
    const code = errors.find((e) => typeof e?.code === 'number')?.code
    return typeof code === 'number' ? code : null
  } catch {
    return null
  }
}

function anthropicErrorType(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: { type?: string } }
    return stringValue(parsed.error?.type)
  } catch {
    return null
  }
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function storeContent(supabase: Supabase, ctx: EventContext, response: string | null): Promise<string | null> {
  const now = new Date()
  const path = [
    ctx.orgId,
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    `${ctx.id}.json.gz`,
  ].join('/')
  let request: unknown = ctx.rawRequest
  try {
    request = JSON.parse(ctx.rawRequest)
  } catch {
    // keep raw text
  }
  let parsedResponse: unknown = response
  if (response && !ctx.streamed) {
    try {
      parsedResponse = JSON.parse(response)
    } catch {
      // keep raw text
    }
  }
  const document = JSON.stringify({
    event_id: ctx.id,
    asset_id: ctx.assetId,
    captured_at: now.toISOString(),
    streamed: ctx.streamed,
    request,
    response: ctx.streamed ? { sse: response } : parsedResponse,
  })
  const { error } = await supabase.storage
    .from(CONTENT_BUCKET)
    .upload(path, await gzip(document), { contentType: 'application/gzip', upsert: false })
  if (error) {
    console.error('gateway content upload failed', error.message)
    return null
  }
  return path
}

async function recordEvent(supabase: Supabase, ctx: EventContext, result: EventResult) {
  let contentPath: string | null = null
  if (ctx.captureContent) {
    try {
      contentPath = await storeContent(supabase, ctx, result.responseContent ?? null)
    } catch (error) {
      console.error('gateway content capture failed', error instanceof Error ? error.message : 'unknown error')
    }
  }

  const usage = result.usage
  const dlpAction = result.dlp?.action === 'BLOCK' || result.dlp?.action === 'FLAG' ? result.dlp.action : null
  const { error } = await supabase.from('gateway_request_events').insert({
    id: ctx.id,
    org_id: ctx.orgId,
    asset_id: ctx.assetId,
    token_id: ctx.tokenId,
    provider: 'anthropic',
    endpoint: 'messages',
    environment: ENVIRONMENT,
    route: ctx.route,
    outcome: result.outcome,
    http_status: result.httpStatus,
    error_type: result.errorType || null,
    error_code: result.errorCode || null,
    streamed: ctx.streamed,
    latency_ms: ctx.latencyMs,
    duration_ms: Math.max(0, Math.round(performance.now() - ctx.startedAt)),
    request_model: ctx.requestModel,
    model: usage.model || ctx.requestModel,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_write_5m_tokens: usage.cache_write_5m_tokens,
    cache_write_1h_tokens: usage.cache_write_1h_tokens,
    cache_read_tokens: usage.cache_read_tokens,
    thinking_tokens: usage.thinking_tokens,
    web_search_requests: usage.web_search_requests,
    web_fetch_requests: usage.web_fetch_requests,
    code_execution_requests: usage.code_execution_requests,
    service_tier: usage.service_tier,
    inference_geo: usage.inference_geo,
    speed: usage.speed,
    provider_request_id: result.providerRequestId || null,
    provider_api_key_id: ctx.providerApiKeyId,
    aig_log_id: result.aigLogId || null,
    dlp_action: dlpAction,
    dlp: result.dlp || null,
    content_captured: contentPath !== null,
    content_path: contentPath,
  })
  if (error) console.error('gateway event insert failed', error.message)

  const usedAt = new Date()
  const { error: tokenError } = await supabase
    .from('asset_gateway_tokens')
    .update({ last_used_at: usedAt.toISOString() })
    .eq('id', ctx.tokenId)
    .or(`last_used_at.is.null,last_used_at.lt.${new Date(usedAt.getTime() - 60_000).toISOString()}`)
  if (tokenError) console.error('gateway token last use update failed', tokenError.message)

  if (result.outcome === 'success' && usage.model) {
    const { error: usageError } = await supabase.from('asset_usage_events').insert({
      asset_id: ctx.assetId,
      org_id: ctx.orgId,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      model: usage.model,
      source: 'gateway',
    })
    if (usageError) console.error('gateway usage insert failed', usageError.message)
  }
}

function observeStreamEvent(raw: string, usage: UsageDetail, state: { errorType: string | null }) {
  const dataLine = raw.split('\n').find((line) => line.startsWith('data:'))
  if (!dataLine) return
  const value = dataLine.slice(5).trim()
  if (!value || value === '[DONE]') return
  try {
    const event = JSON.parse(value) as {
      type?: string
      message?: { model?: string; usage?: unknown }
      usage?: unknown
      error?: { type?: string }
    }
    if (event.message?.model) usage.model = event.message.model
    if (event.message?.usage) mergeUsage(usage, event.message.usage)
    if (event.usage) mergeUsage(usage, event.usage)
    if (event.type === 'error') state.errorType = stringValue(event.error?.type) || 'stream_error'
  } catch {
    // keep stream intact
  }
}

function meteredStream(
  upstream: ReadableStream<Uint8Array>,
  ctx: EventContext,
  usage: UsageDetail,
  onComplete: (outcome: Outcome, errorType: string | null, captured: string | null) => Promise<void>,
): ReadableStream<Uint8Array> {
  const reader = upstream.getReader()
  const decoder = new TextDecoder()
  const state = { errorType: null as string | null }
  let buffer = ''
  let captured = ''
  let capturedBytes = 0
  let finished = false

  const observe = (chunk: Uint8Array) => {
    const text = decoder.decode(chunk, { stream: true })
    buffer += text
    const events = buffer.split(/\r?\n\r?\n/)
    buffer = events.pop() || ''
    for (const event of events) observeStreamEvent(event, usage, state)
    if (ctx.captureContent && capturedBytes < MAX_CAPTURED_RESPONSE_BYTES) {
      captured += text
      capturedBytes += chunk.byteLength
    }
  }

  const finish = (outcome: Outcome) => {
    if (finished) return Promise.resolve()
    finished = true
    buffer += decoder.decode()
    if (buffer) observeStreamEvent(buffer, usage, state)
    const finalOutcome = outcome === 'success' && state.errorType ? 'stream_error' : outcome
    return onComplete(finalOutcome, state.errorType, ctx.captureContent ? captured : null)
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          await finish('success')
          controller.close()
          return
        }
        observe(value)
        controller.enqueue(value)
      } catch (error) {
        controller.error(error)
        state.errorType = state.errorType || 'stream_interrupted'
        await finish('stream_error')
      }
    },
    async cancel(reason) {
      const done = finish('client_aborted')
      background(done)
      try {
        await reader.cancel(reason)
      } catch {
        // upstream already closed
      }
      await done
    },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return anthropicError('invalid_request_error', 'Method not allowed', 405)
  }

  const token = gatewayToken(req)
  if (!/^ra_gw_[A-Za-z0-9_-]{40,}$/.test(token)) {
    return anthropicError('authentication_error', 'Invalid gateway token', 401)
  }

  const declaredLength = Number(req.headers.get('content-length') || 0)
  if (declaredLength > MAX_BODY_BYTES) {
    return anthropicError('invalid_request_error', 'Request body is too large', 413)
  }

  try {
    const rawBody = await req.text()
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return anthropicError('invalid_request_error', 'Request body is too large', 413)
    }
    const body = JSON.parse(rawBody) as Record<string, unknown>
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return anthropicError('invalid_request_error', 'A JSON object is required', 400)
    }
    const model = String(body.model || '').trim()
    if (!model || !Array.isArray(body.messages)) {
      return anthropicError('invalid_request_error', 'model and messages are required', 400)
    }

    const supabase = getServiceClient()
    ensurePartitions(supabase)

    const tokenHash = await sha256(token)
    const { data: tokenRow } = await supabase
      .from('asset_gateway_tokens')
      .select('id,asset_id,org_id')
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
      .maybeSingle()
    if (!tokenRow) {
      return anthropicError('authentication_error', 'Invalid gateway token', 401)
    }

    const { data: asset } = await supabase
      .from('ai_systems')
      .select('id,org_id,provider_slug,deleted_at')
      .eq('id', tokenRow.asset_id)
      .eq('org_id', tokenRow.org_id)
      .maybeSingle()
    if (!asset || asset.deleted_at || asset.provider_slug !== 'anthropic') {
      return anthropicError('permission_error', 'Gateway asset is unavailable', 403)
    }

    const { data: connection } = await supabase
      .from('provider_connections')
      .select('id,credential_secret_id,status,runtime_api_key_id')
      .eq('asset_id', asset.id)
      .eq('provider_slug', 'anthropic')
      .eq('status', 'connected')
      .maybeSingle()
    if (!connection?.credential_secret_id) {
      return anthropicError('permission_error', 'Anthropic runtime connection is unavailable', 403)
    }
    const [apiKey, settings, enforcement] = await Promise.all([
      readApiSecret(supabase, connection.id),
      loadSettings(supabase, asset.org_id),
      checkEnforcement(supabase, asset.org_id, asset.id, model),
    ])
    if (!apiKey) {
      return anthropicError('permission_error', 'Anthropic runtime connection is unavailable', 403)
    }

    const useAiGateway = settings.route_via_ai_gateway && AIG_TOKEN.length > 0
    if (settings.route_via_ai_gateway && !useAiGateway) {
      console.error('gateway enrolled in AI Gateway but CF_AIG_TOKEN is not set')
    }

    const ctx: EventContext = {
      id: crypto.randomUUID(),
      orgId: asset.org_id,
      assetId: asset.id,
      tokenId: tokenRow.id,
      providerApiKeyId: connection.runtime_api_key_id || null,
      requestModel: model,
      streamed: body.stream === true,
      route: useAiGateway ? 'ai_gateway' : 'direct',
      startedAt: performance.now(),
      latencyMs: null,
      captureContent: settings.capture_content,
      rawRequest: rawBody,
    }
    const failClosed = settings.route_via_ai_gateway && settings.fail_mode === 'closed'

    const record = (result: EventResult) => recordEvent(supabase, ctx, result)

    if (!enforcement && settings.fail_mode === 'closed') {
      ctx.route = 'none'
      await record({
        outcome: 'gateway_error',
        httpStatus: 503,
        errorType: 'enforcement_unavailable',
        usage: emptyUsage(model),
      })
      return anthropicError('api_error', 'Budget checks are temporarily unavailable, so this request was not sent.', 503, ctx.id)
    }
    if (enforcement && !enforcement.allowed) {
      ctx.route = 'none'
      const unpriced = enforcement.reason === 'unpriced_model'
      await record({
        outcome: unpriced ? 'blocked_unpriced_model' : 'blocked_budget',
        httpStatus: 403,
        errorType: unpriced ? 'unpriced_model' : 'budget_reached',
        errorCode: unpriced ? null : enforcement.scope || null,
        usage: emptyUsage(model),
      })
      return anthropicError('permission_error', enforcementMessage(enforcement, model), 403, ctx.id)
    }

    let upstream: Response | null = null
    if (useAiGateway) {
      try {
        upstream = await fetch(AIG_MESSAGES_URL, {
          method: 'POST',
          headers: aiGatewayHeaders(req, apiKey, ctx),
          body: rawBody,
        })
      } catch (error) {
        console.error('ai gateway unreachable', error instanceof Error ? error.message : 'unknown error')
        upstream = null
      }

      if (upstream && !upstream.ok) {
        const errorBody = await upstream.clone().text()
        const code = aiGatewayErrorCode(upstream, errorBody)
        if (code !== null) {
          ctx.latencyMs = Math.round(performance.now() - ctx.startedAt)
          const dlp = parseDlp(upstream)
          const aigLogId = upstream.headers.get('cf-aig-log-id')
          if (code === 2029 || code === 2030) {
            const outcome: Outcome = code === 2029 ? 'blocked_dlp_request' : 'blocked_dlp_response'
            await record({
              outcome,
              httpStatus: upstream.status,
              errorType: 'dlp_blocked',
              errorCode: String(code),
              usage: emptyUsage(model),
              aigLogId,
              dlp,
            })
            return anthropicError(
              'invalid_request_error',
              code === 2029
                ? 'Request blocked by your organisation\'s data protection policy.'
                : 'Response blocked by your organisation\'s data protection policy.',
              400,
              ctx.id,
            )
          }
          if (upstream.status === 429) {
            await record({
              outcome: 'rate_limited',
              httpStatus: 429,
              errorType: 'gateway_rate_limit',
              errorCode: String(code),
              usage: emptyUsage(model),
              aigLogId,
            })
            return anthropicError('rate_limit_error', 'Gateway rate limit reached for this organisation.', 429, ctx.id)
          }
          console.error('ai gateway error', upstream.status, code)
          upstream = null
        }
      }

      if (!upstream) {
        if (failClosed) {
          ctx.latencyMs = Math.round(performance.now() - ctx.startedAt)
          await record({
            outcome: 'gateway_error',
            httpStatus: 503,
            errorType: 'ai_gateway_unavailable',
            usage: emptyUsage(model),
          })
          return anthropicError('api_error', 'Governed gateway is temporarily unavailable.', 503, ctx.id)
        }
        ctx.route = 'direct_fallback'
      }
    }

    if (!upstream) {
      upstream = await fetch(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: providerHeaders(req, apiKey),
        body: rawBody,
      })
    }
    ctx.latencyMs = Math.round(performance.now() - ctx.startedAt)

    const headers = responseHeaders(upstream, ctx.id)
    const dlp = parseDlp(upstream)
    const aigLogId = upstream.headers.get('cf-aig-log-id')
    const providerRequestId = upstream.headers.get('request-id')

    if (!upstream.ok || !upstream.body) {
      const errorBody = await upstream.text()
      await record({
        outcome: upstream.status === 429 ? 'rate_limited' : 'provider_error',
        httpStatus: upstream.status,
        errorType: anthropicErrorType(errorBody),
        usage: emptyUsage(model),
        providerRequestId,
        aigLogId,
        dlp,
      })
      return new Response(errorBody, { status: upstream.status, headers })
    }

    if (ctx.streamed) {
      headers.set('Content-Type', upstream.headers.get('content-type') || 'text/event-stream')
      const usage = emptyUsage(model)
      const stream = meteredStream(upstream.body, ctx, usage, (outcome, errorType, captured) =>
        record({
          outcome,
          httpStatus: upstream!.status,
          errorType,
          usage,
          providerRequestId,
          aigLogId,
          dlp,
          responseContent: captured,
        })
      )
      return new Response(stream, { status: upstream.status, headers })
    }

    const responseBody = await upstream.text()
    const usage = emptyUsage(model)
    try {
      const parsed = JSON.parse(responseBody) as { model?: string; usage?: unknown }
      if (parsed.model) usage.model = parsed.model
      mergeUsage(usage, parsed.usage)
    } catch {
      // usage unavailable; recorded with zero tokens and flagged by pricing
    }
    const recorded = record({
      outcome: 'success',
      httpStatus: upstream.status,
      usage,
      providerRequestId,
      aigLogId,
      dlp,
      responseContent: ctx.captureContent ? responseBody : null,
    })
    if (ctx.captureContent && hasWaitUntil()) background(recorded)
    else await recorded
    return new Response(responseBody, { status: upstream.status, headers })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return anthropicError('invalid_request_error', 'Invalid JSON body', 400)
    }
    console.error('gateway request failed', error instanceof Error ? error.message : 'unknown error')
    return anthropicError('api_error', 'Gateway request failed', 500)
  }
})
