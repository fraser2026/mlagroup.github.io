export type ProviderVerifyErrorCode =
  | 'invalid_credentials'
  | 'forbidden'
  | 'rate_limited'
  | 'provider_error'
  | 'timeout'
  | 'network_error'
  | 'unsupported'

export type ProviderVerifyResult = {
  ok: boolean
  mode: 'live_api' | 'mock'
  error?: string
  error_code?: ProviderVerifyErrorCode
  provider_request_id?: string
  checked_at: string
}

export type CredentialSlot = 'api' | 'admin'

export type GovernanceTier = 'none' | 'verification' | 'full'

export type ProviderCapabilityKey =
  | 'api_verification'
  | 'model_visibility'
  | 'usage_monitoring'
  | 'cost_monitoring'
  | 'workspace_visibility'
  | 'org_metadata'

export type ProviderCapabilityItem = {
  key: ProviderCapabilityKey
  label: string
  description: string
  available: boolean
  requires: CredentialSlot | 'both'
}

export type ProviderCapabilityProfile = {
  provider_slug: string
  governance_tier: GovernanceTier
  checked_at: string
  capabilities: ProviderCapabilityItem[]
  limitations: string[]
  encouragement?: string
  org_id?: string
  models_count?: number
  enterprise_analytics_path?: boolean
}

export type ProviderInsightsModelRow = {
  model: string
  uncached_input_tokens: number
  cache_read_input_tokens: number
  cache_creation_tokens: number
  output_tokens: number
  total_tokens: number
}

export type ProviderInsightsWorkspaceCost = {
  workspace_id: string | null
  amount_usd: string
}

export type ProviderGovernanceInsights = {
  provider_slug: string
  refreshed_at: string
  window_days: number
  starting_at: string
  ending_at: string
  usage: {
    total_tokens: number
    uncached_input_tokens: number
    cache_read_input_tokens: number
    cache_creation_tokens: number
    output_tokens: number
    by_model: ProviderInsightsModelRow[]
  }
  cost: {
    total_usd: string
    currency: string
    by_workspace: ProviderInsightsWorkspaceCost[]
  }
  errors?: string[]
  diagnostics?: {
    usage_status: number
    cost_status: number
    usage_buckets: number
    usage_result_rows: number
    cost_buckets: number
    cost_result_rows: number
    usage_pages: number
    cost_pages: number
    provider_request_id?: string
  }
  enterprise_analytics_path?: boolean
}
