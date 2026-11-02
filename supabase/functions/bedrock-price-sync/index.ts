/**
 * RegAnchor — Bedrock price sync
 * Imports Amazon Bedrock per-request prices from the public AWS Price List bulk files and applies
 * them as dated rows. Scheduled daily; callable by the service role for a manual run.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, getServiceClient, json } from '../_shared/provider-connection.ts'
import { BEDROCK_OFFER, parsePriceFile, PRICE_LIST_HOST } from '../_shared/bedrock-pricing.ts'

const DEFAULT_REGIONS = ['eu-west-2', 'eu-west-1', 'eu-central-1', 'us-east-1', 'us-west-2']
const REGION_PATTERN = /^[a-z]{2}(-[a-z]+)+-\d$/
const MAX_REGIONS = 12
const FETCH_TIMEOUT_MS = 30_000

type RegionIndex = { regions?: Record<string, { regionCode?: string; currentVersionUrl?: string }> }

async function authorized(supabase: SupabaseClient, req: Request): Promise<boolean> {
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (serviceRole && bearer === serviceRole) return true
  const secret = req.headers.get('x-cron-secret') || ''
  if (secret.length < 32) return false
  const { data, error } = await supabase.rpc('bedrock_price_sync_cron_ok', { p_secret: secret })
  return !error && data === true
}

/** Default regions plus every region a Bedrock connection uses. */
async function scheduledRegions(supabase: SupabaseClient): Promise<string[]> {
  const [{ data }, { data: accounts }] = await Promise.all([
    supabase
      .from('provider_connections')
      .select('metadata')
      .eq('provider_slug', 'bedrock')
      .neq('status', 'revoked'),
    supabase
      .from('org_aws_accounts')
      .select('home_region')
      .in('status', ['connected', 'error']),
  ])
  const connected = [
    ...((data || []) as { metadata: unknown }[]).map((row) =>
      String((row.metadata as { aws?: { region?: string } } | null)?.aws?.region || '')
    ),
    ...((accounts || []) as { home_region: string | null }[]).map((row) => String(row.home_region || '')),
  ].filter((r) => REGION_PATTERN.test(r))
  return [...new Set([...DEFAULT_REGIONS, ...connected])].slice(0, MAX_REGIONS)
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`AWS price list returned ${res.status} for ${new URL(url).pathname}`)
  return await res.json() as T
}

async function syncRegion(supabase: SupabaseClient, region: string, index: RegionIndex) {
  const { data: run, error: runError } = await supabase
    .from('bedrock_price_sync_runs')
    .insert({ region })
    .select('id')
    .single()
  if (runError || !run) throw new Error(runError?.message || 'Could not start sync run.')

  try {
    const path = index.regions?.[region]?.currentVersionUrl
    if (!path || !path.startsWith(`/offers/v1.0/aws/${BEDROCK_OFFER}/`)) {
      throw new Error(`AWS lists no Bedrock price file for ${region}`)
    }
    const sourceUrl = `${PRICE_LIST_HOST}${path}`
    const parsed = parsePriceFile(await fetchJson(sourceUrl), region)
    if (parsed.rows.length === 0) throw new Error(`No per-request Bedrock prices found for ${region}`)

    const { data, error } = await supabase.rpc('bedrock_prices_apply', {
      p_run_id: run.id,
      p_region: region,
      p_offer_version: parsed.offer_version,
      p_published_at: parsed.published_at,
      p_source_url: sourceUrl,
      p_rows: parsed.rows,
      p_unrecognised: parsed.unrecognised,
      p_left_unpriced: parsed.ambiguous,
    })
    if (error) throw new Error(error.message)
    return { region, offer_version: parsed.offer_version, ...data }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bedrock price sync failed.'
    await supabase
      .from('bedrock_price_sync_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), error: message })
      .eq('id', run.id)
    return { region, status: 'failed', error: message }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  try {
    const supabase = await getServiceClient()
    if (!(await authorized(supabase, req))) return json({ ok: false, error: 'Not authorised' }, 401)

    const body = await req.json().catch(() => ({}))
    const regions = body.regions === undefined ? await scheduledRegions(supabase) : body.regions
    if (!Array.isArray(regions) || regions.length === 0 || regions.length > MAX_REGIONS
      || !regions.every((r) => typeof r === 'string' && REGION_PATTERN.test(r))) {
      return json({ ok: false, error: `Regions must be 1 to ${MAX_REGIONS} AWS region codes.` }, 400)
    }

    const index = await fetchJson<RegionIndex>(`${PRICE_LIST_HOST}/offers/v1.0/aws/${BEDROCK_OFFER}/current/region_index.json`)
    const outcomes = []
    for (const region of [...new Set(regions as string[])]) {
      outcomes.push(await syncRegion(supabase, region, index))
    }
    const failed = outcomes.some((o) => o.status === 'failed')
    return json({ ok: !failed, outcomes }, failed ? 502 : 200)
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'Bedrock price sync failed.' }, 500)
  }
})
