/**
 * RegAnchor — Governed Anthropic Messages gateway.
 * Authenticates an asset capability and sends the request to the asset's infrastructure:
 * Anthropic's API with the Vault runtime key, or Amazon Bedrock's Anthropic Messages endpoint in
 * the client's AWS account (assumed role, SigV4, or a Bedrock API key). Routes through Cloudflare
 * AI Gateway when the organisation is enrolled, and records every request (allowed, blocked or
 * failed) in gateway_request_events.
 * Prompt and response content are stored only for organisations that opt in,
 * in the private gateway-content bucket; Cloudflare never keeps payloads.
 *
 * Guardrails: pause, blocked models, registered model and budgets are checked in the database;
 * custom rules are matched here; Cloudflare-enforced guardrails run on the organisation's own AI
 * Gateway. Guardrail tests from gateway-guardrails arrive signed in x-reganchor-check instead of
 * with a gateway token, and are recorded with is_check so they stay out of spend.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'
import { assumeRole, AwsConnectError, type TempCredentials } from '../_shared/aws.ts'
import {
  dlpHits,
  type GuardrailHit,
  GUARDRAIL_BY_KEY,
  guardrailKeyForCategory,
  verifyCheck,
} from '../_shared/guardrails.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, content-type, anthropic-version, anthropic-beta, x-reganchor-gateway-token',
  'Access-Control-Expose-Headers': 'x-reganchor-event-id, request-id, x-amzn-requestid',
}

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_CAPTURED_RESPONSE_BYTES = 8 * 1024 * 1024
const CONTENT_BUCKET = 'gateway-content'

const AIG_ACCOUNT_ID = Deno.env.get('CF_AIG_ACCOUNT_ID') || '40074a03408bb2b183c964e22d1e2bea'
const AIG_GATEWAY_ID = Deno.env.get('CF_AIG_GATEWAY_ID') || 'reganchor-governance'
const AIG_TOKEN = Deno.env.get('CF_AIG_TOKEN') || ''
/** Reads guardrail results from AI Gateway logs (AI Gateway Read). */
const AIG_ADMIN_TOKEN = Deno.env.get('CF_AIG_ADMIN_TOKEN') || ''
const CHECK_SECRET = Deno.env.get('GATEWAY_CHECK_SECRET') || ''
const ENVIRONMENT = Deno.env.get('GATEWAY_ENVIRONMENT') || 'production'
/** Prompt text scanned by custom rules. */
const MAX_RULE_SCAN_CHARS = 200_000

// Claude on Bedrock: optional inference profile (eu., us., global.), then anthropic.<model>.
const BEDROCK_MODEL_RE = /^(?:[a-z][a-z-]*\.)?anthropic\.[a-z0-9][a-z0-9.:_-]*$/i
const AWS_REGION_RE = /^[a-z]{2}(-[a-z]+)+-\d$/
const ROLE_SESSION_SECONDS = 3600
const ROLE_REFRESH_MS = 5 * 60_000
// Signature or key rejections on the AI Gateway path mean Cloudflare altered the request, not
// that the client's credentials are wrong, so the request is retried direct under fail open.
const BEDROCK_AUTH_ERRORS = new Set([
  'InvalidSignatureException',
  'IncompleteSignatureException',
  'MissingAuthenticationTokenException',
  'UnrecognizedClientException',
  'SignatureDoesNotMatch',
])

type Supabase = ReturnType<typeof getServiceClient>

type Route = 'ai_gateway' | 'direct' | 'direct_fallback' | 'none'

type Infrastructure = 'anthropic_api' | 'aws_bedrock'

type AwsAccount = {
  id: string
  method: 'role' | 'api_key'
  role_arn: string | null
  external_id: string
  connection_ref: string
  home_region: string
}

type Upstream = {
  directUrl: string
  aiGatewayUrl: string
  headers: Headers
}

type Outcome =
  | 'success'
  | 'blocked_dlp_request'
  | 'blocked_dlp_response'
  | 'blocked_budget'
  | 'blocked_unpriced_model'
  | 'blocked_unapproved_model'
  | 'blocked_model_policy'
  | 'blocked_agent_paused'
  | 'blocked_custom_rule'
  | 'blocked_guardrail_prompt'
  | 'blocked_guardrail_response'
  | 'rate_limited'
  | 'provider_error'
  | 'gateway_error'
  | 'client_aborted'
  | 'stream_error'

type GatewaySettings = {
  route_via_ai_gateway: boolean
  fail_mode: 'open' | 'closed'
  capture_content: boolean
  /** The organisation's own Cloudflare AI Gateway; null uses the shared one. */
  cf_gateway_id: string | null
  /** Cloudflare content and prompt injection guardrails that are on, by key. */
  cf_modes: Map<string, 'flag' | 'block'>
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
  tools_called: string[]
}

