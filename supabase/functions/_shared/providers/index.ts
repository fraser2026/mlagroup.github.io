import {
  fetchAnthropicGovernanceInsights,
  probeAnthropicCapabilities,
  verifyAnthropicAdminKey,
  verifyAnthropicApiKey,
} from './anthropic.ts'
import type {
  CredentialSlot,
  ProviderCapabilityProfile,
  ProviderGovernanceInsights,
  ProviderVerifyResult,
} from './types.ts'

export type {
  CredentialSlot,
  GovernanceTier,
  ProviderCapabilityItem,
  ProviderCapabilityKey,
  ProviderCapabilityProfile,
  ProviderGovernanceInsights,
  ProviderInsightsModelRow,
  ProviderInsightsWorkspaceCost,
  ProviderVerifyErrorCode,
  ProviderVerifyResult,
} from './types.ts'

export async function verifyProviderCredential(
  providerSlug: string,
  slot: CredentialSlot,
  apiKey: string,
): Promise<ProviderVerifyResult> {
  if (providerSlug === 'anthropic') {
    return slot === 'admin'
      ? verifyAnthropicAdminKey(apiKey)
      : verifyAnthropicApiKey(apiKey)
  }
  return {
    ok: false,
    mode: 'live_api',
    error: 'Live verification is not available for this platform yet.',
    error_code: 'unsupported',
    checked_at: new Date().toISOString(),
  }
}

export async function probeProviderCapabilities(
  providerSlug: string,
  apiKey: string | null,
  adminKey: string | null,
): Promise<ProviderCapabilityProfile | null> {
  if (providerSlug === 'anthropic') {
    return probeAnthropicCapabilities(apiKey, adminKey)
  }
  return null
}

export async function fetchProviderGovernanceInsights(
  providerSlug: string,
  adminKey: string,
  windowDays?: number,
): Promise<ProviderGovernanceInsights | null> {
  if (providerSlug === 'anthropic') {
    return fetchAnthropicGovernanceInsights(adminKey, windowDays)
  }
  return null
}

// Back-compat alias used by Phase 3 connect path.
export async function verifyProviderApiKey(
  providerSlug: string,
  authMethod: string,
  apiKey: string,
): Promise<ProviderVerifyResult> {
  if (authMethod !== 'api_key') {
    return {
      ok: false,
      mode: 'live_api',
      error: 'Live verification is not available for this authentication method yet.',
      error_code: 'unsupported',
      checked_at: new Date().toISOString(),
    }
  }
  return verifyProviderCredential(providerSlug, 'api', apiKey)
}
