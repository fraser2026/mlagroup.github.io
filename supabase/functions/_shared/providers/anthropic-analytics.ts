// Anthropic Usage and Cost Analytics API (beta). Requires an organisation Admin key.
// Amounts are cents as decimal strings; every page of one query shares a data snapshot.

const ANTHROPIC_BASE = 'https://api.anthropic.com'
const ANTHROPIC_API_VERSION = '2023-06-01'
const ANALYTICS_BETA = 'analytics-usage-cost-2026-08-24'
const TIMEOUT_MS = 30_000
const MAX_PAGES = 50
const MAX_RETRIES = 2

export type AnalyticsResult = {
  data: unknown[]
  data_refreshed_at: string | null
  pages: number
}

export class AnalyticsError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorMessage(status: number, body: Record<string, unknown> | null): string {
  if (status === 401) return 'The Anthropic Admin key was rejected.'
  if (status === 403) return 'The Anthropic Admin key cannot read usage and cost analytics for this organisation.'
  if (status === 429) return 'Anthropic analytics rate limit reached. Try again shortly.'
  if (status === 408) return 'Anthropic analytics timed out.'
  const err = body?.error as { message?: unknown } | undefined
  const detail = typeof err?.message === 'string' ? err.message.slice(0, 200) : ''
  return `Anthropic analytics returned ${status || 'no response'}${detail ? `: ${detail}` : '.'}`
}

async function getPage(path: string, adminKey: string): Promise<{ status: number; body: Record<string, unknown> | null; retryAfter: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${ANTHROPIC_BASE}${path}`, {
      method: 'GET',
      headers: {
        'x-api-key': adminKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
        'anthropic-beta': ANALYTICS_BETA,
        'User-Agent': 'RegAnchor/1.0 (https://reganchor.com)',
      },
      signal: controller.signal,
    })
    const body = await res.json().catch(() => null) as Record<string, unknown> | null
    const retryAfter = Number(res.headers.get('retry-after') || '0')
    return { status: res.status, body, retryAfter: Number.isFinite(retryAfter) ? retryAfter : 0 }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return { status: 408, body: null, retryAfter: 0 }
    return { status: 0, body: null, retryAfter: 0 }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Daily rows grouped by API key and model for [start, end) (UTC dates, at most 31 days).
 * Cost rows are also split by cost_type so request charges can be told apart from
 * code execution hours and session charges.
 */
export async function fetchAnthropicAnalytics(
  kind: 'usage' | 'cost',
  adminKey: string,
  range: { start: string; end: string; apiKeyIds: string[] },
): Promise<AnalyticsResult> {
  const params = new URLSearchParams()
  params.set('starting_at', `${range.start}T00:00:00Z`)
  params.set('ending_at', `${range.end}T00:00:00Z`)
  params.set('time_bucket_width', '1d')
  params.append('group_by[]', 'api_key_id')
  params.append('group_by[]', 'model')
  if (kind === 'cost') params.append('group_by[]', 'cost_type')
  for (const id of range.apiKeyIds) params.append('api_key_ids[]', id)
  params.set('limit', '1000')
  const base = `/v1/organizations/analytics/${kind}?${params.toString()}`

  const data: unknown[] = []
  let refreshed: string | null = null
  let page: string | null = null
  let pages = 0

  for (let i = 0; i < MAX_PAGES; i++) {
    const path = page ? `${base}&page=${encodeURIComponent(page)}` : base
    let res = await getPage(path, adminKey)
    for (let attempt = 0; attempt < MAX_RETRIES && (res.status === 429 || res.status >= 500 || res.status === 0); attempt++) {
      await sleep(Math.min(10, Math.max(1, res.retryAfter || 2 ** attempt)) * 1000)
      res = await getPage(path, adminKey)
    }
    if (res.status < 200 || res.status >= 300 || !res.body) {
      throw new AnalyticsError(errorMessage(res.status, res.body), res.status)
    }
    pages++
    const rows = Array.isArray(res.body.data) ? res.body.data : []
    data.push(...rows)
    if (i === 0) refreshed = typeof res.body.data_refreshed_at === 'string' ? res.body.data_refreshed_at : null
    const next = typeof res.body.next_page === 'string' ? res.body.next_page : null
    if (!res.body.has_more || !next) return { data, data_refreshed_at: refreshed, pages }
    page = next
  }
  throw new AnalyticsError('Anthropic analytics returned more pages than expected. Reconcile a shorter range.', 413)
}