type EventContext = {
  id: string
  orgId: string
  assetId: string
  /** Null for guardrail tests, which are signed by gateway-guardrails instead. */
  tokenId: string | null
  isCheck: boolean
  /** Guardrails that fired so far: enforcement and custom rules, then Cloudflare results. */
  hits: GuardrailHit[]
  providerApiKeyId: string | null
  infrastructure: Infrastructure
  awsAccountId: string | null
  awsRegion: string | null
  requestModel: string
  streamed: boolean
  route: Route
  startedAt: number
  latencyMs: number | null
  captureContent: boolean
  rawRequest: string
  toolsOffered: string[]
  /** Null when the agent has no approved models or the check could not run. */
  modelApproved: boolean | null
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

type CustomRule = { id: string; label: string; match_type: 'phrase' | 'pattern'; pattern: string }

type Enforcement = {
  allowed: boolean
  reason?: 'budget_reached' | 'unpriced_model' | 'unapproved_model' | 'agent_paused' | 'blocked_model' | 'unregistered_model'
  scope?: 'agent' | 'organisation'
  model_approved?: boolean | null
  hits?: GuardrailHit[]
  custom_rules?: { mode: 'flag' | 'block'; rules: CustomRule[] }
}

const DEFAULT_SETTINGS: GatewaySettings = {
  route_via_ai_gateway: false,
  fail_mode: 'open',
  capture_content: false,
  cf_gateway_id: null,
  cf_modes: new Map(),
}

const OUTCOME_BY_REASON: Record<NonNullable<Enforcement['reason']>, Outcome> = {
  budget_reached: 'blocked_budget',
  unpriced_model: 'blocked_unpriced_model',
  unapproved_model: 'blocked_unapproved_model',
  agent_paused: 'blocked_agent_paused',
  blocked_model: 'blocked_model_policy',
  unregistered_model: 'blocked_model_policy',
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
  const [{ data, error }, guardrails] = await Promise.all([
    supabase
      .from('org_gateway_settings')
      .select('route_via_ai_gateway,fail_mode,capture_content,cf_gateway_id')
      .eq('org_id', orgId)
      .maybeSingle(),
    supabase
      .from('org_guardrails')
      .select('key,mode')
      .eq('org_id', orgId)
      .neq('mode', 'off')
      .or('key.like.content_s%,key.eq.prompt_injection'),
  ])
  if (error) {
    console.error('gateway settings read failed', error.message)
    return DEFAULT_SETTINGS
  }
  if (!data) return DEFAULT_SETTINGS
  const cfModes = new Map<string, 'flag' | 'block'>()
  for (const row of guardrails.data || []) cfModes.set(row.key, row.mode === 'block' ? 'block' : 'flag')
  return {
    route_via_ai_gateway: data.route_via_ai_gateway === true,
    fail_mode: data.fail_mode === 'closed' ? 'closed' : 'open',
    capture_content: data.capture_content === true,
    cf_gateway_id: data.cf_gateway_id || null,
    cf_modes: cfModes,
  }
}

/** Null when the check could not run; the organisation's fail mode then decides. */
async function checkEnforcement(
  supabase: Supabase,
  orgId: string,
  assetId: string,
  model: string,
  infrastructure: Infrastructure,
  awsRegion: string | null,
): Promise<Enforcement | null> {
  const { data, error } = await supabase.rpc('gateway_enforcement_check', {
    p_org_id: orgId,
    p_asset_id: assetId,
    p_model: model,
    p_infrastructure: infrastructure,
    p_aws_region: awsRegion,
  })
  if (error || !data || typeof data !== 'object' || typeof (data as Enforcement).allowed !== 'boolean') {
    console.error('gateway enforcement check failed', error?.message || 'no result')
    return null
  }
  return data as Enforcement
}

function enforcementMessage(enforcement: Enforcement, model: string): string {
  if (enforcement.reason === 'agent_paused') {
    return 'This agent is paused in RegAnchor. Requests are refused until an owner or admin resumes it.'
  }
  if (enforcement.reason === 'blocked_model') {
    return `Your organisation has blocked ${model.slice(0, 100)} in RegAnchor. Use a different model.`
  }
  if (enforcement.reason === 'unregistered_model' || enforcement.reason === 'unapproved_model') {
    return `${model.slice(0, 100)} is not this agent's registered model in RegAnchor. Use its registered model, ` +
      'or ask an owner or admin to update the registration.'
  }
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

function messagesHeaders(req: Request): Headers {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'anthropic-version': req.headers.get('anthropic-version') || ANTHROPIC_VERSION,
  })
  const beta = req.headers.get('anthropic-beta')
  if (beta) headers.set('anthropic-beta', beta)
  return headers
}

function providerHeaders(req: Request, apiKey: string): Headers {
  const headers = messagesHeaders(req)
  headers.set('x-api-key', apiKey)
  return headers
}

const roleSessions = new Map<string, Promise<{ creds: TempCredentials; expiresAt: number }>>()

