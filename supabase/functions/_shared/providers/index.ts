import {
  fetchAnthropicGovernanceInsights,
  probeAnthropicCapabilities,
  resolveAnthropicRuntimeAttribution,
  verifyAnthropicAdminKey,
  verifyAnthropicApiKey,
} from './anthropic.ts'
import { probeAzureCapabilities, verifyAzureCredential } from './azure.ts'
import { probeBedrockCapabilities, verifyBedrockCredential } from './bedrock.ts'
import { probeGeminiCapabilities, verifyGeminiApiKey } from './gemini.ts'
import { probeOpenAICapabilities, verifyOpenAIApiKey } from './openai.ts'
import type {
  CredentialSlot,
  ProviderCapabilityProfile,
  ProviderGovernanceInsights,
  ProviderRuntimeAttribution,
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
  ProviderInsightsScope,
  ProviderInsightsWorkspaceCost,
  ProviderRuntimeAttribution,
  ProviderVerifyErrorCode,
  ProviderVerifyResult,
} from './types.ts'

export async function verifyProviderCredential(
  providerSlug: string,
  slot: CredentialSlot,
  apiKey: string,
): Promise<ProviderVerifyResult> {
  switch (providerSlug) {
    case 'anthropic':
      return slot === 'admin'
        ? verifyAnthropicAdminKey(apiKey)
        : verifyAnthropicApiKey(apiKey)
    case 'openai':
      if (slot === 'api') return verifyOpenAIApiKey(apiKey)
      break
    case 'google':
    case 'gemini':
      if (slot === 'api') return verifyGeminiApiKey(apiKey)
      break
    case 'bedrock':
      return verifyBedrockCredential(apiKey)
    case 'azure':
      return verifyAzureCredential(apiKey)
  }
  return {
    ok: false,
    mode: 'live_api',
    error: slot === 'admin'
      ? 'This provider does not expose an Anthropic-style Admin key connector.'
      : 'Live verification is not available for this platform yet.',
    error_code: 'unsupported',
    checked_at: new Date().toISOString(),
  }
}

export async function probeProviderCapabilities(
  providerSlug: string,
  apiKey: string | null,
  adminKey: string | null,
): Promise<ProviderCapabilityProfile | null> {
  switch (providerSlug) {
    case 'anthropic':
      return probeAnthropicCapabilities(apiKey, adminKey)
    case 'openai':
      return probeOpenAICapabilities(apiKey, adminKey)
    case 'google':
    case 'gemini':
      return probeGeminiCapabilities(apiKey, adminKey)
    case 'bedrock':
      return probeBedrockCapabilities()
    case 'azure':
      return probeAzureCapabilities()
  }
  return null
}

export async function resolveProviderRuntimeAttribution(
  providerSlug: string,
  adminKey: string,
  runtimeKey: string,
): Promise<ProviderRuntimeAttribution | null> {
  if (providerSlug === 'anthropic') {
    return resolveAnthropicRuntimeAttribution(adminKey, runtimeKey)
  }
  return null
}

export async function fetchProviderGovernanceInsights(
  providerSlug: string,
  adminKey: string,
  windowDays?: number,
  attribution?: ProviderRuntimeAttribution | null,
): Promise<ProviderGovernanceInsights | null> {
  if (providerSlug === 'anthropic') {
    return fetchAnthropicGovernanceInsights(adminKey, windowDays, attribution)
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
