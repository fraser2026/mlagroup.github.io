import { sb } from './supabase'

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

export type OrgContext = {
  profile: {
    id: string
    full_name?: string | null
    organisation?: string | null
    org_id?: string | null
    email?: string | null
    paid?: boolean | null
    job_title?: string | null
    department?: string | null
    work_phone?: string | null
  } | null
  org: Organisation | null
  role: OrgRole | null
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

/** Portal-parity profile self-heal (non-privileged fields only). */
export async function ensureProfile(userId: string, email?: string | null) {
  const { data: profile } = await sb
    .from('profiles')
    .select('id,full_name,organisation,org_id,email,paid,job_title,department,work_phone')
    .eq('id', userId)
    .maybeSingle()
  if (profile) return profile
  const { data: created, error } = await sb
    .from('profiles')
    .insert({
      id: userId,
      email: email || null,
      full_name: email?.split('@')[0] || null,
    })
    .select('id,full_name,organisation,org_id,email,paid,job_title,department,work_phone')
    .maybeSingle()
  if (error) {
    const { data: again } = await sb
      .from('profiles')
      .select('id,full_name,organisation,org_id,email,paid,job_title,department,work_phone')
      .eq('id', userId)
      .maybeSingle()
    return again
  }
  return created
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

export async function consumePendingInvite(): Promise<string | null> {
  try {
    const params = new URLSearchParams(window.location.search)
    let token = params.get('invite')
    if (!token) {
      token = localStorage.getItem('ra_invite')
    }
    if (!token) return null
    const { data, error } = await sb.rpc('accept_org_invite', { p_token: token })
    localStorage.removeItem('ra_invite')
    if (error) {
      console.error('accept_org_invite', error)
      return null
    }
    return (data as string) || 'ok'
  } catch (e) {
    console.error(e)
    return null
  }
}

export async function loadOrgContext(userId: string, email?: string | null): Promise<OrgContext> {
  await consumePendingInvite()
  const profile = await ensureProfile(userId, email)
  return ensureOrg(userId, profile)
}
