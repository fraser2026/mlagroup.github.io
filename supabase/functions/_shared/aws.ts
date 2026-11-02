/**
 * AWS access for Bedrock connections: assume a client's RegAnchor role with STS, then call Bedrock
 * with the temporary credentials (or with a Bedrock API key). SigV4 signing via aws4fetch.
 *
 * RegAnchor's own AWS identity is an IAM user whose only permission is sts:AssumeRole on
 * RegAnchorBedrock-* roles. Its keys live in Edge Function secrets, never in the database.
 */
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'

export const TEMPLATE_VERSION = 'v1'
export const ROLE_PREFIX = 'RegAnchorBedrock-'
const TIMEOUT_MS = 12_000

export const BEDROCK_REGIONS: Record<string, string> = {
  'eu-west-2': 'Europe (London)',
  'eu-west-1': 'Europe (Ireland)',
  'eu-central-1': 'Europe (Frankfurt)',
  'eu-west-3': 'Europe (Paris)',
  'eu-north-1': 'Europe (Stockholm)',
  'eu-south-1': 'Europe (Milan)',
  'eu-central-2': 'Europe (Zurich)',
  'us-east-1': 'US East (N. Virginia)',
  'us-east-2': 'US East (Ohio)',
  'us-west-2': 'US West (Oregon)',
  'ca-central-1': 'Canada (Central)',
  'ap-southeast-2': 'Asia Pacific (Sydney)',
  'ap-northeast-1': 'Asia Pacific (Tokyo)',
  'ap-southeast-1': 'Asia Pacific (Singapore)',
  'ap-south-1': 'Asia Pacific (Mumbai)',
}

export type AwsErrorCode =
  | 'not_configured'
  | 'broker_rejected'
  | 'role_not_assumable'
  | 'region_unavailable'
  | 'models_not_listed'
  | 'no_claude_models'
  | 'invalid_key'
  | 'timeout'
  | 'aws_error'

export class AwsConnectError extends Error {
  constructor(public code: AwsErrorCode, message: string, public awsCode?: string) {
    super(message)
  }
}

export type TempCredentials = {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  expiration: string
  assumedArn: string
}

export type ClaudeModel = {
  id: string
  /** Model ID exactly as AWS lists it. Older models end in a version (:0), newer ones do not. */
  model_id?: string
  name: string
  in_region: boolean
  profiles: string[]
}

export type RoleArnParts = { partition: string; accountId: string; roleName: string; connectionRef: string }

const ROLE_ARN_RE = /^arn:(aws|aws-cn|aws-us-gov):iam::(\d{12}):role\/(?:[\w+=,.@-]+\/)*(RegAnchorBedrock-([a-z0-9]{8}))$/

export function parseRoleArn(value: string): RoleArnParts | null {
  const m = value.trim().match(ROLE_ARN_RE)
  return m ? { partition: m[1], accountId: m[2], roleName: m[3], connectionRef: m[4] } : null
}

function brokerConfig() {
  const accessKeyId = Deno.env.get('REGANCHOR_AWS_ACCESS_KEY_ID') || ''
  const secretAccessKey = Deno.env.get('REGANCHOR_AWS_SECRET_ACCESS_KEY') || ''
  const accountId = Deno.env.get('REGANCHOR_AWS_ACCOUNT_ID') || ''
  const templateUrl = Deno.env.get('REGANCHOR_AWS_TEMPLATE_URL') || ''
  const stsRegion = Deno.env.get('REGANCHOR_AWS_STS_REGION') || 'eu-west-2'
  return { accessKeyId, secretAccessKey, accountId, templateUrl, stsRegion }
}

/** Public setup details. Throws not_configured when this environment cannot connect AWS accounts yet. */
export function setupConfig() {
  const { accountId, templateUrl } = brokerConfig()
  if (!/^\d{12}$/.test(accountId) || !/^https:\/\/[a-z0-9.-]+\.s3[.-]/.test(templateUrl)) {
    throw new AwsConnectError('not_configured', 'AWS connections are not set up on RegAnchor yet. Contact RegAnchor support.')
  }
  return { accountId, templateUrl }
}

function xmlValue(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))
  return m ? m[1] : ''
}

