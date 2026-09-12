/** Pre-defined org API key slots (Openlayer-style) + docs links. */
export type PresetApiKey = {
  name: string
  docsUrl: string
  docsLabel: string
  placeholder: string
  /** Optional note under the field (e.g. Foundry vs Azure naming). */
  hint?: string
}

export const PRESET_API_KEYS: PresetApiKey[] = [
  {
    name: 'OPENAI_API_KEY',
    docsUrl: 'https://platform.openai.com/api-keys',
    docsLabel: 'Find your API key',
    placeholder: 'sk-…',
  },
  {
    name: 'AZURE_OPENAI_API_KEY',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/ai-foundry/',
    docsLabel: 'Find your API key',
    placeholder: '0000-0000-0000-0000',
    hint: 'Microsoft Foundry (env name kept for SDK compatibility).',
  },
  {
    name: 'AZURE_OPENAI_ENDPOINT',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/ai-foundry/',
    docsLabel: 'View docs',
    placeholder: 'https://',
    hint: 'Microsoft Foundry endpoint URL.',
  },
  {
    name: 'ANTHROPIC_API_KEY',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    docsLabel: 'Find your API key',
    placeholder: 'sk-ant-…',
  },
  {
    name: 'AWS_ACCESS_KEY_ID',
    docsUrl: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html',
    docsLabel: 'View docs',
    placeholder: 'AKIA…',
  },
  {
    name: 'AWS_SECRET_ACCESS_KEY',
    docsUrl: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html',
    docsLabel: 'View docs',
    placeholder: '••••••••',
  },
  {
    name: 'GOOGLE_API_KEY',
    docsUrl: 'https://aistudio.google.com/apikey',
    docsLabel: 'Find your API key',
    placeholder: 'AIza…',
  },
]

export type OrgEnvKind = 'preset' | 'secret' | 'plain'

export type OrgEnvVariable = {
  id: string
  org_id: string
  kind: OrgEnvKind
  name: string
  preset_key?: string | null
  has_value: boolean
  /** Only present for plain variables. */
  value?: string | null
  created_at?: string
  updated_at?: string
}