/** Temporary credentials for the client's RegAnchor role, reused until five minutes before expiry. */
async function roleCredentials(account: AwsAccount): Promise<TempCredentials> {
  const key = `${account.id}:${account.role_arn}`
  const cached = roleSessions.get(key)
  if (cached) {
    try {
      const session = await cached
      if (session.expiresAt - Date.now() > ROLE_REFRESH_MS) return session.creds
    } catch {
      // assume the role again below
    }
  }
  const pending = assumeRole(
    account.role_arn || '',
    account.external_id,
    `reganchor-gateway-${account.connection_ref}`,
    ROLE_SESSION_SECONDS,
  ).then((creds) => ({ creds, expiresAt: Date.parse(creds.expiration) || Date.now() + 15 * 60_000 }))
  roleSessions.set(key, pending)
  pending.catch(() => {
    if (roleSessions.get(key) === pending) roleSessions.delete(key)
  })
  return (await pending).creds
}

function aiGatewayBase(gatewayId: string | null) {
  return `https://gateway.ai.cloudflare.com/v1/${AIG_ACCOUNT_ID}/${gatewayId || AIG_GATEWAY_ID}`
}

function bedrockUrls(region: string, gatewayId: string | null) {
  return {
    directUrl: `https://bedrock-runtime.${region}.amazonaws.com/anthropic/v1/messages`,
    aiGatewayUrl: `${aiGatewayBase(gatewayId)}/aws-bedrock/bedrock-runtime/${region}/anthropic/v1/messages`,
  }
}

/** Headers for Bedrock's Anthropic Messages endpoint, signed for the AWS URL (Cloudflare forwards them unchanged). */
async function bedrockUpstream(
  supabase: Supabase,
  req: Request,
  account: AwsAccount,
  region: string,
  body: string,
  gatewayId: string | null,
): Promise<Upstream> {
  const urls = bedrockUrls(region, gatewayId)
  const base = messagesHeaders(req)
  if (account.method === 'api_key') {
    const { data, error } = await supabase.rpc('org_aws_account_read_secret', { p_account_id: account.id })
    if (error || !data) throw new AwsConnectError('invalid_key', 'The stored Bedrock API key is missing.')
    base.set('x-api-key', String(data))
    return { ...urls, headers: base }
  }
  const creds = await roleCredentials(account)
  const client = new AwsClient({
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    sessionToken: creds.sessionToken,
    service: 'bedrock',
    region,
    retries: 0,
  })
  const signed = await client.sign(urls.directUrl, { method: 'POST', headers: base, body })
  return { ...urls, headers: new Headers(signed.headers) }
}

function awsErrorType(upstream: Response, body: string): string | null {
  const header = upstream.headers.get('x-amzn-errortype')?.split(':')[0]
  if (header) return header
  try {
    const type = (JSON.parse(body) as { __type?: string }).__type
    return type ? String(type).split('#').pop() || null : null
  } catch {
    return null
  }
}

const ERROR_TYPE_BY_STATUS: Record<number, string> = {
  400: 'invalid_request_error',
  401: 'authentication_error',
  403: 'permission_error',
  404: 'not_found_error',
  413: 'request_too_large',
  429: 'rate_limit_error',
  529: 'overloaded_error',
}

/** Bedrock errors not already in Anthropic's shape are wrapped so Anthropic SDKs read them. */
function bedrockErrorBody(status: number, body: string, awsType: string | null): string {
  const type = ERROR_TYPE_BY_STATUS[status] || (status >= 500 ? 'api_error' : 'invalid_request_error')
  let message = ''
  try {
    const parsed = JSON.parse(body) as { type?: string; error?: { type?: string }; message?: string; Message?: string }
    if (parsed.type === 'error' && parsed.error?.type) return body
    message = String(parsed.message || parsed.Message || '').slice(0, 500)
  } catch {
    // not JSON
  }
  return JSON.stringify({
    type: 'error',
    error: { type, message: message ? `Amazon Bedrock: ${message}` : `Amazon Bedrock returned an error (${awsType || status}).` },
  })
}

function aiGatewayHeaders(base: Headers, ctx: EventContext): Headers {
  const headers = new Headers(base)
  headers.set('cf-aig-authorization', `Bearer ${AIG_TOKEN}`)
  headers.set('cf-aig-collect-log-payload', 'false')
  headers.set('cf-aig-metadata', JSON.stringify({
    org_id: ctx.orgId,
    asset_id: ctx.assetId,
    token_id: ctx.tokenId || 'check',
    event_id: ctx.id,
    environment: ENVIRONMENT,
  }))
  return headers
}

function responseHeaders(upstream: Response, eventId: string): Headers {
  const headers = new Headers(corsHeaders)
  headers.set('Content-Type', upstream.headers.get('content-type') || 'application/json')
  headers.set('x-reganchor-event-id', eventId)
  for (const name of ['request-id', 'x-request-id', 'x-amzn-requestid', 'retry-after', 'cache-control']) {
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
    tools_called: [],
  }
}

const MAX_TOOL_NAMES = 128

function addToolName(list: string[], value: unknown) {
  if (typeof value !== 'string') return
  const name = value.trim().slice(0, 200)
  if (name && !list.includes(name) && list.length < MAX_TOOL_NAMES) list.push(name)
}

