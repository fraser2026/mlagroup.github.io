import { createClient, SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2'
import type { ProviderCapabilityProfile, ProviderGovernanceInsights, ProviderVerifyResult } from './providers/types.ts'
import type { CredentialSlot } from './providers/types.ts'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type ProviderAsset = {
  id: string
  org_id: string
  name: string
  provider_slug: string | null
}

export async function getServiceClient(): Promise<SupabaseClient> {
  return createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  )
}

export async function getAuthedUser(req: Request): Promise<{ user: User; supabase: SupabaseClient }> {
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw new Response(JSON.stringify({ ok: false, error: 'Sign in required' }), { status: 401 })

  const supabase = await getServiceClient()
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) {
    throw new Response(JSON.stringify({ ok: false, error: 'Sign in required' }), { status: 401 })
  }
  return { user, supabase }
}

export function parseUuid(value: unknown, label: string): string {
  const id = String(value || '').trim()
  if (!UUID_RE.test(id)) throw new Response(JSON.stringify({ ok: false, error: `${label} is required.` }), { status: 400 })
  return id
}

export async function loadAsset(supabase: SupabaseClient, assetId: string): Promise<ProviderAsset> {
  const { data, error } = await supabase
    .from('ai_systems')
    .select('id,org_id,name,provider_slug')
    .eq('id', assetId)
    .is('deleted_at', null)
    .single()

  if (error || !data) {
    throw new Response(JSON.stringify({ ok: false, error: 'Asset not found.' }), { status: 404 })
  }
  return data as ProviderAsset
}

export async function assertOrgAdmin(
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
): Promise<void> {
  const { data } = await supabase
    .from('org_members')
    .select('role')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (!data || !['owner', 'admin'].includes(data.role)) {
    throw new Response(JSON.stringify({ ok: false, error: 'Only organisation owners and admins can manage provider connections.' }), { status: 403 })
  }
}

export async function assertOrgMember(
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
): Promise<void> {
  const { data } = await supabase
    .from('org_members')
    .select('role')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (!data) {
    throw new Response(JSON.stringify({ ok: false, error: 'Access denied.' }), { status: 403 })
  }
}

export async function loadCatalogProvider(
  supabase: SupabaseClient,
  providerSlug: string,
) {
  const { data, error } = await supabase
    .from('provider_catalog')
    .select('slug,name,auth_method,connector_available')
    .eq('slug', providerSlug)
    .eq('is_active', true)
    .maybeSingle()

  if (error || !data) {
    throw new Response(JSON.stringify({ ok: false, error: 'Provider not found.' }), { status: 404 })
  }
  if (!data.connector_available) {
    throw new Response(JSON.stringify({ ok: false, error: 'Connections are not available for this platform yet.' }), { status: 400 })
  }
  return data
}

export async function getOrCreateConnection(
  supabase: SupabaseClient,
  asset: ProviderAsset,
  providerSlug: string,
  authMethod: string,
  userId: string,
) {
  const { data: existing } = await supabase
    .from('provider_connections')
    .select('*')
    .eq('asset_id', asset.id)
    .eq('provider_slug', providerSlug)
    .neq('status', 'revoked')
    .maybeSingle()

  if (existing) return existing

  const { data, error } = await supabase
    .from('provider_connections')
    .insert({
      org_id: asset.org_id,
      asset_id: asset.id,
      provider_slug: providerSlug,
      status: 'pending',
      auth_method: authMethod,
      connected_by: userId,
    })
    .select('*')
    .single()

  if (error || !data) {
    throw new Response(JSON.stringify({ ok: false, error: error?.message || 'Could not create connection.' }), { status: 500 })
  }
  return data
}

export function parseCredentialSlot(value: unknown): CredentialSlot {
  const slot = String(value || 'api').trim().toLowerCase()
  if (slot === 'admin') return 'admin'
  return 'api'
}

export async function storeConnectionSecret(
  supabase: SupabaseClient,
  connectionId: string,
  secret: string,
  slot: CredentialSlot,
) {
  const { error } = await supabase.rpc('provider_connection_store_secret', {
    p_connection_id: connectionId,
    p_secret: secret,
    p_slot: slot,
  })
  if (error) {
    throw new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 })
  }
}

export async function readConnectionSecret(
  supabase: SupabaseClient,
  connectionId: string,
  slot: CredentialSlot,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('provider_connection_read_secret', {
    p_connection_id: connectionId,
    p_slot: slot,
  })
  if (error) {
    throw new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 })
  }
  return data ? String(data) : null
}

export async function deleteConnectionSecret(
  supabase: SupabaseClient,
  connectionId: string,
  slot: CredentialSlot | 'all',
) {
  const { error } = await supabase.rpc('provider_connection_delete_secret', {
    p_connection_id: connectionId,
    p_slot: slot,
  })
  if (error) {
    throw new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 })
  }
}