async function timed(input: Promise<Response>): Promise<Response> {
  try {
    return await input
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new AwsConnectError('timeout', 'AWS did not respond in time. Try again in a moment.')
    }
    throw new AwsConnectError('aws_error', 'Could not reach AWS. Try again in a moment.')
  }
}

export async function assumeRole(
  roleArn: string,
  externalId: string,
  sessionName: string,
  durationSeconds = 900,
): Promise<TempCredentials> {
  const cfg = brokerConfig()
  if (!cfg.accessKeyId || !cfg.secretAccessKey) {
    throw new AwsConnectError('not_configured', 'AWS connections are not set up on RegAnchor yet. Contact RegAnchor support.')
  }
  const client = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: 'sts',
    region: cfg.stsRegion,
    retries: 0,
  })
  const body = new URLSearchParams({
    Action: 'AssumeRole',
    Version: '2011-06-15',
    RoleArn: roleArn,
    RoleSessionName: sessionName,
    ExternalId: externalId,
    DurationSeconds: String(Math.min(3600, Math.max(900, Math.floor(durationSeconds)))),
  })
  const res = await timed(client.fetch(`https://sts.${cfg.stsRegion}.amazonaws.com/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }))
  const xml = await res.text()
  if (!res.ok) {
    const code = xmlValue(xml, 'Code')
    if (['InvalidClientTokenId', 'SignatureDoesNotMatch', 'ExpiredToken'].includes(code)) {
      throw new AwsConnectError('broker_rejected', 'RegAnchor could not sign in to AWS. Contact RegAnchor support.', code)
    }
    if (code === 'AccessDenied') {
      throw new AwsConnectError(
        'role_not_assumable',
        'RegAnchor could not use this role. Check the stack finished creating and that the role ARN comes from its Outputs tab.',
        code,
      )
    }
    if (code === 'RegionDisabledException') {
      throw new AwsConnectError('region_unavailable', 'AWS STS is turned off for this region in the account.', code)
    }
    throw new AwsConnectError('aws_error', `AWS returned an error (${code || res.status}).`, code)
  }
  const creds = {
    accessKeyId: xmlValue(xml, 'AccessKeyId'),
    secretAccessKey: xmlValue(xml, 'SecretAccessKey'),
    sessionToken: xmlValue(xml, 'SessionToken'),
    expiration: xmlValue(xml, 'Expiration'),
    assumedArn: xmlValue(xml, 'Arn'),
  }
  if (!creds.accessKeyId || !creds.secretAccessKey || !creds.sessionToken) {
    throw new AwsConnectError('aws_error', 'AWS returned an unexpected response.')
  }
  return creds
}

export type Caller = { creds: TempCredentials } | { apiKey: string }

async function bedrockGet(caller: Caller, region: string, path: string): Promise<unknown> {
  const url = `https://bedrock.${region}.amazonaws.com${path}`
  const init: RequestInit = { method: 'GET', signal: AbortSignal.timeout(TIMEOUT_MS) }
  let res: Response
  if ('creds' in caller) {
    const client = new AwsClient({
      accessKeyId: caller.creds.accessKeyId,
      secretAccessKey: caller.creds.secretAccessKey,
      sessionToken: caller.creds.sessionToken,
      service: 'bedrock',
      region,
      retries: 0,
    })
    res = await timed(client.fetch(url, init))
  } else {
    res = await timed(fetch(url, { ...init, headers: { Authorization: `Bearer ${caller.apiKey}` } }))
  }
  const text = await res.text()
  if (!res.ok) {
    let code = res.headers.get('x-amzn-errortype')?.split(':')[0] || ''
    try {
      code ||= String((JSON.parse(text) as { __type?: string }).__type || '').split('#').pop() || ''
    } catch { /* not JSON */ }
    if ('apiKey' in caller && (res.status === 401 || res.status === 403 || code === 'UnrecognizedClientException')) {
      throw new AwsConnectError('invalid_key', 'AWS did not accept this Bedrock API key. Check it has not expired and has Bedrock access.', code)
    }
    if (code === 'UnrecognizedClientException' || res.status === 404) {
      throw new AwsConnectError('region_unavailable', `Amazon Bedrock is not available to this account in ${BEDROCK_REGIONS[region] || region}.`, code)
    }
    if (res.status === 403) {
      throw new AwsConnectError(
        'models_not_listed',
        'RegAnchor could use the role but not list models. Check the stack used the RegAnchor template unchanged.',
        code,
      )
    }
    throw new AwsConnectError('aws_error', `Amazon Bedrock returned an error (${code || res.status}).`, code)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new AwsConnectError('aws_error', 'Amazon Bedrock returned an unexpected response.')
  }
}

type FoundationModels = {
  modelSummaries?: Array<{
    modelId?: string
    modelName?: string
    inferenceTypesSupported?: string[]
    modelLifecycle?: { status?: string }
  }>
}
type InferenceProfiles = {
  inferenceProfileSummaries?: Array<{ inferenceProfileId?: string; status?: string }>
  nextToken?: string
}

/** Claude models this account can call in the region, with the routes (in-region, eu., global.) each offers. */
export async function listClaudeModels(caller: Caller, region: string): Promise<ClaudeModel[]> {
  const fm = await bedrockGet(caller, region, '/foundation-models?byProvider=Anthropic') as FoundationModels
  const models = new Map<string, ClaudeModel>()
  for (const m of fm.modelSummaries || []) {
    if (!m.modelId?.startsWith('anthropic.') || m.modelLifecycle?.status === 'LEGACY') continue
    const id = m.modelId.replace(/:\d+$/, '')
    if (models.has(id)) continue
    models.set(id, {
      id,
      model_id: m.modelId,
      name: m.modelName || id,
      in_region: (m.inferenceTypesSupported || []).includes('ON_DEMAND'),
      profiles: [],
    })
  }

  let next = ''
  for (let page = 0; page < 5; page++) {
    const qs = new URLSearchParams({ typeEquals: 'SYSTEM_DEFINED', maxResults: '1000' })
    if (next) qs.set('nextToken', next)
    const ip = await bedrockGet(caller, region, `/inference-profiles?${qs}`) as InferenceProfiles
    for (const p of ip.inferenceProfileSummaries || []) {
      const m = (p.inferenceProfileId || '').match(/^([a-z]+)\.(anthropic\..+)$/)
      if (!m || p.status !== 'ACTIVE') continue
      const model = models.get(m[2].replace(/:\d+$/, ''))
      if (model && !model.profiles.includes(m[1])) model.profiles.push(m[1])
    }
    next = ip.nextToken || ''
    if (!next) break
  }

  const usable = [...models.values()].filter((m) => m.in_region || m.profiles.length > 0)
  if (usable.length === 0) {
    throw new AwsConnectError(
      'no_claude_models',
      `No Anthropic Claude models are available to this account in ${BEDROCK_REGIONS[region] || region}. Choose another region or ask AWS to enable access.`,
    )
  }
  return usable.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 60)
}

