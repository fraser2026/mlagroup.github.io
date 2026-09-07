import type { ProviderCapabilityProfile, ProviderVerifyResult } from './types.ts'

const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models'
const VERIFY_TIMEOUT_MS = 12_000

type GeminiFetchResult = {
  ok: boolean
  status: number
  requestId?: string
  modelCount?: number
}

async function listModels(apiKey: string): Promise<GeminiFetchResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS)
  try {
    const response = await fetch(GEMINI_MODELS_URL, {
      headers: { 'x-goog-api-key': apiKey.trim() },
      signal: controller.signal,
    })
    let modelCount: number | undefined
    if (response.ok) {
      const body = await response.json().catch(() => null) as { models?: unknown[] } | null
      if (Array.isArray(body?.models)) modelCount = body.models.length
    }
    return {
      ok: response.ok,
      status: response.status,
      requestId: response.headers.get('x-request-id') || response.headers.get('x-guploader-uploadid') || undefined,
      modelCount,
    }
  } catch (error) {
    return {
      ok: false,
      status: error instanceof DOMException && error.name === 'AbortError' ? 408 : 0,
    }
  } finally {
    clearTimeout(timer)
  }
}

function failure(result: GeminiFetchResult, checkedAt: string): ProviderVerifyResult {
  const shared = {
    ok: false,
    mode: 'live_api' as const,
    checked_at: checkedAt,
    provider_request_id: result.requestId,
  }
  if (result.status === 400 || result.status === 401) {
    return { ...shared, error: 'Invalid Google Gemini API key.', error_code: 'invalid_credentials' }
  }
  if (result.status === 403) return { ...shared, error: 'Google denied access for this API key.', error_code: 'forbidden' }
  if (result.status === 429) return { ...shared, error: 'Google Gemini rate limit reached. Try again shortly.', error_code: 'rate_limited' }
  if (result.status === 408) return { ...shared, error: 'Google Gemini API request timed out.', error_code: 'timeout' }
  if (result.status === 0) return { ...shared, error: 'Could not reach the Google Gemini API.', error_code: 'network_error' }
  return { ...shared, error: 'Google Gemini returned an unexpected error.', error_code: 'provider_error' }
}

export async function verifyGeminiApiKey(apiKey: string): Promise<ProviderVerifyResult> {
  const checkedAt = new Date().toISOString()
  if ((Deno.env.get('PROVIDER_VERIFY_MODE') || 'live').toLowerCase() === 'mock') {
    return {
      ok: apiKey.trim().length > 10,
      mode: 'mock',
      checked_at: checkedAt,
      ...(apiKey.trim().length > 10 ? {} : { error: 'Mock verification failed.', error_code: 'provider_error' as const }),
    }
  }
  const result = await listModels(apiKey)
  return result.ok
    ? { ok: true, mode: 'live_api', checked_at: checkedAt, provider_request_id: result.requestId }
    : failure(result, checkedAt)
}

export async function probeGeminiCapabilities(
  apiKey: string | null,
  _adminKey: string | null,
): Promise<ProviderCapabilityProfile> {
  const checked_at = new Date().toISOString()
  const result = apiKey ? await listModels(apiKey) : { ok: false, status: 0 }
  const available = result.ok
  return {
    provider_slug: 'google',
    governance_tier: available ? 'verification' : 'none',
    checked_at,
    models_count: result.modelCount,
    capabilities: [
      { key: 'api_verification', label: 'Runtime API verification', description: 'Confirms this asset can authenticate to the Gemini API.', available, requires: 'api' },
      { key: 'model_visibility', label: 'Model visibility', description: 'Lists Gemini models accessible to the API key.', available: available && (result.modelCount ?? 0) > 0, requires: 'api' },
      { key: 'usage_monitoring', label: 'Usage monitoring', description: 'Google Cloud usage export is not connected by this API-key adapter.', available: false, requires: 'admin' },
      { key: 'cost_monitoring', label: 'Cost monitoring', description: 'Cloud Billing export is not connected by this API-key adapter.', available: false, requires: 'admin' },
      { key: 'workspace_visibility', label: 'Project visibility', description: 'Google Cloud project inventory requires IAM and is not available here.', available: false, requires: 'admin' },
      { key: 'org_metadata', label: 'Organisation metadata', description: 'Google Cloud organisation metadata requires IAM and is not available here.', available: false, requires: 'admin' },
    ],
    limitations: [
      'This connector verifies a Gemini API key and lists models only. Cloud Monitoring, Billing, project, and organisation data require a separate Google Cloud IAM connector.',
    ],
  }
}