export function connectionHasSlot(
  connection: { credential_secret_id?: string | null; admin_credential_secret_id?: string | null },
  slot: CredentialSlot,
): boolean {
  return slot === 'admin'
    ? !!connection.admin_credential_secret_id
    : !!connection.credential_secret_id
}

export async function applyProviderVerification(
  supabase: SupabaseClient,
  connection: {
    id: string
    credential_secret_id?: string | null
    admin_credential_secret_id?: string | null
    metadata?: Record<string, unknown> | null
  },
  result: ProviderVerifyResult,
  slot: CredentialSlot,
) {
  const now = result.checked_at || new Date().toISOString()
  const verificationKey = slot === 'admin' ? 'admin_verification' : 'api_verification'
  const metadata = {
    ...(connection.metadata || {}),
    [verificationKey]: {
      mode: result.mode,
      ok: result.ok,
      at: now,
      error_code: result.error_code || null,
      provider_request_id: result.provider_request_id || null,
    },
  }

  const hasApi = slot === 'api' ? result.ok : !!connection.credential_secret_id
  const hasAdmin = slot === 'admin' ? result.ok : !!connection.admin_credential_secret_id
  const overallOk = hasApi || hasAdmin

  const updatePayload: Record<string, unknown> = {
    metadata,
    updated_at: now,
  }

  if (slot === 'api') {
    updatePayload.last_verified_at = result.ok ? now : null
    updatePayload.last_error = result.ok ? null : (result.error || 'Verification failed.')
  } else {
    updatePayload.admin_last_verified_at = result.ok ? now : null
    updatePayload.admin_last_error = result.ok ? null : (result.error || 'Verification failed.')
  }

  updatePayload.status = overallOk ? 'connected' : 'error'
  if (!overallOk && slot === 'api') {
    updatePayload.last_error = result.error || 'Verification failed.'
  }

  const { data, error } = await supabase
    .from('provider_connections')
    .update(updatePayload)
    .eq('id', connection.id)
    .select('id,status,provider_slug,connected_at,last_verified_at,last_error,admin_last_verified_at,admin_last_error,credential_secret_id,admin_credential_secret_id,metadata')
    .single()

  if (error || !data) {
    throw new Response(JSON.stringify({ ok: false, error: error?.message || 'Could not update connection.' }), { status: 500 })
  }
  return data
}

export async function applyCapabilityProfile(
  supabase: SupabaseClient,
  connection: { id: string; metadata?: Record<string, unknown> | null },
  profile: ProviderCapabilityProfile,
) {
  const metadata = {
    ...(connection.metadata || {}),
    capabilities: profile,
    governance_tier: profile.governance_tier,
    last_capability_probe_at: profile.checked_at,
  }

  const { data, error } = await supabase
    .from('provider_connections')
    .update({
      metadata,
      updated_at: profile.checked_at,
    })
    .eq('id', connection.id)
    .select('id,status,provider_slug,connected_at,last_verified_at,last_error,admin_last_verified_at,admin_last_error,credential_secret_id,admin_credential_secret_id,metadata')
    .single()

  if (error || !data) {
    throw new Response(JSON.stringify({ ok: false, error: error?.message || 'Could not save capabilities.' }), { status: 500 })
  }
  return data
}

export async function applyGovernanceInsights(
  supabase: SupabaseClient,
  connection: { id: string; metadata?: Record<string, unknown> | null },
  insights: ProviderGovernanceInsights,
) {
  const metadata = {
    ...(connection.metadata || {}),
    insights,
    last_insights_refresh_at: insights.refreshed_at,
  }

  const { data, error } = await supabase
    .from('provider_connections')
    .update({
      metadata,
      updated_at: insights.refreshed_at,
    })
    .eq('id', connection.id)
    .select('id,status,provider_slug,connected_at,last_verified_at,last_error,admin_last_verified_at,admin_last_error,credential_secret_id,admin_credential_secret_id,metadata')
    .single()

  if (error || !data) {
    throw new Response(JSON.stringify({ ok: false, error: error?.message || 'Could not save insights.' }), { status: 500 })
  }
  return data
}

export async function writeAudit(
  supabase: SupabaseClient,
  payload: {
    org_id: string
    user_id: string
    action: string
    entity_id: string
    changes: Record<string, unknown>
  },
) {
  await supabase.from('registry_audit_log').insert({
    org_id: payload.org_id,
    user_id: payload.user_id,
    action: payload.action,
    entity_type: 'ai_system',
    entity_id: payload.entity_id,
    changes: payload.changes,
  })
}