export type AccessStatus = 'ready' | 'use_case_form' | 'marketplace' | 'not_permitted' | 'model_unavailable' | 'unknown'
export type AccessCheck = {
  status: AccessStatus
  model: string | null
  message: string | null
  checked_at: string
  /** Models AWS lists in the region but said are not available to this account, by model id. */
  unavailable?: string[]
}

const MAX_ACCESS_ATTEMPTS = 3
const MODEL_UNAVAILABLE_RE = /not available for this account|identifier is invalid|end of (its )?life|no longer available|legacy/i

/** Bare model id from an invoke ID: drops the eu./us./global. profile prefix and any :N version. */
export function bareModelId(value: string): string {
  return value.replace(/^(?:[a-z]{2,4}(?:-gov)?|global)\.(?=anthropic\.)/, '').replace(/:\d+$/, '')
}

function geoProfile(region: string): string {
  if (region.startsWith('eu-')) return 'eu'
  if (region.startsWith('us-')) return 'us'
  if (region.startsWith('ap-')) return 'apac'
  if (region.startsWith('ca-')) return 'ca'
  return ''
}

function tierRank(m: ClaudeModel): number {
  const name = `${m.name} ${m.id}`.toLowerCase()
  return name.includes('haiku') ? 0 : name.includes('sonnet') ? 1 : 2
}

function invokeId(m: ClaudeModel, region: string): string | null {
  const geo = geoProfile(region)
  const id = m.model_id || m.id
  if (m.in_region) return id
  if (geo && m.profiles.includes(geo)) return `${geo}.${id}`
  if (m.profiles.includes('global')) return `global.${id}`
  return null
}

