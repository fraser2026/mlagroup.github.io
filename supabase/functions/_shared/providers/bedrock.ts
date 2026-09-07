import type { ProviderCapabilityProfile, ProviderVerifyResult } from './types.ts'

export async function verifyBedrockCredential(_credential: string): Promise<ProviderVerifyResult> {
  return {
    ok: false,
    mode: 'live_api',
    error: 'AWS Bedrock verification requires signed IAM credentials, a region, and an AWS account context. API-key verification is not supported.',
    error_code: 'unsupported',
    checked_at: new Date().toISOString(),
  }
}

export function probeBedrockCapabilities(): ProviderCapabilityProfile {
  return {
    provider_slug: 'bedrock',
    governance_tier: 'none',
    checked_at: new Date().toISOString(),
    capabilities: [
      { key: 'api_verification', label: 'Runtime verification', description: 'Requires AWS Signature Version 4 and IAM credentials.', available: false, requires: 'api' },
      { key: 'model_visibility', label: 'Model visibility', description: 'Requires an AWS region and permission to list foundation models.', available: false, requires: 'api' },
      { key: 'usage_monitoring', label: 'Usage monitoring', description: 'CloudWatch integration is not implemented.', available: false, requires: 'admin' },
      { key: 'cost_monitoring', label: 'Cost monitoring', description: 'Cost Explorer integration is not implemented.', available: false, requires: 'admin' },
      { key: 'workspace_visibility', label: 'Account visibility', description: 'AWS account and region inventory is not implemented.', available: false, requires: 'admin' },
      { key: 'org_metadata', label: 'Organisation metadata', description: 'AWS Organizations integration is not implemented.', available: false, requires: 'admin' },
    ],
    limitations: ['Bedrock remains unavailable until RegAnchor supports scoped IAM credentials, AWS regions, and Signature Version 4 requests.'],
  }
}
