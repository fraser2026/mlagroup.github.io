/**
 * RegAnchor — Connect AWS (Amazon Bedrock).
 *
 * AWS accounts are connected once per organisation and shared by its Bedrock assets. Preferred access is a
 * cross-account IAM role created by the RegAnchor CloudFormation template, trusted only with an external ID
 * unique to that account connection. Fallback: a Bedrock API key stored in Vault.
 *
 * Account actions (owner/admin): prepare, verify_role, connect_key, check, rename, disconnect.
 * Asset actions (owner/admin): link, unlink. verify_role and connect_key also link the asset when given one.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  assertOrgAdmin,
  corsHeaders,
  deleteConnectionSecret,
  getAuthedUser,
  json,
  loadAsset,
  parseUuid,
  type ProviderAsset,
  writeAudit,
} from '../_shared/provider-connection.ts'
import {
  type AccessCheck,
  assumeRole,
  AwsConnectError,
  BEDROCK_REGIONS,
  type Caller,
  checkModelAccess,
  type ClaudeModel,
  listClaudeModels,
  parseRoleArn,
  quickCreateUrl,
  setupConfig,
  TEMPLATE_VERSION,
} from '../_shared/aws.ts'

const PROVIDER = 'bedrock'
const MAX_CHECK_REGIONS = 5

type RegionModels = { models: ClaudeModel[]; checked_at: string; access?: AccessCheck }
type ModelsByRegion = Record<string, RegionModels>

type Account = {
  id: string
  org_id: string
  label: string | null
  status: 'pending' | 'connected' | 'error' | 'revoked'
  method: 'role' | 'api_key' | null
  aws_account_id: string | null
  home_region: string
  external_id: string
  connection_ref: string
  role_arn: string | null
  template_version: string | null
  credential_secret_id: string | null
  models: ModelsByRegion | null
  connected_at: string | null
  last_verified_at: string | null
  last_error: string | null
  created_by: string | null
  created_at: string
}

function fail(status: number, error: string, code?: string): never {
  throw new Response(JSON.stringify({ ok: false, error, code: code || null }), { status })
}

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function randomRef(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => alphabet[b % alphabet.length]).join('')
}

function parseRegion(value: unknown): string {
  const region = String(value || '').trim()
  if (!BEDROCK_REGIONS[region]) fail(400, 'Choose a supported AWS region.')
  return region
}

function parseLabel(value: unknown): string | null {
  const label = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!label) return null
  if (label.length > 60) fail(400, 'Keep the name to 60 characters or fewer.')
  return label
}

function fmtAccountId(id: string | null): string {
  return id && /^\d{12}$/.test(id) ? `${id.slice(0, 4)} ${id.slice(4, 8)} ${id.slice(8)}` : ''
}

function accountTitle(a: Account): string {
  return a.label || (a.aws_account_id ? `AWS account ${fmtAccountId(a.aws_account_id)}` : 'Bedrock API key')
}

/** Fields safe to return to the browser. The external ID is shown to the organisation on purpose. */
function publicAccount(a: Account) {
  return {
    id: a.id,
    label: a.label,
    status: a.status,
    method: a.method,
    aws_account_id: a.aws_account_id,
    home_region: a.home_region,
    external_id: a.external_id,
    connection_ref: a.connection_ref,
    role_arn: a.role_arn,
    template_version: a.template_version,
    models: a.models || {},
    connected_at: a.connected_at,
    last_verified_at: a.last_verified_at,
    last_error: a.last_error,
  }
}

function setupFor(a: Account) {
  const { accountId, templateUrl } = setupConfig()
  return {
    launch_url: quickCreateUrl({
      region: a.home_region,
      templateUrl,
      externalId: a.external_id,
      connectionRef: a.connection_ref,
      accountId,
    }),
    template_url: templateUrl,
    reganchor_account_id: accountId,
    role_name: `RegAnchorBedrock-${a.connection_ref}`,
    stack_name: `RegAnchor-Bedrock-${a.connection_ref}`,
  }
}

async function loadAccount(supabase: SupabaseClient, id: string, orgId: string): Promise<Account> {
  const { data } = await supabase
    .from('org_aws_accounts')
    .select('*')
    .eq('id', id)
    .eq('org_id', orgId)
    .neq('status', 'revoked')
    .maybeSingle()
  if (!data) fail(404, 'This AWS account is no longer connected to the organisation.')
  return data as Account
}

