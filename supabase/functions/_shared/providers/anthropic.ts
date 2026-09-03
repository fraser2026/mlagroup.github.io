import type {
  ProviderCapabilityProfile,
  ProviderGovernanceInsights,
  ProviderInsightsModelRow,
  ProviderInsightsWorkspaceCost,
  ProviderRuntimeAttribution,
  ProviderVerifyResult,
} from './types.ts'

const ANTHROPIC_BASE = 'https://api.anthropic.com'
const ANTHROPIC_API_VERSION = '2023-06-01'
const VERIFY_TIMEOUT_MS = 12_000
const INSIGHTS_TIMEOUT_MS = 30_000

type AnthropicFetchResult = {
  ok: boolean
  status: number
  provider_request_id?: string
  body?: Record<string, unknown>
}

async function anthropicFetch(
  path: string,
  apiKey: string,
  timeoutMs = VERIFY_TIMEOUT_MS,
): Promise<AnthropicFetchResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${ANTHROPIC_BASE}${path}`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
      },
      signal: controller.signal,
    })
    const provider_request_id =
      res.headers.get('request-id') ||
      res.headers.get('x-request-id') ||
      undefined
    let body: Record<string, unknown> | undefined
    try {
      body = await res.json()
    } catch {
      body = undefined
    }
    return { ok: res.ok, status: res.status, provider_request_id, body }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, status: 408 }
    }
    return { ok: false, status: 0 }
  } finally {
    clearTimeout(timer)
  }
}

async function anthropicFetchPaged(
  pathWithQuery: string,
  apiKey: string,
  maxPages = 10,
): Promise<AnthropicFetchResult & { pages: number; merged_data: unknown[] }> {
  const merged_data: unknown[] = []
  let pages = 0
  let nextPage: string | null = null
  let last: AnthropicFetchResult = { ok: false, status: 0 }

  for (let i = 0; i < maxPages; i++) {
    const path = nextPage
      ? `${pathWithQuery}${pathWithQuery.includes('?') ? '&' : '?'}page=${encodeURIComponent(nextPage)}`
      : pathWithQuery
    last = await anthropicFetch(path, apiKey, INSIGHTS_TIMEOUT_MS)
    pages++
    if (!last.ok || !last.body) break
    const data = Array.isArray((last.body as { data?: unknown[] }).data)
      ? (last.body as { data: unknown[] }).data
      : []
    merged_data.push(...data)
    const more = !!(last.body as { has_more?: boolean }).has_more
    const pageToken = (last.body as { next_page?: string | null }).next_page
    if (!more || !pageToken) break
    nextPage = pageToken
  }

  return {
    ...last,
    ok: last.ok,
    status: last.status,
    provider_request_id: last.provider_request_id,
    body: { ...(last.body || {}), data: merged_data },
    pages,
    merged_data,
  }
}

function verifyErrorFromStatus(
  status: number,
  checked_at: string,
  provider_request_id?: string,
): ProviderVerifyResult {
  if (status === 401) {
    return {
      ok: false,
      mode: 'live_api',
      error: 'Invalid API key.',
      error_code: 'invalid_credentials',
      checked_at,
      provider_request_id,
    }
  }
  if (status === 403) {
    return {
      ok: false,
      mode: 'live_api',
      error: 'API key does not have permission for this request.',
      error_code: 'forbidden',
      checked_at,
      provider_request_id,
    }
  }
  if (status === 429) {
    return {
      ok: false,
      mode: 'live_api',
      error: 'Anthropic rate limit reached. Try again shortly.',
      error_code: 'rate_limited',
      checked_at,
      provider_request_id,
    }
  }
  if (status === 408 || status === 0) {
    return {
      ok: false,
      mode: 'live_api',
      error: status === 408 ? 'Anthropic API request timed out.' : 'Could not reach Anthropic API.',
      error_code: status === 408 ? 'timeout' : 'network_error',
      checked_at,
      provider_request_id,
    }
  }
  return {
    ok: false,
    mode: 'live_api',
    error: 'Anthropic API returned an unexpected error.',
    error_code: 'provider_error',
    checked_at,
    provider_request_id,
  }
}

function mockResult(ok: boolean): ProviderVerifyResult {
  return {
    ok,
    mode: 'mock',
    checked_at: new Date().toISOString(),
    ...(ok ? {} : { error: 'Mock verification failed.', error_code: 'provider_error' }),
  }
}

export function detectAnthropicKeySlot(apiKey: string): 'api' | 'admin' | 'unknown' {
  const key = apiKey.trim()
  if (key.startsWith('sk-ant-admin')) return 'admin'
  if (key.startsWith('sk-ant-api')) return 'api'
  return 'unknown'
}

export async function verifyAnthropicApiKey(apiKey: string): Promise<ProviderVerifyResult> {
  const verifyMode = (Deno.env.get('PROVIDER_VERIFY_MODE') || 'live').toLowerCase()
  if (verifyMode === 'mock') return mockResult(apiKey.length > 10)

  const checked_at = new Date().toISOString()
  const slot = detectAnthropicKeySlot(apiKey)
  if (slot === 'admin') {
    return {
      ok: false,
      mode: 'live_api',
      error: 'This looks like an Admin API key. Use the Governance admin key field instead.',
      error_code: 'unsupported',
      checked_at,
    }
  }

  const res = await anthropicFetch('/v1/models', apiKey)
  if (res.ok) {
    return { ok: true, mode: 'live_api', checked_at, provider_request_id: res.provider_request_id }
  }
  return verifyErrorFromStatus(res.status, checked_at, res.provider_request_id)
}

export async function verifyAnthropicAdminKey(apiKey: string): Promise<ProviderVerifyResult> {
  const verifyMode = (Deno.env.get('PROVIDER_VERIFY_MODE') || 'live').toLowerCase()
  if (verifyMode === 'mock') return mockResult(apiKey.length > 10)

  const checked_at = new Date().toISOString()
  const slot = detectAnthropicKeySlot(apiKey)
  if (slot === 'api') {
    return {
      ok: false,
      mode: 'live_api',
      error: 'This looks like a runtime API key. Use the Runtime API key field instead.',
      error_code: 'unsupported',
      checked_at,
    }
  }

  const res = await anthropicFetch('/v1/organizations/me', apiKey)
  if (res.ok) {
    return { ok: true, mode: 'live_api', checked_at, provider_request_id: res.provider_request_id }
  }
  return verifyErrorFromStatus(res.status, checked_at, res.provider_request_id)
}

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString()
}

export async function probeAnthropicCapabilities(
  apiKey: string | null,
  adminKey: string | null,
): Promise<ProviderCapabilityProfile> {
  const checked_at = new Date().toISOString()
  const hasApi = !!(apiKey && apiKey.trim())
  const hasAdmin = !!(adminKey && adminKey.trim())
  let governance_tier: ProviderCapabilityProfile['governance_tier'] = 'none'
  if (hasApi && hasAdmin) governance_tier = 'full'
  else if (hasApi) governance_tier = 'verification'

  let models_count: number | undefined
  let org_id: string | undefined
  let usageOk = false
  let costOk = false
  let workspaceOk = false
  let apiOk = false

  if (hasApi) {
    const models = await anthropicFetch('/v1/models', apiKey!.trim())
    apiOk = models.ok
    if (models.ok && Array.isArray((models.body as { data?: unknown[] })?.data)) {
      models_count = (models.body as { data: unknown[] }).data.length
    }
  }

  if (hasAdmin) {
    const org = await anthropicFetch('/v1/organizations/me', adminKey!.trim())
    if (org.ok && org.body && typeof org.body.id === 'string') {
      org_id = org.body.id
    }

    const starting_at = isoDaysAgo(2)
    const ending_at = new Date().toISOString()
    const usagePath =
      `/v1/organizations/usage_report/messages?starting_at=${encodeURIComponent(starting_at)}` +
      `&ending_at=${encodeURIComponent(ending_at)}&bucket_width=1d`
    const usage = await anthropicFetch(usagePath, adminKey!.trim())
    usageOk = usage.ok

    const costPath =
      `/v1/organizations/cost_report?starting_at=${encodeURIComponent(starting_at)}` +
      `&ending_at=${encodeURIComponent(ending_at)}&bucket_width=1d`
    const cost = await anthropicFetch(costPath, adminKey!.trim())
    costOk = cost.ok

    const workspaces = await anthropicFetch('/v1/workspaces', adminKey!.trim())
    workspaceOk = workspaces.ok
  }

  const capabilities: ProviderCapabilityProfile['capabilities'] = [
    {
      key: 'api_verification',
      label: 'Runtime API verification',
      description: 'Confirms this asset can authenticate to the provider API.',
      available: apiOk,
      requires: 'api',
    },
    {
      key: 'model_visibility',
      label: 'Model visibility',
      description: 'How many models the runtime API key can access.',
      available: apiOk && (models_count ?? 0) > 0,
      requires: 'api',
    },
    {
      key: 'usage_monitoring',
      label: 'Usage monitoring',
      description: 'Read token usage for governance reporting.',
      available: usageOk,
      requires: 'admin',
    },
    {
      key: 'cost_monitoring',
      label: 'Cost monitoring',
      description: 'Read spend data for governance and budget oversight.',
      available: costOk,
      requires: 'admin',
    },
    {
      key: 'workspace_visibility',
      label: 'Workspace visibility',
      description: 'See workspace scope for attribution across teams.',
      available: workspaceOk,
      requires: 'admin',
    },
    {
      key: 'org_metadata',
      label: 'Organisation metadata',
      description: 'Resolve organisation identity for audit records.',
      available: !!org_id,
      requires: 'admin',
    },
  ]

  const limitations: string[] = []
  if (!hasApi) {
    limitations.push('No runtime API key connected. Verification-only governance is not available yet.')
  } else if (!apiOk) {
    limitations.push('Runtime API key is stored but could not be verified on the last check.')
  } else if (!hasAdmin) {
    limitations.push('Connected for verification only. Usage, cost, and workspace monitoring require a Governance Admin API key.')
  } else if (!usageOk || !costOk) {
    limitations.push('Admin key is connected but usage or cost reporting could not be confirmed. Check key permissions or workspace scope.')
  }

  const encouragement = !hasAdmin
    ? 'Add a Governance Admin API key (sk-ant-admin…) to unlock usage monitoring, cost reporting, and full agent governance for this asset.'
    : governance_tier === 'full'
    ? 'Full governance is enabled for this asset.'
    : undefined

  return {
    provider_slug: 'anthropic',
    governance_tier,
    checked_at,
    capabilities,
    limitations,
    encouragement,
    org_id,
    models_count,
    enterprise_analytics_path: false,
  }
}

function isoDaysAgoUtc(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

/** Exclusive end for daily buckets: tomorrow 00:00 UTC so today's usage is included. */
function isoTomorrowUtcMidnight(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 1)
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

function isoHoursAgoUtc(hours: number): string {
  const d = new Date(Date.now() - hours * 60 * 60 * 1000)
  d.setUTCMinutes(0, 0, 0)
  return d.toISOString()
}

function centsToUsd(amount: string | number | undefined): string {
  const cents = Number(amount || 0)
  if (!Number.isFinite(cents)) return '0.00'
  return (cents / 100).toFixed(2)
}

function addUsd(a: string, b: string): string {
  return (Number(a) + Number(b)).toFixed(2)
}

type UsageResult = {
  model?: string | null
  uncached_input_tokens?: number
  input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number }
  output_tokens?: number
}

type CostResult = {
  workspace_id?: string | null
  amount?: string
  currency?: string
}

function cacheCreationTokens(result: UsageResult): number {
  const cache = result.cache_creation || {}
  return Number(cache.ephemeral_1h_input_tokens || 0) + Number(cache.ephemeral_5m_input_tokens || 0)
}

function usageTotalsFromBody(body: Record<string, unknown> | undefined) {
  const buckets = Array.isArray((body as { data?: unknown[] })?.data)
    ? (body as { data: Array<{ results?: UsageResult[] }> }).data
    : []
  const byModel = new Map<string, ProviderInsightsModelRow>()
  let uncached_input_tokens = 0
  let cache_read_input_tokens = 0
  let cache_creation_tokens = 0
  let output_tokens = 0
  let usage_result_rows = 0

  for (const bucket of buckets) {
    for (const result of bucket.results || []) {
      usage_result_rows++
      const uncached = Number(
        result.uncached_input_tokens ?? result.input_tokens ?? 0,
      )
      const cacheRead = Number(result.cache_read_input_tokens || 0)
      const cacheCreate = cacheCreationTokens(result)
      const output = Number(result.output_tokens || 0)
      uncached_input_tokens += uncached
      cache_read_input_tokens += cacheRead
      cache_creation_tokens += cacheCreate
      output_tokens += output

      const model = String(result.model || 'unknown')
      const existing = byModel.get(model) || {
        model,
        uncached_input_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
      }
      existing.uncached_input_tokens += uncached
      existing.cache_read_input_tokens += cacheRead
      existing.cache_creation_tokens += cacheCreate
      existing.output_tokens += output
      existing.total_tokens += uncached + cacheRead + cacheCreate + output
      byModel.set(model, existing)
    }
  }

  const total_tokens = uncached_input_tokens + cache_read_input_tokens + cache_creation_tokens + output_tokens
  const by_model = Array.from(byModel.values()).sort((a, b) => b.total_tokens - a.total_tokens).slice(0, 8)
  return {
    total_tokens,
    uncached_input_tokens,
    cache_read_input_tokens,
    cache_creation_tokens,
    output_tokens,
    by_model,
    usage_buckets: buckets.length,
    usage_result_rows,
  }
}

function costTotalsFromBody(body: Record<string, unknown> | undefined) {
  const buckets = Array.isArray((body as { data?: unknown[] })?.data)
    ? (body as { data: Array<{ results?: CostResult[] }> }).data
    : []
  const byWorkspace = new Map<string, ProviderInsightsWorkspaceCost>()
  let total_usd = '0.00'
  let currency = 'USD'
  let cost_result_rows = 0

  for (const bucket of buckets) {
    for (const result of bucket.results || []) {
      cost_result_rows++
      const amountUsd = centsToUsd(result.amount)
      currency = String(result.currency || currency || 'USD')
      total_usd = addUsd(total_usd, amountUsd)
      const workspaceId = result.workspace_id ?? null
      const key = workspaceId || '__default__'
      const existing = byWorkspace.get(key) || { workspace_id: workspaceId, amount_usd: '0.00' }
      existing.amount_usd = addUsd(existing.amount_usd, amountUsd)
      byWorkspace.set(key, existing)
    }
  }

  const by_workspace = Array.from(byWorkspace.values()).sort((a, b) => Number(b.amount_usd) - Number(a.amount_usd))
  return { total_usd, currency, by_workspace, cost_buckets: buckets.length, cost_result_rows }
}

function secretMatchesPartialHint(secret: string, hint: string | null | undefined): boolean {
  if (!hint) return false
  const s = secret.trim()
  const h = hint.trim()
  if (!s || !h) return false
  const split = h.indexOf('...')
  if (split === -1) return s === h || s.endsWith(h)
  const start = h.slice(0, split)
  const end = h.slice(split + 3)
  return (!start || s.startsWith(start)) && (!end || s.endsWith(end))
}

function workspaceIdFromApiKey(row: Record<string, unknown>): string | null {
  const scope = row.scope as { type?: string; workspace_id?: string } | undefined
  if (scope?.type === 'workspace' && scope.workspace_id) return scope.workspace_id
  if (typeof row.workspace_id === 'string' && row.workspace_id) return row.workspace_id
  return null
}

async function listAnthropicApiKeys(adminKey: string): Promise<Record<string, unknown>[]> {
  const keys: Record<string, unknown>[] = []
  let afterId: string | null = null
  for (let i = 0; i < 10; i++) {
    const params = new URLSearchParams()
    params.set('limit', '1000')
    params.set('status', 'active')
    if (afterId) params.set('after_id', afterId)
    const res = await anthropicFetch(`/v1/organizations/api_keys?${params.toString()}`, adminKey, INSIGHTS_TIMEOUT_MS)
    if (!res.ok || !res.body) break
    const data = Array.isArray(res.body.data) ? (res.body.data as Record<string, unknown>[]) : []
    keys.push(...data)
    if (!res.body.has_more) break
    afterId = typeof res.body.last_id === 'string' ? res.body.last_id : null
    if (!afterId) break
  }
  return keys
}

export async function resolveAnthropicRuntimeAttribution(
  adminKey: string,
  runtimeKey: string,
): Promise<ProviderRuntimeAttribution | null> {
  const secret = runtimeKey.trim()
  if (!secret || !adminKey.trim()) return null
  const keys = await listAnthropicApiKeys(adminKey)
  const matches = keys.filter((row) =>
    secretMatchesPartialHint(secret, typeof row.partial_key_hint === 'string' ? row.partial_key_hint : null),
  )
  if (matches.length !== 1) return null
  const id = typeof matches[0].id === 'string' ? matches[0].id : ''
  if (!id) return null
  return { api_key_id: id, workspace_id: workspaceIdFromApiKey(matches[0]) }
}

function buildUsagePath(
  startingAt: string,
  endingAt: string,
  opts: { groupByModel?: boolean; bucketWidth?: '1d' | '1h'; apiKeyId?: string | null } = {},
): string {
  const params = new URLSearchParams()
  params.set('starting_at', startingAt)
  params.set('ending_at', endingAt)
  params.set('bucket_width', opts.bucketWidth || '1d')
  if (opts.groupByModel) params.append('group_by[]', 'model')
  if (opts.apiKeyId) params.append('api_key_ids[]', opts.apiKeyId)
  return `/v1/organizations/usage_report/messages?${params.toString()}`
}

function buildCostPath(startingAt: string, endingAt: string, apiKeyId?: string | null): string {
  const params = new URLSearchParams()
  params.set('starting_at', startingAt)
  params.set('ending_at', endingAt)
  params.set('bucket_width', '1d')
  params.append('group_by[]', 'workspace_id')
  if (apiKeyId) params.append('api_key_ids[]', apiKeyId)
  return `/v1/organizations/cost_report?${params.toString()}`
}

export async function fetchAnthropicGovernanceInsights(
  adminKey: string,
  windowDays = 30,
  attribution?: ProviderRuntimeAttribution | null,
): Promise<ProviderGovernanceInsights> {
  const days = Math.min(90, Math.max(1, Math.floor(windowDays || 30)))
  // Daily buckets need day-aligned exclusive ending_at (tomorrow UTC) or today's spend is dropped.
  const starting_at = isoDaysAgoUtc(days)
  const ending_at = isoTomorrowUtcMidnight()
  const refreshed_at = new Date().toISOString()
  const errors: string[] = []
  const key = adminKey.trim()

  const apiKeyId = attribution?.api_key_id || null
  const recentStart = isoHoursAgoUtc(48)
  const recentEnd = new Date(Date.now() + 60 * 60 * 1000).toISOString()

  const [usageTotalRes, usageByModelRes, usageHourlyRes, costFirst] = await Promise.all([
    anthropicFetchPaged(buildUsagePath(starting_at, ending_at, { bucketWidth: '1d', apiKeyId }), key),
    anthropicFetchPaged(buildUsagePath(starting_at, ending_at, { bucketWidth: '1d', groupByModel: true, apiKeyId }), key),
    anthropicFetchPaged(buildUsagePath(recentStart, recentEnd, { bucketWidth: '1h', groupByModel: true, apiKeyId }), key),
    anthropicFetchPaged(buildCostPath(starting_at, ending_at, apiKeyId), key),
  ])

  let costRes = costFirst
  if (!costRes.ok && apiKeyId && (costRes.status === 400 || costRes.status === 422)) {
    costRes = await anthropicFetchPaged(buildCostPath(starting_at, ending_at), key)
    if (costRes.ok) {
      errors.push('Cost report does not filter by API key; cost below is organisation or workspace spend, not this asset alone.')
    }
  }

  if (!usageTotalRes.ok && !usageByModelRes.ok && !usageHourlyRes.ok) {
    errors.push(
      usageTotalRes.status === 403 || usageByModelRes.status === 403
        ? 'Usage report is not available for this admin key.'
        : 'Could not fetch usage report from Anthropic.',
    )
  }
  if (!costRes.ok) {
    errors.push(
      costRes.status === 403
        ? 'Cost report is not available for this admin key.'
        : 'Could not fetch cost report from Anthropic.',
    )
  }

  const usageFromTotal = usageTotalRes.ok ? usageTotalsFromBody(usageTotalRes.body) : null
  const usageFromModels = usageByModelRes.ok ? usageTotalsFromBody(usageByModelRes.body) : null
  const usageFromHourly = usageHourlyRes.ok ? usageTotalsFromBody(usageHourlyRes.body) : null

  const candidates = [usageFromTotal, usageFromModels, usageFromHourly].filter(Boolean) as Array<
    ReturnType<typeof usageTotalsFromBody>
  >
  const usagePrimary = candidates.sort((a, b) => b.total_tokens - a.total_tokens)[0] || null
  const bestByModel = [usageFromModels, usageFromHourly, usageFromTotal]
    .filter((u) => u && u.by_model.length)
    .sort((a, b) => (b!.total_tokens) - (a!.total_tokens))[0]

  const usage = usagePrimary
    ? {
      total_tokens: usagePrimary.total_tokens,
      uncached_input_tokens: usagePrimary.uncached_input_tokens,
      cache_read_input_tokens: usagePrimary.cache_read_input_tokens,
      cache_creation_tokens: usagePrimary.cache_creation_tokens,
      output_tokens: usagePrimary.output_tokens,
      by_model: bestByModel?.by_model || usagePrimary.by_model,
    }
    : {
      total_tokens: 0,
      uncached_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_tokens: 0,
      output_tokens: 0,
      by_model: [] as ProviderInsightsModelRow[],
    }

  const costParsed = costRes.ok ? costTotalsFromBody(costRes.body) : null
  const cost = costParsed
    ? {
      total_usd: costParsed.total_usd,
      currency: costParsed.currency,
      by_workspace: costParsed.by_workspace,
    }
    : { total_usd: '0.00', currency: 'USD', by_workspace: [] as ProviderInsightsWorkspaceCost[] }

  if (!usageTotalRes.ok && !usageByModelRes.ok && !usageHourlyRes.ok && !costRes.ok) {
    throw new Error(errors[0] || 'Could not fetch governance insights.')
  }

  if (usage.total_tokens === 0 && (usageTotalRes.ok || usageByModelRes.ok || usageHourlyRes.ok)) {
    errors.push(
      apiKeyId
        ? 'No token rows for this asset runtime key yet. After API calls with that key, wait a few minutes and refresh.'
        : 'Admin usage report returned no token rows yet. Console Usage can appear before the Admin API; wait and refresh again.',
    )
  }
  if (!apiKeyId) {
    errors.push('Usage is organisation-wide until this asset runtime key can be matched to an Anthropic API key id. Connect both keys, then run a live check or refresh.')
  }

  return {
    provider_slug: 'anthropic',
    refreshed_at,
    window_days: days,
    starting_at,
    ending_at,
    scope: apiKeyId ? 'asset' : 'organization',
    api_key_id: apiKeyId,
    workspace_id: attribution?.workspace_id || null,
    usage,
    cost,
    ...(errors.length ? { errors } : {}),
    diagnostics: {
      usage_status: usageTotalRes.ok
        ? usageTotalRes.status
        : (usageHourlyRes.ok ? usageHourlyRes.status : usageByModelRes.status),
      cost_status: costRes.status,
      usage_buckets: Math.max(
        usageFromTotal?.usage_buckets || 0,
        usageFromModels?.usage_buckets || 0,
        usageFromHourly?.usage_buckets || 0,
      ),
      usage_result_rows: Math.max(
        usageFromTotal?.usage_result_rows || 0,
        usageFromModels?.usage_result_rows || 0,
        usageFromHourly?.usage_result_rows || 0,
      ),
      cost_buckets: costParsed?.cost_buckets || 0,
      cost_result_rows: costParsed?.cost_result_rows || 0,
      usage_pages: Math.max(
        usageTotalRes.pages || 0,
        usageByModelRes.pages || 0,
        usageHourlyRes.pages || 0,
      ),
      cost_pages: costRes.pages || 0,
      provider_request_id:
        usageTotalRes.provider_request_id ||
        usageHourlyRes.provider_request_id ||
        usageByModelRes.provider_request_id,
    },
    enterprise_analytics_path: false,
  }
}
