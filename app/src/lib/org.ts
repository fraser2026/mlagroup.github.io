import { sb } from './supabase'
import { parseRpcPayload } from './rpc'

export type InvitePeek = {
  ok: true
  email: string
  role: string
  org_id: string
  org_name: string
  expires_at?: string
}

export type InviteAcceptResult = {
  ok: boolean
  error?: string
  org_id?: string
  role?: string
}

const INVITE_STORAGE_KEY = 'ra_invite'

export function storeInviteToken(token: string) {
  try {
    localStorage.setItem(INVITE_STORAGE_KEY, token)
  } catch {
    /* ignore */
  }
}

export function readInviteToken(): string | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const fromQuery = params.get('invite') || params.get('token')
    if (fromQuery) return fromQuery
    return localStorage.getItem(INVITE_STORAGE_KEY)
  } catch {
    return null
  }
}

export function clearInviteToken() {
  try {
    localStorage.removeItem(INVITE_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export async function peekOrgInvite(token: string): Promise<InvitePeek | { ok: false; error: string }> {
  const { data, error } = await sb.rpc('peek_org_invite', { p_token: token })
  if (error) return { ok: false, error: error.message }
  const payload = parseRpcPayload<{
    ok?: boolean
    error?: string
    email?: string
    role?: string
    org_id?: string
    org_name?: string
    expires_at?: string
  }>(data)
  if (!payload || payload.ok !== true) {
    return { ok: false, error: payload?.error || 'Invitation not found' }
  }
  return {
    ok: true,
    email: String(payload.email || ''),
    role: String(payload.role || 'viewer'),
    org_id: String(payload.org_id || ''),
    org_name: String(payload.org_name || 'your organisation'),
    expires_at: payload.expires_at,
  }
}

export async function acceptOrgInviteToken(token: string): Promise<InviteAcceptResult> {
  storeInviteToken(token)
  const { data, error } = await sb.rpc('accept_org_invite', { p_token: token })
  if (error) return { ok: false, error: error.message }
  const payload = parseRpcPayload<InviteAcceptResult>(data)
  if (!payload || payload.ok === false) {
    const err = payload?.error || 'Could not accept invitation'
    if (/not found|expired|revoked|already accepted/i.test(err)) clearInviteToken()
    return { ok: false, error: err }
  }
  clearInviteToken()
  return { ok: true, org_id: payload.org_id, role: payload.role }
}

export type OrgRole = 'owner' | 'admin' | 'editor' | 'viewer' | 'member' | string

export type Organisation = {
  id: string
  name: string
  sector?: string | null
  org_size?: string | null
  plan?: string | null
  subscription_status?: string | null
  subscription_period_end?: string | null
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  created_by?: string | null
}

export type ProfileRow = {
  id: string
  first_name?: string | null
  last_name?: string | null
  full_name?: string | null
  organisation?: string | null
  org_id?: string | null
  email?: string | null
  paid?: boolean | null
  job_title?: string | null
  department?: string | null
  work_phone?: string | null
}

export type OrgContext = {
  profile: ProfileRow | null
  org: Organisation | null
  role: OrgRole | null
}

const PROFILE_SELECT =
  'id,first_name,last_name,full_name,organisation,org_id,email,paid,job_title,department,work_phone'

export type ProfileNameSeed = {
  first_name?: string | null
  last_name?: string | null
  full_name?: string | null
}

export function canManageMembers(role: OrgRole | null) {
  return role === 'owner' || role === 'admin'
}

export function canWriteRegistry(role: OrgRole | null) {
  return role === 'owner' || role === 'admin' || role === 'editor' || role === 'member'
}

export function canDeleteRegistry(role: OrgRole | null) {
  return role === 'owner' || role === 'admin'
}

export function orgSeatLimit(plan?: string | null) {
  const p = (plan || 'free').toLowerCase()
  if (p === 'professional') return 15
  if (p === 'enterprise') return 50
  return 1
}

export function isPaidTier(org: Organisation | null) {
  return (
    !!org &&
    (org.plan === 'essentials' || org.plan === 'professional') &&
    org.subscription_status === 'active'
  )
}

export function hasLiveSubscription(org: Organisation | null) {
  return !!org && (org.subscription_status === 'active' || org.subscription_status === 'trialing')
}

/** Auditor access (share + API) — Professional and Enterprise with live subscription. */
export function canUseAuditorAccess(org: Organisation | null) {
  const plan = (org?.plan || '').toLowerCase()
  return (plan === 'professional' || plan === 'enterprise') && hasLiveSubscription(org)
}

/** Org governance dossier PDF export — same commercial gate as auditor access. */
export function canUseGovernanceDossier(org: Organisation | null) {
  return canUseAuditorAccess(org)
}

/** AI policy drafting — Essentials / Professional / Enterprise with live subscription. */
export function canUsePolicyDrafting(org: Organisation | null) {
  const plan = (org?.plan || '').toLowerCase()
  return (
    (plan === 'essentials' || plan === 'professional' || plan === 'enterprise') &&
    hasLiveSubscription(org)
  )
}

/** Roles that may create/edit unpublished policy drafts in the AI workspace. */
export function canDraftPolicies(role: OrgRole | null) {
  return role === 'owner' || role === 'admin' || role === 'editor'
}

/** Owner/admin may publish and edit published policy bodies. */
export function canPublishPolicies(role: OrgRole | null) {
  return role === 'owner' || role === 'admin'
}

function nameSeedFromMeta(meta?: Record<string, unknown> | null): ProfileNameSeed {
  if (!meta) return {}
  const first = typeof meta.first_name === 'string' ? meta.first_name.trim() : ''
  const last = typeof meta.last_name === 'string' ? meta.last_name.trim() : ''
  const full = typeof meta.full_name === 'string' ? meta.full_name.trim() : ''
  return {
    first_name: first || null,
    last_name: last || null,
    full_name: full || null,
  }
}

/** Portal-parity profile self-heal (non-privileged fields only). */
export async function ensureProfile(
  userId: string,
  email?: string | null,
  nameSeed?: ProfileNameSeed | null,
  userMeta?: Record<string, unknown> | null,
) {
  const seed = {
    ...nameSeedFromMeta(userMeta),
    ...(nameSeed || {}),
  }
  const first = String(seed.first_name || '').trim() || null
  const last = String(seed.last_name || '').trim() || null
  const full =
    String(seed.full_name || '').trim() ||
    [first, last].filter(Boolean).join(' ') ||
    null

  const { data: profile } = await sb.from('profiles').select(PROFILE_SELECT).eq('id', userId).maybeSingle()
  if (profile) {
    const row = profile as ProfileRow
    const needsName =
      !(row.first_name || row.last_name || row.full_name) && (first || last || full)
    const needsEmail = !row.email && email
    if (needsName || needsEmail) {
      const patch: Record<string, unknown> = {}
      if (needsEmail) patch.email = email
      if (needsName) {
        if (first) patch.first_name = first
        if (last) patch.last_name = last
        if (full) patch.full_name = full
      }
      const { data: updated } = await sb
        .from('profiles')
        .update(patch)
        .eq('id', userId)
        .select(PROFILE_SELECT)
        .maybeSingle()
      return (updated as ProfileRow) || row
    }
    return row
  }

  const insert: Record<string, unknown> = {
    id: userId,
    email: email || null,
  }
  if (first) insert.first_name = first
  if (last) insert.last_name = last
  if (full) insert.full_name = full
  // Do not invent email local-part as a display name

  const { data: created, error } = await sb
    .from('profiles')
    .insert(insert)
    .select(PROFILE_SELECT)
    .maybeSingle()
  if (error) {
    const { data: again } = await sb.from('profiles').select(PROFILE_SELECT).eq('id', userId).maybeSingle()
    return again as ProfileRow | null
  }
  return created as ProfileRow | null
}

/**
 * Mirror portal-core ensureOrg(): membership → profiles.org_id → created_by → create.
 */
export async function ensureOrg(userId: string, profileIn?: OrgContext['profile']): Promise<OrgContext> {
  let profile = profileIn || (await ensureProfile(userId))
  let role: OrgRole | null = null
  let org: Organisation | null = null

  const { data: membership } = await sb
    .from('org_members')
    .select('org_id,role')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()

  if (membership?.org_id) {
    const { data: fromMem } = await sb.from('organisations').select('*').eq('id', membership.org_id).maybeSingle()
    if (fromMem) {
      org = fromMem as Organisation
      role = (membership.role as OrgRole) || 'viewer'
      if (profile && profile.org_id !== fromMem.id) {
        await sb.from('profiles').update({ org_id: fromMem.id }).eq('id', userId)
        profile = { ...profile, org_id: fromMem.id }
      }
      return { profile, org, role }
    }
  }

  if (profile?.org_id) {
    const { data } = await sb.from('organisations').select('*').eq('id', profile.org_id).maybeSingle()
    if (data) {
      org = data as Organisation
      const { data: mem } = await sb
        .from('org_members')
        .select('role')
        .eq('org_id', org.id)
        .eq('user_id', userId)
        .maybeSingle()
      role = (mem?.role as OrgRole) || 'member'
      return { profile, org, role }
    }
  }

  const { data: existing } = await sb
    .from('organisations')
    .select('*')
    .eq('created_by', userId)
    .limit(1)
    .maybeSingle()
  if (existing) {
    org = existing as Organisation
    if (profile && !profile.org_id) {
      await sb.from('profiles').update({ org_id: existing.id }).eq('id', userId)
      profile = { ...profile, org_id: existing.id }
    }
    role = 'owner'
    return { profile, org, role }
  }

  let orgName = profile?.organisation || 'My Organisation'
  let orgSector: string | null = null
  let orgSize: string | null = null
  const { data: dr } = await sb
    .from('diagnostic_results')
    .select('sector,org_size,organisation')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (dr) {
    orgSector = dr.sector
    orgSize = dr.org_size
    if (dr.organisation) orgName = dr.organisation
  }

  const { data: newOrg, error } = await sb
    .from('organisations')
    .insert({
      name: orgName,
      created_by: userId,
      sector: orgSector,
      org_size: orgSize,
      plan: 'free',
    })
    .select()
    .maybeSingle()
  if (error || !newOrg) {
    console.error('Org creation error:', error)
    return { profile, org: null, role: null }
  }
  await sb.from('org_members').insert({
    org_id: newOrg.id,
    user_id: userId,
    role: 'owner',
    accepted_at: new Date().toISOString(),
  })
  await sb.from('profiles').update({ org_id: newOrg.id }).eq('id', userId)
  profile = profile ? { ...profile, org_id: newOrg.id } : { id: userId, org_id: newOrg.id }
  return { profile, org: newOrg as Organisation, role: 'owner' }
}

export async function consumePendingInvite(): Promise<InviteAcceptResult | null> {
  try {
    const token = readInviteToken()
    if (!token) return null
    return acceptOrgInviteToken(token)
  } catch (e) {
    console.error(e)
    return { ok: false, error: 'Could not accept invitation' }
  }
}

export async function loadOrgContext(
  userId: string,
  email?: string | null,
  userMeta?: Record<string, unknown> | null,
): Promise<OrgContext> {
  await consumePendingInvite()
  const profile = await ensureProfile(userId, email, null, userMeta)
  return ensureOrg(userId, profile)
}