async function saveAccount(supabase: SupabaseClient, id: string, patch: Record<string, unknown>): Promise<Account> {
  const { data, error } = await supabase
    .from('org_aws_accounts')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (error || !data) fail(500, 'Could not save the AWS account.')
  return data as Account
}

/** Lists Claude models in the region, then makes a one-token test call. A failed test call is reported, not thrown. */
async function checkRegion(caller: Caller, region: string, at: string): Promise<RegionModels> {
  const models = await listClaudeModels(caller, region)
  const access = await checkModelAccess(caller, region, models)
  return { models, checked_at: at, access }
}

function withRegion(a: Account, region: string, entry: RegionModels): ModelsByRegion {
  return { ...(a.models || {}), [region]: entry }
}

async function callerFor(supabase: SupabaseClient, a: Account, purpose: string): Promise<Caller> {
  if (a.method === 'role' && a.role_arn) {
    return { creds: await assumeRole(a.role_arn, a.external_id, `reganchor-${purpose}-${a.connection_ref}`) }
  }
  if (a.method === 'api_key') {
    const { data, error } = await supabase.rpc('org_aws_account_read_secret', { p_account_id: a.id })
    if (error || !data) fail(400, 'The stored Bedrock API key is missing. Connect the account again.')
    return { apiKey: String(data) }
  }
  fail(400, 'Finish connecting this AWS account first.')
}

/** Mirrors the account's health onto every asset that uses it. */
async function syncLinkedAssets(supabase: SupabaseClient, accountId: string, patch: Record<string, unknown>) {
  await supabase
    .from('provider_connections')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('org_aws_account_id', accountId)
    .neq('status', 'revoked')
}

async function linkedAssets(supabase: SupabaseClient, accountId: string) {
  const { data } = await supabase
    .from('provider_connections')
    .select('id,asset_id,metadata')
    .eq('org_aws_account_id', accountId)
    .neq('status', 'revoked')
  return (data || []) as { id: string; asset_id: string; metadata: Record<string, unknown> | null }[]
}

async function linkAsset(supabase: SupabaseClient, asset: ProviderAsset, a: Account, region: string, userId: string) {
  const { data: existing } = await supabase
    .from('provider_connections')
    .select('*')
    .eq('asset_id', asset.id)
    .eq('provider_slug', PROVIDER)
    .neq('status', 'revoked')
    .maybeSingle()

  const now = new Date().toISOString()
  const fields = {
    status: 'connected',
    auth_method: a.method === 'role' ? 'iam' : 'api_key',
    org_aws_account_id: a.id,
    connected_by: userId,
    connected_at: now,
    last_verified_at: a.models?.[region]?.checked_at || now,
    last_error: null,
    updated_at: now,
  }

  if (existing) {
    if (existing.credential_secret_id) await deleteConnectionSecret(supabase, existing.id, 'all')
    const metadata = { ...((existing.metadata || {}) as Record<string, unknown>), aws: { region } }
    const { error } = await supabase.from('provider_connections').update({ ...fields, metadata }).eq('id', existing.id)
    if (error) fail(500, 'Could not link the AWS account to this asset.')
    return
  }

  const { error } = await supabase.from('provider_connections').insert({
    ...fields,
    org_id: asset.org_id,
    asset_id: asset.id,
    provider_slug: PROVIDER,
    metadata: { aws: { region } },
  })
  if (error) fail(500, 'Could not link the AWS account to this asset.')
}