/** Tools the request makes available: custom tools by name, server tools by name or type, MCP servers as mcp:<name>. */
function offeredTools(body: Record<string, unknown>): string[] {
  const names: string[] = []
  if (Array.isArray(body.tools)) {
    for (const tool of body.tools) {
      if (!tool || typeof tool !== 'object') continue
      const t = tool as Record<string, unknown>
      addToolName(names, stringValue(t.name) || stringValue(t.type))
    }
  }
  if (Array.isArray(body.mcp_servers)) {
    for (const server of body.mcp_servers) {
      if (!server || typeof server !== 'object') continue
      const name = stringValue((server as Record<string, unknown>).name)
      if (name) addToolName(names, `mcp:${name.trim()}`)
    }
  }
  return names
}

/** Record a tool call from a response content block (tool_use, server_tool_use, mcp_tool_use). */
function observeToolBlock(usage: UsageDetail, block: unknown) {
  if (!block || typeof block !== 'object') return
  const b = block as Record<string, unknown>
  const name = stringValue(b.name)
  if (!name) return
  if (b.type === 'tool_use' || b.type === 'server_tool_use') {
    addToolName(usage.tools_called, name)
  } else if (b.type === 'mcp_tool_use') {
    const server = stringValue(b.server_name)
    addToolName(usage.tools_called, server ? `mcp:${server.trim()}/${name.trim()}` : `mcp:${name.trim()}`)
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
 * Errors raised by AI Gateway itself (not by the provider) come without a
 * provider request ID and use Cloudflare's error envelope.
 */
function aiGatewayErrorCode(upstream: Response, body: string): number | null {
  if (upstream.headers.get('request-id') || upstream.headers.get('x-amzn-requestid')) return null
  try {
    const parsed = JSON.parse(body) as { error?: Array<{ code?: number }> | { code?: number } }
    const errors = Array.isArray(parsed.error) ? parsed.error : parsed.error ? [parsed.error] : []
    const code = errors.find((e) => typeof e?.code === 'number')?.code
    return typeof code === 'number' ? code : null
  } catch {
    return null
  }
}

/** Text the caller sent: the system prompt and every text block in the messages. */
function promptText(body: Record<string, unknown>): string {
  const parts: string[] = []
  const add = (value: unknown) => {
    if (typeof value === 'string') parts.push(value)
    else if (Array.isArray(value)) {
      for (const block of value) {
        if (typeof block === 'string') parts.push(block)
        else if (block && typeof block === 'object') {
          const b = block as { type?: string; text?: unknown; content?: unknown }
          if (typeof b.text === 'string') parts.push(b.text)
          if (b.type === 'tool_result') add(b.content)
        }
      }
    }
  }
  add(body.system)
  for (const message of body.messages as Array<{ content?: unknown }>) add(message?.content)
  return parts.join('\n').slice(0, MAX_RULE_SCAN_CHARS)
}

function matchCustomRules(text: string, rules: CustomRule[]): CustomRule[] {
  const lower = text.toLowerCase()
  return rules.filter((rule) => {
    if (rule.match_type === 'phrase') return lower.includes(rule.pattern.toLowerCase())
    try {
      return new RegExp(rule.pattern, 'i').test(text)
    } catch {
      return false
    }
  })
}

const SAFE_VALUES = new Set(['safe', 'pass', 'passed', 'allow', 'allowed', 'ignore', 'none', 'false', '0'])

/**
 * Categories Cloudflare reported in a log's guardrails field, by direction. The field's layout is
 * not documented, so codes are read wherever they appear, skipping entries marked safe.
 */
function categoriesFromLog(value: unknown): Array<{ category: string; check: 'REQUEST' | 'RESPONSE' }> {
  const found = new Map<string, 'REQUEST' | 'RESPONSE'>()
  const codeRe = /\b(S(?:1[0-4]|[1-9])|P1)\b/gi
  const visit = (node: unknown, path: string) => {
    const check = /response|output/i.test(path) ? 'RESPONSE' : 'REQUEST'
    if (typeof node === 'string') {
      if (SAFE_VALUES.has(node.trim().toLowerCase())) return
      for (const m of node.matchAll(codeRe)) found.set(`${m[1].toUpperCase()}:${check}`, check)
      return
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, `${path}.${i}`))
      return
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        const code = k.match(/^(S(?:1[0-4]|[1-9])|P1)$/i)?.[1]
        if (code) {
          const safe = v === false || v === 0 || v === null || (typeof v === 'string' && SAFE_VALUES.has(v.trim().toLowerCase()))
          if (!safe) found.set(`${code.toUpperCase()}:${check}`, check)
        } else {
          visit(v, `${path}.${k}`)
        }
      }
    }
  }
  visit(value, '')
  return [...found.keys()].map((k) => {
    const [category, check] = k.split(':')
    return { category, check: check as 'REQUEST' | 'RESPONSE' }
  })
}

type AigLog = { guardrails?: unknown; dlp_action?: string | null; dlp_profiles?: unknown[] | null }

