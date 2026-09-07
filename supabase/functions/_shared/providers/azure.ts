import type { ProviderCapabilityProfile, ProviderVerifyResult } from './types.ts'

export async function verifyAzureCredential(_credential: string): Promise<ProviderVerifyResult> {
  return {
    ok: false,
    mode: 'live_api',
    error: 'Azure AI verification requires a resource endpoint and deployment context in addition to a key. Key-only verification is not supported.',
    error_code: 'unsupported',
    checked_at: new Date().toISOString(),
  }
}

export function probeAzureCapabilities(): ProviderCapabilityProfile {
  return {
    provider_slug: 'azure',
    governance_tier: 'none',
    checked_at: new Date().toISOString(),
    capabilities: [
      { key: 'api_verification', label: 'Runtime verification', description: 'Requires an Azure resource endpoint and deployment.', available: false, requires: 'api' },
      { key: 'model_visibility', label: 'Deployment visibility', description: 'Azure deployments are resource-scoped and are not listed by a key alone.', available: false, requires: 'api' },
      { key: 'usage_monitoring', label: 'Usage monitoring', description: 'Azure Monitor integration is not implemented.', available: false, requires: 'admin' },
      { key: 'cost_monitoring', label: 'Cost monitoring', description: 'Azure Cost Management integration is not implemented.', available: false, requires: 'admin' },
      { key: 'workspace_visibility', label: 'Resource visibility', description: 'Azure subscription and resource inventory requires Entra IAM.', available: false, requires: 'admin' },
      { key: 'org_metadata', label: 'Tenant metadata', description: 'Microsoft Entra tenant metadata is not connected.', available: false, requires: 'admin' },
    ],
    limitations: ['Azure remains unavailable until RegAnchor stores resource endpoints and supports scoped Entra or Azure Resource Manager authorization.'],
  }
}