/**
 * Models to try, in order: the asset's own model when it is listed, then the cheapest (Haiku first,
 * newest first). Each with the route to call it by: in-region, then geographic, then global.
 */
export function accessTestModels(
  models: ClaudeModel[],
  region: string,
  prefer?: string | null,
): { id: string; invoke: string }[] {
  const preferred = prefer ? bareModelId(prefer) : ''
  const ranked = [...models].sort((a, b) =>
    Number(b.id === preferred) - Number(a.id === preferred) || tierRank(a) - tierRank(b) || b.id.localeCompare(a.id)
  )
  return ranked.flatMap((m) => {
    const invoke = invokeId(m, region)
    return invoke ? [{ id: m.id, invoke }] : []
  })
}

/**
 * Sends a one-token Claude request so onboarding blockers (Anthropic's use case form, the AWS
 * Marketplace subscription created by the first call) show up at connect time, not on the first real call.
 * AWS lists models an account cannot use, so a model-level refusal moves on to the next candidate.
 */
export async function checkModelAccess(
  caller: Caller,
  region: string,
  models: ClaudeModel[],
  prefer?: string | null,
): Promise<AccessCheck> {
  const checked_at = new Date().toISOString()
  const candidates = accessTestModels(models, region, prefer).slice(0, MAX_ACCESS_ATTEMPTS)
  if (!candidates.length) return { status: 'unknown', model: null, message: 'No Claude model to test in this region.', checked_at }

  const unavailable: string[] = []
  let last: AccessCheck | null = null
  for (const c of candidates) {
    const result = await testCall(caller, region, c.invoke)
    if (result.status !== 'model_unavailable') {
      return { ...result, model: c.invoke, checked_at, ...(unavailable.length ? { unavailable } : {}) }
    }
    unavailable.push(c.id)
    last = { ...result, model: c.invoke, checked_at }
  }
  return { ...last!, unavailable }
}

async function testCall(caller: Caller, region: string, model: string): Promise<Pick<AccessCheck, 'status' | 'message'>> {
  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${model}/converse`
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: [{ text: 'Reply with OK.' }] }], inferenceConfig: { maxTokens: 1 } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }
  let res: Response
  try {
    if ('creds' in caller) {
      const client = new AwsClient({
        accessKeyId: caller.creds.accessKeyId,
        secretAccessKey: caller.creds.secretAccessKey,
        sessionToken: caller.creds.sessionToken,
        service: 'bedrock',
        region,
        retries: 0,
      })
      res = await timed(client.fetch(url, init))
    } else {
      res = await timed(fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${caller.apiKey}` } }))
    }
  } catch (err) {
    return { status: 'unknown', message: err instanceof Error ? err.message : 'Could not reach AWS.' }
  }

  const text = await res.text()
  if (res.ok || res.status === 429) return { status: 'ready', message: null }

  let message = ''
  try {
    const body = JSON.parse(text) as { message?: string; Message?: string }
    message = String(body.message || body.Message || '')
  } catch { /* not JSON */ }
  message = message.slice(0, 400)
  const lower = message.toLowerCase()
  if (lower.includes('use case')) return { status: 'use_case_form', message }
  if (lower.includes('marketplace')) return { status: 'marketplace', message }
  if (MODEL_UNAVAILABLE_RE.test(message)) return { status: 'model_unavailable', message }
  if (res.status === 403) return { status: 'not_permitted', message }
  return { status: 'unknown', message: message || `Amazon Bedrock returned ${res.status}.` }
}

export function quickCreateUrl(p: {
  region: string
  templateUrl: string
  externalId: string
  connectionRef: string
  accountId: string
}): string {
  const qs = new URLSearchParams({
    templateURL: p.templateUrl,
    stackName: `RegAnchor-Bedrock-${p.connectionRef}`,
    param_ExternalId: p.externalId,
    param_ConnectionRef: p.connectionRef,
    param_RegAnchorAccountId: p.accountId,
  })
  return `https://${p.region}.console.aws.amazon.com/cloudformation/home?region=${p.region}#/stacks/quickcreate?${qs}`
}