/** One AI Gateway log entry (metadata only; payload collection is off). Retries until ready() or attempts run out. */
async function fetchAigLog(
  gatewayId: string,
  logId: string,
  attempts: number,
  ready: (log: AigLog) => boolean = () => true,
): Promise<AigLog | null> {
  if (!AIG_ADMIN_TOKEN) return null
  let last: AigLog | null = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt))
    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${AIG_ACCOUNT_ID}/ai-gateway/gateways/${gatewayId}/logs/${logId}`,
        { headers: { Authorization: `Bearer ${AIG_ADMIN_TOKEN}` }, signal: AbortSignal.timeout(5000) },
      )
      if (res.status === 404) continue
      if (!res.ok) return last
      last = ((await res.json()) as { result?: AigLog }).result || {}
      if (ready(last)) return last
    } catch {
      // try again
    }
  }
  return last
}

/**
 * DLP findings from the log. Cloudflare's block response carries no cf-aig-dlp header, and its error
 * code can say response when the log shows the prompt was blocked, so the log is the record.
 */
function dlpFromLog(log: AigLog | null): DlpHeader | null {
  if (!log?.dlp_action || !Array.isArray(log.dlp_profiles) || !log.dlp_profiles.length) return null
  return { action: log.dlp_action, findings: log.dlp_profiles }
}

function dlpBlockOutcome(dlp: DlpHeader | null, code: number): Outcome {
  const checks = new Set((dlp?.findings || []).map((f) => (f as { check?: string })?.check))
  if (checks.has('REQUEST')) return 'blocked_dlp_request'
  if (checks.has('RESPONSE')) return 'blocked_dlp_response'
  return code === 2029 ? 'blocked_dlp_request' : 'blocked_dlp_response'
}

/** Guardrail results for one request, read from the organisation's AI Gateway log. */
async function fetchGuardrailHits(
  gatewayId: string,
  logId: string,
  modes: Map<string, 'flag' | 'block'>,
  blockedCheck: 'REQUEST' | 'RESPONSE' | null,
  attempts: number,
): Promise<GuardrailHit[]> {
  const log = await fetchAigLog(gatewayId, logId, attempts, (l) => !blockedCheck || categoriesFromLog(l.guardrails).length > 0)
  const hits: GuardrailHit[] = []
  for (const { category, check } of categoriesFromLog(log?.guardrails)) {
    const key = guardrailKeyForCategory(category)
    if (!key) continue
    const mode = modes.get(key)
    const action = blockedCheck === check && mode === 'block' ? 'BLOCK' : 'FLAG'
    hits.push({ key, action, check, source: 'cloudflare', detail: category })
  }
  return hits
}

function mergeHits(...lists: GuardrailHit[][]): GuardrailHit[] {
  const seen = new Set<string>()
  const out: GuardrailHit[] = []
  for (const hit of lists.flat()) {
    const id = `${hit.key}:${hit.action}:${hit.check}:${hit.detail || ''}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push(hit)
  }
  return out
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
  const hits = mergeHits(ctx.hits, dlpHits(result.dlp))
  const { error } = await supabase.from('gateway_request_events').insert({
    id: ctx.id,
    org_id: ctx.orgId,
    asset_id: ctx.assetId,
    token_id: ctx.tokenId,
    provider: 'anthropic',
    infrastructure: ctx.infrastructure,
    org_aws_account_id: ctx.awsAccountId,
    aws_region: ctx.awsRegion,
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
    tools_offered: ctx.toolsOffered,
    tools_called: usage.tools_called,
    model_approved: ctx.modelApproved,
    guardrail_hits: hits.length ? hits : null,
    is_check: ctx.isCheck,
  })
  if (error) console.error('gateway event insert failed', error.message)
  if (ctx.isCheck || !ctx.tokenId) return

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
      content_block?: unknown
    }
    if (event.message?.model) usage.model = event.message.model
    if (event.message?.usage) mergeUsage(usage, event.message.usage)
    if (event.usage) mergeUsage(usage, event.usage)
    if (event.type === 'content_block_start') observeToolBlock(usage, event.content_block)
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
  const checkHeader = (req.headers.get('x-reganchor-check') || '').trim()
  if (!checkHeader && !/^ra_gw_[A-Za-z0-9_-]{40,}$/.test(token)) {
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

    let tokenRow: { id: string | null; asset_id: string; org_id: string | null }
    if (checkHeader) {
      const checkedAsset = await verifyCheck(CHECK_SECRET, checkHeader, rawBody)
      if (!checkedAsset) return anthropicError('authentication_error', 'Invalid guardrail test signature', 401)
      tokenRow = { id: null, asset_id: checkedAsset, org_id: null }
    } else {
      const tokenHash = await sha256(token)
      const { data } = await supabase
        .from('asset_gateway_tokens')
        .select('id,asset_id,org_id')
        .eq('token_hash', tokenHash)
        .is('revoked_at', null)
        .maybeSingle()
      if (!data) {
        return anthropicError('authentication_error', 'Invalid gateway token', 401)
      }
      tokenRow = data
    }
    const isCheck = tokenRow.id === null

    let assetQuery = supabase
      .from('ai_systems')
      .select('id,org_id,provider_slug,deleted_at')
      .eq('id', tokenRow.asset_id)
    if (tokenRow.org_id) assetQuery = assetQuery.eq('org_id', tokenRow.org_id)
    const { data: asset } = await assetQuery.maybeSingle()
    if (!asset || asset.deleted_at || (asset.provider_slug !== 'anthropic' && asset.provider_slug !== 'bedrock')) {
      return anthropicError('permission_error', 'Gateway asset is unavailable', 403)
    }
    const onBedrock = asset.provider_slug === 'bedrock'

    let apiKey: string | null = null
    let providerApiKeyId: string | null = null
    let awsAccount: AwsAccount | null = null
    let awsRegion: string | null = null

    if (onBedrock) {
      if (!BEDROCK_MODEL_RE.test(model)) {
        return anthropicError(
          'invalid_request_error',
          'This agent runs on Amazon Bedrock. Use a Bedrock model ID for Claude, for example ' +
            'eu.anthropic.claude-haiku-4-5-20251001-v1:0.',
          400,
        )
      }
      const { data: connection } = await supabase
        .from('provider_connections')
        .select('id,status,org_aws_account_id,metadata')
        .eq('asset_id', asset.id)
        .eq('provider_slug', 'bedrock')
        .in('status', ['connected', 'error'])
        .maybeSingle()
      const { data: account } = connection?.org_aws_account_id
        ? await supabase
          .from('org_aws_accounts')
          .select('id,method,role_arn,external_id,connection_ref,home_region')
          .eq('id', connection.org_aws_account_id)
          .eq('org_id', asset.org_id)
          .in('status', ['connected', 'error'])
          .maybeSingle()
        : { data: null }
      const region = String((connection?.metadata as { aws?: { region?: string } } | null)?.aws?.region ||
        account?.home_region || '')
      const usable = account && (account.method === 'api_key' || (account.method === 'role' && account.role_arn))
      if (!usable || !AWS_REGION_RE.test(region)) {
        return anthropicError('permission_error', 'The Amazon Bedrock connection for this agent is unavailable.', 403)
      }
      awsAccount = account as AwsAccount
      awsRegion = region
    } else {
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
      apiKey = await readApiSecret(supabase, connection.id)
      if (!apiKey) {
        return anthropicError('permission_error', 'Anthropic runtime connection is unavailable', 403)
      }
      providerApiKeyId = connection.runtime_api_key_id || null
    }

    const infrastructure: Infrastructure = onBedrock ? 'aws_bedrock' : 'anthropic_api'
    const [settings, enforcement] = await Promise.all([
      loadSettings(supabase, asset.org_id),
      checkEnforcement(supabase, asset.org_id, asset.id, model, infrastructure, awsRegion),
    ])

    const useAiGateway = settings.route_via_ai_gateway && AIG_TOKEN.length > 0
    if (settings.route_via_ai_gateway && !useAiGateway) {
      console.error('gateway enrolled in AI Gateway but CF_AIG_TOKEN is not set')
    }

    const ctx: EventContext = {
      id: crypto.randomUUID(),
      orgId: asset.org_id,
      assetId: asset.id,
      tokenId: tokenRow.id,
      isCheck,
      hits: Array.isArray(enforcement?.hits) ? enforcement.hits : [],
      providerApiKeyId,
      infrastructure,
      awsAccountId: awsAccount?.id || null,
      awsRegion,
      requestModel: model,
      streamed: body.stream === true,
      route: useAiGateway ? 'ai_gateway' : 'direct',
      startedAt: performance.now(),
      latencyMs: null,
      captureContent: settings.capture_content,
      rawRequest: rawBody,
      toolsOffered: offeredTools(body),
      modelApproved: typeof enforcement?.model_approved === 'boolean' ? enforcement.model_approved : null,
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
      return anthropicError('api_error', 'Guardrail and budget checks are temporarily unavailable, so this request was not sent.', 503, ctx.id)
    }
    if (enforcement && !enforcement.allowed) {
      ctx.route = 'none'
      const reason = enforcement.reason && enforcement.reason in OUTCOME_BY_REASON ? enforcement.reason : 'budget_reached'
      await record({
        outcome: OUTCOME_BY_REASON[reason],
        httpStatus: 403,
        errorType: reason,
        errorCode: reason === 'budget_reached' ? enforcement.scope || null : null,
        usage: emptyUsage(model),
      })
      return anthropicError('permission_error', enforcementMessage({ ...enforcement, reason }, model), 403, ctx.id)
    }

    const rules = enforcement?.custom_rules
    if (rules && Array.isArray(rules.rules) && rules.rules.length) {
      const matched = matchCustomRules(promptText(body), rules.rules)
      if (matched.length) {
        const action = rules.mode === 'block' ? 'BLOCK' : 'FLAG'
        ctx.hits = mergeHits(ctx.hits, matched.map((rule) => ({
          key: 'custom_rules',
          action,
          check: 'REQUEST' as const,
          source: 'reganchor' as const,
          detail: rule.label,
        })))
        if (action === 'BLOCK') {
          ctx.route = 'none'
          await record({
            outcome: 'blocked_custom_rule',
            httpStatus: 403,
            errorType: 'custom_rule',
            errorCode: matched[0].id,
            usage: emptyUsage(model),
          })
          return anthropicError(
            'permission_error',
            `Request blocked by your organisation's rule "${matched[0].label}" in RegAnchor.`,
            403,
            ctx.id,
          )
        }
      }
    }

    const gatewayId = settings.cf_gateway_id
    let target: Upstream
    if (awsAccount && awsRegion) {
      try {
        target = await bedrockUpstream(supabase, req, awsAccount, awsRegion, rawBody, gatewayId)
      } catch (error) {
        const code = error instanceof AwsConnectError ? error.code : 'aws_error'
        const ours = code === 'not_configured' || code === 'broker_rejected'
        ctx.route = 'none'
        ctx.latencyMs = Math.round(performance.now() - ctx.startedAt)
        await record({
          outcome: ours ? 'gateway_error' : 'provider_error',
          httpStatus: ours ? 503 : code === 'timeout' ? 504 : 403,
          errorType: code,
          usage: emptyUsage(model),
        })
        if (ours) return anthropicError('api_error', 'RegAnchor could not sign in to AWS. Try again shortly.', 503, ctx.id)
        if (code === 'timeout') return anthropicError('api_error', 'AWS did not respond in time. Try again shortly.', 504, ctx.id)
        return anthropicError(
          'permission_error',
          'RegAnchor could not use the AWS access for this agent. An owner or admin can check the AWS account in RegAnchor.',
          403,
          ctx.id,
        )
      }
    } else {
      target = {
        directUrl: ANTHROPIC_MESSAGES_URL,
        aiGatewayUrl: `${aiGatewayBase(gatewayId)}/anthropic/v1/messages`,
        headers: providerHeaders(req, apiKey || ''),
      }
    }

    // Guardrail results are only in the Cloudflare log, read for the organisation's own gateway.
    const guardrailGateway = gatewayId && AIG_ADMIN_TOKEN && settings.cf_modes.size > 0 ? gatewayId : null
    const followUpGuardrails = (
      logId: string | null,
      recorded: Promise<void>,
      dlpHeader: DlpHeader | null,
      blockedCheck: 'REQUEST' | 'RESPONSE' | null = null,
    ) => {
      if (!guardrailGateway || !logId || isCheck) return
      background(recorded.then(async () => {
        const found = await fetchGuardrailHits(guardrailGateway, logId, settings.cf_modes, blockedCheck, 3)
        if (!found.length) return
        const resolved = found.some((h) => h.action === 'BLOCK')
        ctx.hits = mergeHits(ctx.hits.filter((h) => !(resolved && h.key === 'cloudflare_guardrail')), found)
        const { error } = await supabase
          .from('gateway_request_events')
          .update({ guardrail_hits: mergeHits(ctx.hits, dlpHits(dlpHeader)) })
          .eq('id', ctx.id)
        if (error) console.error('guardrail result update failed', error.message)
      }))
    }

    let upstream: Response | null = null
    if (useAiGateway) {
      try {
        upstream = await fetch(target.aiGatewayUrl, {
          method: 'POST',
          headers: aiGatewayHeaders(target.headers, ctx),
          body: rawBody,
        })
      } catch (error) {
        console.error('ai gateway unreachable', error instanceof Error ? error.message : 'unknown error')
        upstream = null
      }

      if (upstream && !upstream.ok) {
        const errorBody = await upstream.clone().text()
        const code = aiGatewayErrorCode(upstream, errorBody)
        const awsType = onBedrock ? awsErrorType(upstream, errorBody) : null
        if (code === null && awsType && BEDROCK_AUTH_ERRORS.has(awsType) && (upstream.status === 401 || upstream.status === 403)) {
          console.error('ai gateway bedrock request rejected by AWS', upstream.status, awsType)
          upstream = null
        } else if (code !== null) {
          ctx.latencyMs = Math.round(performance.now() - ctx.startedAt)
          let dlp = parseDlp(upstream)
          const aigLogId = upstream.headers.get('cf-aig-log-id')
          if (code === 2029 || code === 2030) {
            const logGateway = gatewayId || AIG_GATEWAY_ID
            const needsLog = !dlp?.findings?.length && !!aigLogId && !!AIG_ADMIN_TOKEN
            if (needsLog && isCheck) {
              dlp = dlpFromLog(await fetchAigLog(logGateway, aigLogId!, 4, (l) => !!l.dlp_action)) || dlp
            }
            const outcome = dlpBlockOutcome(dlp, code)
            const recorded = record({
              outcome,
              httpStatus: upstream.status,
              errorType: 'dlp_blocked',
              errorCode: String(code),
              usage: emptyUsage(model),
              aigLogId,
              dlp,
            })
            await recorded
            if (needsLog && !isCheck) {
              background(recorded.then(async () => {
                const found = dlpFromLog(await fetchAigLog(logGateway, aigLogId!, 3, (l) => !!l.dlp_action))
                if (!found) return
                const { error } = await supabase
                  .from('gateway_request_events')
                  .update({
                    dlp: found,
                    dlp_action: found.action === 'BLOCK' || found.action === 'FLAG' ? found.action : null,
                    outcome: dlpBlockOutcome(found, code),
                    guardrail_hits: mergeHits(ctx.hits, dlpHits(found)),
                  })
                  .eq('id', ctx.id)
                if (error) console.error('dlp result update failed', error.message)
              }))
            }
            return anthropicError(
              'invalid_request_error',
              outcome === 'blocked_dlp_request'
                ? 'Request blocked by your organisation\'s data protection policy.'
                : 'Response blocked by your organisation\'s data protection policy.',
              400,
              ctx.id,
            )
          }
          if (code === 2016 || code === 2017) {
            const check = code === 2016 ? 'REQUEST' : 'RESPONSE'
            const found = gatewayId && aigLogId
              ? await fetchGuardrailHits(gatewayId, aigLogId, settings.cf_modes, check, isCheck ? 4 : 1)
              : []
            const blocking = [...settings.cf_modes].filter(([key, mode]) =>
              mode === 'block' && (check === 'REQUEST' || GUARDRAIL_BY_KEY.get(key)?.cfCategory !== 'P1')
            )
            const fallback: GuardrailHit[] = found.some((h) => h.action === 'BLOCK') ? [] : [{
              key: blocking.length === 1 ? blocking[0][0] : 'cloudflare_guardrail',
              action: 'BLOCK',
              check,
              source: 'cloudflare',
            }]
            ctx.hits = mergeHits(ctx.hits, found, fallback)
            const recorded = record({
              outcome: code === 2016 ? 'blocked_guardrail_prompt' : 'blocked_guardrail_response',
              httpStatus: upstream.status,
              errorType: 'guardrail_blocked',
              errorCode: String(code),
              usage: emptyUsage(model),
              aigLogId,
              dlp,
            })
            await recorded
            if (!found.length) followUpGuardrails(aigLogId, recorded, dlp, check)
            return anthropicError(
              'invalid_request_error',
              code === 2016
                ? 'Request blocked by your organisation\'s AI guardrails.'
                : 'Response blocked by your organisation\'s AI guardrails.',
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
      upstream = await fetch(target.directUrl, {
        method: 'POST',
        headers: target.headers,
        body: rawBody,
      })
    }
    ctx.latencyMs = Math.round(performance.now() - ctx.startedAt)

    const headers = responseHeaders(upstream, ctx.id)
    const dlp = parseDlp(upstream)
    const aigLogId = upstream.headers.get('cf-aig-log-id')
    const providerRequestId = upstream.headers.get('request-id') || upstream.headers.get('x-amzn-requestid')

    if (!upstream.ok || !upstream.body) {
      let errorBody = await upstream.text()
      let errorType = anthropicErrorType(errorBody)
      if (onBedrock) {
        const awsType = awsErrorType(upstream, errorBody)
        errorType = errorType || awsType
        errorBody = bedrockErrorBody(upstream.status, errorBody, awsType)
        headers.set('Content-Type', 'application/json')
      }
      await record({
        outcome: upstream.status === 429 ? 'rate_limited' : 'provider_error',
        httpStatus: upstream.status,
        errorType,
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
      const stream = meteredStream(upstream.body, ctx, usage, (outcome, errorType, captured) => {
        const recorded = record({
          outcome,
          httpStatus: upstream!.status,
          errorType,
          usage,
          providerRequestId,
          aigLogId,
          dlp,
          responseContent: captured,
        })
        followUpGuardrails(aigLogId, recorded, dlp)
        return recorded
      })
      return new Response(stream, { status: upstream.status, headers })
    }

    const responseBody = await upstream.text()
    const usage = emptyUsage(model)
    try {
      const parsed = JSON.parse(responseBody) as { model?: string; usage?: unknown; content?: unknown }
      if (parsed.model) usage.model = parsed.model
      mergeUsage(usage, parsed.usage)
      if (Array.isArray(parsed.content)) for (const block of parsed.content) observeToolBlock(usage, block)
    } catch {
      // usage unavailable; recorded with zero tokens and flagged by pricing
    }
    if (isCheck && guardrailGateway && aigLogId) {
      ctx.hits = mergeHits(ctx.hits, await fetchGuardrailHits(guardrailGateway, aigLogId, settings.cf_modes, null, 4))
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
    if (ctx.captureContent && hasWaitUntil() && !isCheck) background(recorded)
    else await recorded
    followUpGuardrails(aigLogId, recorded, dlp)
    return new Response(responseBody, { status: upstream.status, headers })
  } catch (error) {
    if (error instanceof SyntaxError) {
      return anthropicError('invalid_request_error', 'Invalid JSON body', 400)
    }
    console.error('gateway request failed', error instanceof Error ? error.message : 'unknown error')
    return anthropicError('api_error', 'Gateway request failed', 500)
  }
})
