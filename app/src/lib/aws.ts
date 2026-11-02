/** Amazon Bedrock connection helpers. Region list matches supabase/functions/_shared/aws.ts. */
import { sb } from './supabase'

export const BEDROCK_REGIONS: { code: string; name: string }[] = [
  { code: 'eu-west-2', name: 'Europe (London)' },
  { code: 'eu-west-1', name: 'Europe (Ireland)' },
  { code: 'eu-central-1', name: 'Europe (Frankfurt)' },
  { code: 'eu-west-3', name: 'Europe (Paris)' },
  { code: 'eu-north-1', name: 'Europe (Stockholm)' },
  { code: 'eu-south-1', name: 'Europe (Milan)' },
  { code: 'eu-central-2', name: 'Europe (Zurich)' },
  { code: 'us-east-1', name: 'US East (N. Virginia)' },
  { code: 'us-east-2', name: 'US East (Ohio)' },
  { code: 'us-west-2', name: 'US West (Oregon)' },
  { code: 'ca-central-1', name: 'Canada (Central)' },
  { code: 'ap-southeast-2', name: 'Asia Pacific (Sydney)' },
  { code: 'ap-northeast-1', name: 'Asia Pacific (Tokyo)' },
  { code: 'ap-southeast-1', name: 'Asia Pacific (Singapore)' },
  { code: 'ap-south-1', name: 'Asia Pacific (Mumbai)' },
]

export const DEFAULT_BEDROCK_REGION = 'eu-west-2'

export const REGION_OPTIONS = BEDROCK_REGIONS.map((r) => ({ value: r.code, label: r.name, description: r.code }))

export function regionName(code?: string | null): string {
  return BEDROCK_REGIONS.find((r) => r.code === code)?.name || code || ''
}

export type BedrockModel = {
  id: string
  name: string
  in_region: boolean
  profiles: string[]
}

/** Result of the one-token test call RegAnchor makes when an account or region is connected or checked. */
export type ModelAccess = {
  status: 'ready' | 'use_case_form' | 'marketplace' | 'not_permitted' | 'unknown'
  model: string | null
  message: string | null
  checked_at: string
}

export type RegionModels = { models: BedrockModel[]; checked_at: string; access?: ModelAccess }

/** An AWS account connected once for the organisation and shared by its Bedrock assets. */
export type AwsAccount = {
  id: string
  label: string | null
  status: 'pending' | 'connected' | 'error' | 'revoked'
  method: 'role' | 'api_key' | null
  aws_account_id: string | null
  home_region: string
  external_id: string
  connection_ref: string
  role_arn: string | null
  template_version: string | null
  models: Record<string, RegionModels> | null
  created_by?: string | null
  connected_at: string | null
  last_verified_at: string | null
  last_error: string | null
}

export type AwsSetup = {
  launch_url: string
  template_url: string
  reganchor_account_id: string
  role_name: string
  stack_name: string
}

const ACCOUNT_COLUMNS =
  'id,label,status,method,aws_account_id,home_region,external_id,connection_ref,role_arn,template_version,models,created_by,connected_at,last_verified_at,last_error'

