/**
 * RegAnchor — Governed Anthropic Messages gateway (self-contained deploy).
 * Authenticates an asset capability, resolves Vault runtime key, meters tokens.
 * Prompt/completion content are never persisted.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, content-type, anthropic-version, anthropic-beta, x-reganchor-gateway-token',
}

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MAX_BODY_BYTES = 2 * 1024 * 1024

type Usage = { input_tokens: number; output_tokens: number; model: string }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function getServiceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  )
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

async function readApiSecret(supabase: ReturnType<typeof getServiceClient>, connectionId: string) {
  const { data, error } = await supabase.rpc('provider_connection_read_secret', {
    p_connection_id: connectionId,
    p_slot: 'api',
  })
  if (error) throw error
  return data ? String(data) : null
}

function upstreamHeaders(req: Request, apiKey: string): Headers {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': req.headers.get('anthropic-version') || ANTHROPIC_VERSION,
  })
  const beta = req.headers.get('anthropic-beta')
  if (beta) headers.set('anthropic-beta', beta)
  return headers
}

function responseHeaders(upstream: Response): Headers {
  const headers = new Headers(corsHeaders)
  headers.set('Content-Type', upstream.headers.get('content-type') || 'application/json')
  for (const name of ['request-id', 'x-request-id', 'retry-after', 'cache-control']) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  upstream.headers.forEach((value, name) => {
    if (name.toLowerCase().startsWith('anthropic-ratelimit-')) headers.set(name, value)
  })
  return headers
}

async function recordUsage(
  supabase: ReturnType<typeof getServiceClient>,
  assetId: string,
  orgId: string,
  usage: Usage,
) {
  if (!usage.model) return
  const { error } = await supabase.from('asset_usage_events').insert({
    asset_id: assetId,
    org_id: orgId,
    input_tokens: Math.max(0, Math.floor(usage.input_tokens || 0)),
    output_tokens: Math.max(0, Math.floor(usage.output_tokens || 0)),
    model: usage.model,
    source: 'gateway',
  })
  if (error) console.error('gateway usage insert failed', error.message)
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function observeStreamEvent(raw: string, usage: Usage) {
  const dataLine = raw.split('\n').find((line) => line.startsWith('data:'))
  if (!dataLine) return
  const value = dataLine.slice(5).trim()
  if (!value || value === '[DONE]') return
  try {
    const event = JSON.parse(value) as {
      message?: { model?: string; usage?: { input_tokens?: number; output_tokens?: number } }
      usage?: { input_tokens?: number; output_tokens?: number }
    }
    if (event.message?.model) usage.model = event.message.model
    const eventUsage = event.message?.usage || event.usage
    if (eventUsage) {
      usage.input_tokens = Math.max(usage.input_tokens, numberValue(eventUsage.input_tokens))
      usage.output_tokens = Math.max(usage.output_tokens, numberValue(eventUsage.output_tokens))
    }
  } catch {
    // keep stream intact
  }
}

function meteredStream(
  upstream: ReadableStream<Uint8Array>,
  onComplete: (usage: Usage) => Promise<void>,
  initialModel: string,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  let buffer = ''
  const usage: Usage = { input_tokens: 0, output_tokens: 0, model: initialModel }
  return upstream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk)
      buffer += decoder.decode(chunk, { stream: true })
      const events = buffer.split(/\r?\n\r?\n/)
      buffer = events.pop() || ''
      for (const event of events) observeStreamEvent(event, usage)
    },
    async flush() {
      buffer += decoder.decode()
      if (buffer) observeStreamEvent(buffer, usage)
      await onComplete(usage)
    },
  }))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ type: 'error', error: { type: 'invalid_request_error', message: 'Method not allowed' } }, 405)
  }

  const token = gatewayToken(req)
  if (!/^ra_gw_[A-Za-z0-9_-]{40,}$/.test(token)) {
    return json({ type: 'error', error: { type: 'authentication_error', message: 'Invalid gateway token' } }, 401)
  }

  const declaredLength = Number(req.headers.get('content-length') || 0)
  if (declaredLength > MAX_BODY_BYTES) {
    return json({ type: 'error', error: { type: 'invalid_request_error', message: 'Request body is too large' } }, 413)
  }

  try {
    const rawBody = await req.text()
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return json({ type: 'error', error: { type: 'invalid_request_error', message: 'Request body is too large' } }, 413)
    }
    const body = JSON.parse(rawBody) as Record<string, unknown>
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json({ type: 'error', error: { type: 'invalid_request_error', message: 'A JSON object is required' } }, 400)
    }
    const model = String(body.model || '').trim()
    if (!model || !Array.isArray(body.messages)) {
      return json({ type: 'error', error: { type: 'invalid_request_error', message: 'model and messages are required' } }, 400)
    }

    const supabase = getServiceClient()
    const tokenHash = await sha256(token)
    const { data: tokenRow } = await supabase
      .from('asset_gateway_tokens')
      .select('id,asset_id,org_id')
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
      .maybeSingle()
    if (!tokenRow) {
      return json({ type: 'error', error: { type: 'authentication_error', message: 'Invalid gateway token' } }, 401)
    }

    const { data: asset } = await supabase
      .from('ai_systems')
      .select('id,org_id,provider_slug,deleted_at')
      .eq('id', tokenRow.asset_id)
      .eq('org_id', tokenRow.org_id)
      .maybeSingle()
    if (!asset || asset.deleted_at || asset.provider_slug !== 'anthropic') {
      return json({ type: 'error', error: { type: 'permission_error', message: 'Gateway asset is unavailable' } }, 403)
    }

    const { data: connection } = await supabase
      .from('provider_connections')
      .select('id,credential_secret_id,status')
      .eq('asset_id', asset.id)
      .eq('provider_slug', 'anthropic')
      .eq('status', 'connected')
      .maybeSingle()
    if (!connection?.credential_secret_id) {
      return json({ type: 'error', error: { type: 'permission_error', message: 'Anthropic runtime connection is unavailable' } }, 403)
    }
    const apiKey = await readApiSecret(supabase, connection.id)
    if (!apiKey) {
      return json({ type: 'error', error: { type: 'permission_error', message: 'Anthropic runtime connection is unavailable' } }, 403)
    }

    const upstream = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: upstreamHeaders(req, apiKey),
      body: rawBody,
    })
    const headers = responseHeaders(upstream)
    if (!upstream.ok || !upstream.body) {
      return new Response(upstream.body, { status: upstream.status, headers })
    }

    if (body.stream === true) {
      headers.set('Content-Type', upstream.headers.get('content-type') || 'text/event-stream')
      const stream = meteredStream(
        upstream.body,
        (usage) => recordUsage(supabase, asset.id, asset.org_id, usage),
        model,
      )
      return new Response(stream, { status: upstream.status, headers })
    }

    const responseBody = await upstream.text()
    try {
      const parsed = JSON.parse(responseBody) as {
        model?: string
        usage?: { input_tokens?: number; output_tokens?: number }
      }
      await recordUsage(supabase, asset.id, asset.org_id, {
        model: parsed.model || model,
        input_tokens: numberValue(parsed.usage?.input_tokens),
        output_tokens: numberValue(parsed.usage?.output_tokens),
      })
    } catch {
      // optional metering
    }
    return new Response(responseBody, { status: upstream.status, headers })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return json({ type: 'error', error: { type: 'invalid_request_error', message: 'Invalid JSON body' } }, 400)
    }
    console.error('gateway request failed', error instanceof Error ? error.message : 'unknown error')
    return json({
      type: 'error',
      error: { type: 'api_error', message: 'Gateway request failed' },
    }, 500)
  }
})