/** Makes sure Bedrock prices exist for the region; imports them in the background if not. */
async function ensureRegionPrices(supabase: SupabaseClient, region: string) {
  const { count } = await supabase
    .from('bedrock_prices')
    .select('id', { count: 'exact', head: true })
    .eq('region', region)
  if ((count || 0) > 0) return
  const task = fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/bedrock-price-sync`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ regions: [region] }),
  }).catch(() => undefined)
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime
  if (runtime?.waitUntil) runtime.waitUntil(task)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  try {
    const { user, supabase } = await getAuthedUser(req)
    const body = await req.json().catch(() => ({}))
    const action = String(body.action || '')

    const asset = body.asset_id ? await loadAsset(supabase, parseUuid(body.asset_id, 'Asset')) : null
    if (asset && asset.provider_slug !== PROVIDER) fail(400, 'This asset does not use Amazon Bedrock.')
    const orgId = asset ? asset.org_id : parseUuid(body.org_id, 'Organisation')
    if (asset && body.org_id && body.org_id !== asset.org_id) fail(400, 'This asset belongs to another organisation.')
    await assertOrgAdmin(supabase, user.id, orgId)

    const accountAudit = (name: string, a: Account, changes: Record<string, unknown>) =>
      writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: name,
        entity_type: 'aws_account',
        entity_id: a.id,
        changes: { label: a.label, aws_account_id: a.aws_account_id, method: a.method, ...changes },
      })
    const assetAudit = (target: { id: string; name: string }, name: string, changes: Record<string, unknown>) =>
      writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: name,
        entity_id: target.id,
        changes: { _system_name: target.name, provider_slug: PROVIDER, ...changes },
      })
    const linkedChanges = (a: Account, region: string) => ({
      aws_account: a.id,
      account_id: a.aws_account_id,
      account_label: accountTitle(a),
      method: a.method,
      region,
    })
    const accountParam = () => parseUuid(body.account, 'AWS account')

    if (action === 'prepare') {
      const region = parseRegion(body.region)
      const label = parseLabel(body.label)
      setupConfig()

      let account: Account | null = null
      if (body.account) {
        account = await loadAccount(supabase, accountParam(), orgId)
        if (account.status !== 'pending') fail(409, 'This AWS account is already connected.')
      } else {
        const { data } = await supabase
          .from('org_aws_accounts')
          .select('*')
          .eq('org_id', orgId)
          .eq('status', 'pending')
          .eq('created_by', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        account = (data as Account) || null
      }

      if (!account) {
        const { data, error } = await supabase
          .from('org_aws_accounts')
          .insert({
            org_id: orgId,
            status: 'pending',
            label,
            home_region: region,
            external_id: `ra-${randomHex(20)}`,
            connection_ref: randomRef(),
            template_version: TEMPLATE_VERSION,
            created_by: user.id,
          })
          .select('*')
          .single()
        if (error || !data) fail(500, 'Could not start the AWS setup.')
        account = data as Account
      } else if (account.home_region !== region || (label !== null && account.label !== label)) {
        account = await saveAccount(supabase, account.id, { home_region: region, ...(label !== null ? { label } : {}) })
      }

      return json({ ok: true, account: publicAccount(account), setup: setupFor(account) })
    }

    if (action === 'verify_role') {
      const account = await loadAccount(supabase, accountParam(), orgId)
      if (account.method === 'api_key') fail(400, 'This connection uses a Bedrock API key. Connect a role as a new AWS account.')
      const label = body.label !== undefined ? parseLabel(body.label) : account.label
      const arn = String(body.role_arn || '').trim()
      const parts = parseRoleArn(arn)
      if (!parts) fail(400, 'Paste the RoleArn value from the stack Outputs tab. It starts with arn:aws:iam:: and ends with RegAnchorBedrock- and 8 characters.')
      if (parts.connectionRef !== account.connection_ref) {
        fail(400, `This role belongs to a different RegAnchor setup. Use the stack named RegAnchor-Bedrock-${account.connection_ref}.`)
      }

      const { data: duplicate } = await supabase
        .from('org_aws_accounts')
        .select('id,label')
        .eq('org_id', orgId)
        .eq('aws_account_id', parts.accountId)
        .neq('status', 'revoked')
        .neq('id', account.id)
        .maybeSingle()
      if (duplicate) {
        const name = duplicate.label ? ` as ${duplicate.label}` : ''
        fail(409, `AWS account ${fmtAccountId(parts.accountId)} is already connected${name}. Choose it from your connected accounts instead.`)
      }

      try {
        const creds = await assumeRole(arn, account.external_id, `reganchor-verify-${account.connection_ref}`)
        const now = new Date().toISOString()
        const entry = await checkRegion({ creds }, account.home_region, now)
        const saved = await saveAccount(supabase, account.id, {
          status: 'connected',
          method: 'role',
          label,
          aws_account_id: parts.accountId,
          role_arn: arn,
          template_version: account.template_version || TEMPLATE_VERSION,
          connected_by: user.id,
          connected_at: account.connected_at || now,
          last_verified_at: now,
          last_error: null,
          models: withRegion(account, account.home_region, entry),
        })
        await syncLinkedAssets(supabase, saved.id, { status: 'connected', last_verified_at: now, last_error: null })
        await ensureRegionPrices(supabase, saved.home_region)
        await accountAudit('aws_account_connected', saved, {
          region: saved.home_region,
          models: entry.models.length,
          model_access: entry.access?.status,
        })
        if (asset) {
          await linkAsset(supabase, asset, saved, saved.home_region, user.id)
          await assetAudit(asset, 'aws_linked', linkedChanges(saved, saved.home_region))
        }
        return json({ ok: true, account: publicAccount(saved) })
      } catch (err) {
        if (!(err instanceof AwsConnectError)) throw err
        await saveAccount(supabase, account.id, { last_error: err.message })
        await accountAudit('aws_account_checked', account, {
          verification_ok: false,
          error_code: err.code,
          aws_code: err.awsCode || null,
          region: account.home_region,
        })
        fail(400, err.message, err.code)
      }
    }

    if (action === 'connect_key') {
      const region = parseRegion(body.region)
      const label = parseLabel(body.label)
      const apiKey = String(body.api_key || '').trim()
      if (apiKey.length < 20 || apiKey.length > 4096 || /\s/.test(apiKey)) fail(400, 'Paste the full Bedrock API key.')

      const now = new Date().toISOString()
      let entry: RegionModels
      try {
        entry = await checkRegion({ apiKey }, region, now)
      } catch (err) {
        if (!(err instanceof AwsConnectError)) throw err
        fail(400, err.message, err.code)
      }

      const { data, error } = await supabase
        .from('org_aws_accounts')
        .insert({
          org_id: orgId,
          status: 'connected',
          method: 'api_key',
          label,
          home_region: region,
          external_id: `ra-${randomHex(20)}`,
          connection_ref: randomRef(),
          models: { [region]: entry },
          connected_by: user.id,
          created_by: user.id,
          connected_at: now,
          last_verified_at: now,
        })
        .select('*')
        .single()
      if (error || !data) fail(500, 'Could not save the AWS account.')
      const saved = data as Account

      const { error: secretError } = await supabase.rpc('org_aws_account_store_secret', {
        p_account_id: saved.id,
        p_secret: apiKey,
      })
      if (secretError) {
        await supabase.from('org_aws_accounts').delete().eq('id', saved.id)
        fail(500, 'Could not store the API key securely. Nothing was saved.')
      }

      await ensureRegionPrices(supabase, region)
      await accountAudit('aws_account_connected', saved, {
        region,
        models: entry.models.length,
        model_access: entry.access?.status,
      })
      if (asset) {
        await linkAsset(supabase, asset, saved, region, user.id)
        await assetAudit(asset, 'aws_linked', linkedChanges(saved, region))
      }
      return json({ ok: true, account: publicAccount(saved) })
    }

    if (action === 'check') {
      const account = await loadAccount(supabase, accountParam(), orgId)
      if (account.status === 'pending') fail(400, 'Finish connecting this AWS account first.')
      const links = await linkedAssets(supabase, account.id)
      const regions = body.region
        ? [parseRegion(body.region)]
        : [...new Set([
          account.home_region,
          ...links.map((l) => String((l.metadata?.aws as { region?: string } | undefined)?.region || '')),
        ])].filter((r) => BEDROCK_REGIONS[r]).slice(0, MAX_CHECK_REGIONS)

      try {
        const caller = await callerFor(supabase, account, 'check')
        const now = new Date().toISOString()
        let models = account.models || {}
        let total = 0
        const access: Record<string, string | undefined> = {}
        for (const region of regions) {
          const entry = await checkRegion(caller, region, now)
          models = { ...models, [region]: entry }
          total = Math.max(total, entry.models.length)
          access[region] = entry.access?.status
        }
        const saved = await saveAccount(supabase, account.id, {
          status: 'connected',
          last_verified_at: now,
          last_error: null,
          models,
        })
        await syncLinkedAssets(supabase, saved.id, { status: 'connected', last_verified_at: now, last_error: null })
        await accountAudit('aws_account_checked', saved, { verification_ok: true, regions, models: total, model_access: access })
        if (asset) await assetAudit(asset, 'aws_verified', { verification_ok: true, method: saved.method, region: regions[0], models: total })
        return json({ ok: true, account: publicAccount(saved) })
      } catch (err) {
        if (!(err instanceof AwsConnectError)) throw err
        const saved = await saveAccount(supabase, account.id, { status: 'error', last_error: err.message })
        await syncLinkedAssets(supabase, saved.id, { status: 'error', last_error: err.message })
        await accountAudit('aws_account_checked', saved, { verification_ok: false, error_code: err.code, regions })
        if (asset) await assetAudit(asset, 'aws_verified', { verification_ok: false, method: saved.method, error_code: err.code })
        fail(400, err.message, err.code)
      }
    }

    if (action === 'rename') {
      const account = await loadAccount(supabase, accountParam(), orgId)
      const label = parseLabel(body.label)
      if (label === account.label) return json({ ok: true, account: publicAccount(account) })
      const saved = await saveAccount(supabase, account.id, { label })
      await accountAudit('aws_account_renamed', saved, { previous_label: account.label })
      return json({ ok: true, account: publicAccount(saved) })
    }

    if (action === 'disconnect') {
      const account = await loadAccount(supabase, accountParam(), orgId)
      const links = await linkedAssets(supabase, account.id)
      if (account.credential_secret_id) {
        const { error } = await supabase.rpc('org_aws_account_delete_secret', { p_account_id: account.id })
        if (error) fail(500, 'Could not remove the stored API key. Nothing was changed.')
      }
      await saveAccount(supabase, account.id, { status: 'revoked', last_error: null })
      if (links.length) {
        await supabase
          .from('provider_connections')
          .update({ status: 'revoked', updated_at: new Date().toISOString() })
          .in('id', links.map((l) => l.id))
        const { data: systems } = await supabase
          .from('ai_systems')
          .select('id,name')
          .in('id', links.map((l) => l.asset_id))
        for (const s of (systems || []) as { id: string; name: string }[]) {
          await assetAudit(s, 'aws_disconnected', { aws_account: account.id, account_id: account.aws_account_id, account_label: accountTitle(account) })
        }
      }
      await accountAudit('aws_account_disconnected', account, { assets: links.length })
      return json({
        ok: true,
        assets: links.length,
        stack_name: account.method === 'role' ? `RegAnchor-Bedrock-${account.connection_ref}` : null,
      })
    }

    if (action === 'link') {
      if (!asset) fail(400, 'Asset is required.')
      const account = await loadAccount(supabase, accountParam(), orgId)
      if (account.status !== 'connected') {
        fail(400, `${accountTitle(account)} needs attention. Check it on the Organisation page before using it.`)
      }
      const region = parseRegion(body.region || account.home_region)
      let current = account
      if (!account.models?.[region]) {
        try {
          const caller = await callerFor(supabase, account, 'link')
          const entry = await checkRegion(caller, region, new Date().toISOString())
          current = await saveAccount(supabase, account.id, { models: withRegion(account, region, entry) })
        } catch (err) {
          if (!(err instanceof AwsConnectError)) throw err
          fail(400, err.message, err.code)
        }
      }
      await linkAsset(supabase, asset, current, region, user.id)
      await ensureRegionPrices(supabase, region)
      await assetAudit(asset, 'aws_linked', linkedChanges(current, region))
      return json({ ok: true, account: publicAccount(current) })
    }

    if (action === 'unlink') {
      if (!asset) fail(400, 'Asset is required.')
      const { data: conn } = await supabase
        .from('provider_connections')
        .select('id,org_aws_account_id,metadata')
        .eq('asset_id', asset.id)
        .eq('provider_slug', PROVIDER)
        .neq('status', 'revoked')
        .maybeSingle()
      if (!conn) return json({ ok: true })
      if (conn.org_aws_account_id === null) await deleteConnectionSecret(supabase, conn.id, 'all')
      await supabase
        .from('provider_connections')
        .update({ status: 'revoked', updated_at: new Date().toISOString() })
        .eq('id', conn.id)
      await assetAudit(asset, 'aws_unlinked', {
        aws_account: conn.org_aws_account_id,
        region: (conn.metadata as { aws?: { region?: string } } | null)?.aws?.region || null,
      })
      return json({ ok: true })
    }

    fail(400, 'Unknown action.')
  } catch (err) {
    if (err instanceof Response) {
      const payload = await err.json().catch(() => ({ ok: false, error: 'Request failed.' }))
      return json(payload, err.status)
    }
    if (err instanceof AwsConnectError) return json({ ok: false, error: err.message, code: err.code }, 400)
    return json({ ok: false, error: err instanceof Error ? err.message : 'Request failed.' }, 500)
  }
})