/** Connected accounts plus setups still in progress, oldest first so the list order stays stable. */
export async function loadAwsAccounts(orgId: string): Promise<AwsAccount[]> {
  const { data } = await sb
    .from('org_aws_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('org_id', orgId)
    .neq('status', 'revoked')
    .order('created_at', { ascending: true })
  return (data as AwsAccount[] | null) || []
}

/** How many active assets use each account. */
export async function loadAwsAccountUsage(orgId: string): Promise<Record<string, number>> {
  const { data } = await sb
    .from('provider_connections')
    .select('org_aws_account_id')
    .eq('org_id', orgId)
    .eq('provider_slug', 'bedrock')
    .neq('status', 'revoked')
    .not('org_aws_account_id', 'is', null)
  const usage: Record<string, number> = {}
  for (const row of (data as { org_aws_account_id: string }[] | null) || []) {
    usage[row.org_aws_account_id] = (usage[row.org_aws_account_id] || 0) + 1
  }
  return usage
}

export function isUsableAccount(a: AwsAccount): boolean {
  return a.status === 'connected' || a.status === 'error'
}

/** Name the team gave the account, else its AWS account number. */
export function accountTitle(a: Pick<AwsAccount, 'label' | 'aws_account_id'>): string {
  return a.label || (a.aws_account_id ? fmtAccountId(a.aws_account_id) : 'Bedrock API key')
}

export function accountAccess(a: Pick<AwsAccount, 'method'>): string {
  return a.method === 'role' ? 'IAM role' : 'Bedrock API key'
}

export function regionModels(a: AwsAccount | null | undefined, region: string | null | undefined) {
  return (a && region && a.models?.[region]) || null
}

export type AccessStep = { title: string; body: string; link?: { href: string; label: string } }

function bedrockConsole(region: string, page: 'model-catalog' | 'chat-playground'): string {
  return `https://${region}.console.aws.amazon.com/bedrock/home?region=${region}#/${page}`
}

/** What someone with AWS console access must do before Claude calls succeed in the region. Null when ready or not yet tested. */
export function accessStep(access: ModelAccess | undefined, region: string): AccessStep | null {
  if (!access || access.status === 'ready') return null
  const where = regionName(region)
  if (access.status === 'use_case_form') {
    return {
      title: `Claude is not enabled on this AWS account in ${where}`,
      body: "Anthropic asks each AWS account for use case details once. In Amazon Bedrock, open any Claude model in the model catalog and submit the form. Approval is usually instant. Then check the connection again.",
      link: { href: bedrockConsole(region, 'model-catalog'), label: 'Open the Bedrock model catalog' },
    }
  }
  if (access.status === 'marketplace') {
    return {
      title: `AWS has not finished enabling Claude in ${where}`,
      body: 'The first Claude call on an account creates an AWS Marketplace subscription, which the RegAnchor role is not allowed to do. An AWS administrator needs to send one message to a Claude model in the Bedrock playground. Then check the connection again.',
      link: { href: bedrockConsole(region, 'chat-playground'), label: 'Open the Bedrock playground' },
    }
  }
  if (access.status === 'not_permitted') {
    return {
      title: `The RegAnchor role cannot call Claude in ${where}`,
      body: `AWS refused a test call to ${access.model || 'Claude'}. Check the stack was created from the RegAnchor template unchanged and that no organisation policy blocks Amazon Bedrock.${access.message ? ` AWS said: ${access.message}` : ''}`,
    }
  }
  return {
    title: `RegAnchor could not confirm Claude works in ${where}`,
    body: `${access.message || 'The test call did not complete.'} Check the connection again in a few minutes.`,
  }
}

const ROLE_ARN_RE = /^arn:(aws|aws-cn|aws-us-gov):iam::(\d{12}):role\/(?:[\w+=,.@-]+\/)*(RegAnchorBedrock-([a-z0-9]{8}))$/

export function parseRoleArn(value: string): { accountId: string; roleName: string; connectionRef: string } | null {
  const m = value.trim().match(ROLE_ARN_RE)
  return m ? { accountId: m[2], roleName: m[3], connectionRef: m[4] } : null
}

/** Guidance when a pasted value is not a RegAnchor role ARN, for the values people commonly copy instead. */
export function roleArnHint(value: string): string {
  const v = value.trim()
  if (/^arn:[\w-]+:cloudformation:/.test(v)) {
    return 'That is the stack ID. Open the Outputs tab and copy the RoleArn value.'
  }
  if (/^arn:[\w-]+:iam::\d{12}:role\//.test(v)) {
    return 'That role was not created by the RegAnchor template. Copy RoleArn from the RegAnchor stack Outputs tab.'
  }
  if (/^arn:/.test(v)) return 'Copy the RoleArn value from the stack Outputs tab. It starts arn:aws:iam::'
  return 'Paste the RoleArn value from the stack Outputs tab.'
}

/** 123456789012 -> 1234 5678 9012, as the AWS console shows account IDs. */
export function fmtAccountId(id?: string | null): string {
  return id && /^\d{12}$/.test(id) ? `${id.slice(0, 4)} ${id.slice(4, 8)} ${id.slice(8)}` : ''
}

const PROFILE_LABELS: Record<string, string> = {
  global: 'Global',
  eu: 'EU',
  us: 'US',
  apac: 'APAC',
  jp: 'Japan',
  au: 'Australia',
  ca: 'Canada',
  'us-gov': 'US GovCloud',
}

/** How a model can be reached: in-region first, then geographic, then global cross-region. */
export function modelRoutes(m: BedrockModel): string[] {
  const order = ['eu', 'us', 'apac', 'jp', 'au', 'ca', 'us-gov', 'global']
  const profiles = [...m.profiles].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  return [...(m.in_region ? ['In region'] : []), ...profiles.map((p) => PROFILE_LABELS[p] || p.toUpperCase())]
}
