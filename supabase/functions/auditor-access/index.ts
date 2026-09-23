/**
 * Auditor access admin — create engagements, set scopes, mint/revoke share + API tokens.
 * Professional / Enterprise only. Plaintext tokens returned once on mint.
 */
import {
  assertOrgAdmin,
  corsHeaders,
  getAuthedUser,
  json,
  parseUuid,
  writeAudit,
} from '../_shared/provider-connection.ts'

const DEFAULT_SCOPES: Record<string, boolean> = {
  assets: true,
  assessments: true,
  policies: true,
  controls: true,
  frameworks: true,
  evidence: true,
  scores: true,
  activity: false,
}

const SCOPE_KEYS = Object.keys(DEFAULT_SCOPES)

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function clip(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max)
}

function normalizeScopes(raw: unknown): Record<string, boolean> {
  const out = { ...DEFAULT_SCOPES }
  if (!raw || typeof raw !== 'object') return out
  const obj = raw as Record<string, unknown>
  for (const key of SCOPE_KEYS) {
    if (typeof obj[key] === 'boolean') out[key] = obj[key] as boolean
  }
  return out
}

function publicEngagement(row: Record<string, unknown>, tokens: Record<string, unknown>[] = []) {
  return {
    id: row.id,
    name: row.name,
    firm_name: row.firm_name,
    contact_email: row.contact_email,
    status: row.status,
    window_start: row.window_start,
    window_end: row.window_end,
    scopes: row.scopes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    revoked_at: row.revoked_at,
    completed_at: row.completed_at,
    tokens: tokens.map(publicToken),
  }
}

function publicToken(row: Record<string, unknown>) {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    token_prefix: row.token_prefix,
    expires_at: row.expires_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
    created_at: row.created_at,
  }
}

async function assertAuditorPlan(supabase: Awaited<ReturnType<typeof getAuthedUser>>['supabase'], orgId: string) {
  const { data: org } = await supabase
    .from('organisations')
    .select('id,plan,subscription_status,name')
    .eq('id', orgId)
    .maybeSingle()
  if (!org) throw new Response(JSON.stringify({ ok: false, error: 'Organisation not found.' }), { status: 404, headers: corsHeaders })
  const plan = String(org.plan || '').toLowerCase()
  const status = String(org.subscription_status || '').toLowerCase()
  const allowedPlan = plan === 'professional' || plan === 'enterprise'
  const allowedStatus = status === 'active' || status === 'trialing'
  if (!allowedPlan || !allowedStatus) {
    throw new Response(
      JSON.stringify({
        ok: false,
        error: 'Auditor access is available on Professional and Enterprise plans with an active subscription.',
        code: 'plan_required',
      }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
  return org
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  try {
    const { user, supabase } = await getAuthedUser(req)
    const body = await req.json().catch(() => ({}))
    const action = clip(body.action || 'list', 40).toLowerCase()
    const orgId = parseUuid(body.org_id, 'Organisation')
    await assertOrgAdmin(supabase, user.id, orgId)
    await assertAuditorPlan(supabase, orgId)

    if (action === 'list') {
      const { data: engagements, error } = await supabase
        .from('auditor_engagements')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
      if (error) return json({ ok: false, error: error.message }, 500)
      const ids = (engagements || []).map((e) => e.id)
      let tokensByEng: Record<string, Record<string, unknown>[]> = {}
      if (ids.length) {
        const { data: tokens } = await supabase
          .from('auditor_tokens')
          .select('id,engagement_id,kind,label,token_prefix,expires_at,last_used_at,revoked_at,created_at')
          .in('engagement_id', ids)
          .order('created_at', { ascending: false })
        for (const t of tokens || []) {
          const eid = String(t.engagement_id)
          if (!tokensByEng[eid]) tokensByEng[eid] = []
          tokensByEng[eid].push(t)
        }
      }
      return json({
        ok: true,
        scopes_catalog: SCOPE_KEYS.map((key) => ({
          key,
          label: scopeLabel(key),
          description: scopeDescription(key),
          default: DEFAULT_SCOPES[key],
        })),
        engagements: (engagements || []).map((e) => publicEngagement(e, tokensByEng[e.id] || [])),
      })
    }

    if (action === 'create') {
      const name = clip(body.name, 120)
      if (!name) return json({ ok: false, error: 'Engagement name is required.' }, 400)
      const firm = clip(body.firm_name, 160) || null
      const email = clip(body.contact_email, 254).toLowerCase() || null
      const scopes = normalizeScopes(body.scopes)
      const days = Math.min(180, Math.max(1, Number(body.duration_days) || 30))
      const windowStart = new Date()
      const windowEnd = new Date(windowStart.getTime() + days * 24 * 60 * 60 * 1000)
      const { data, error } = await supabase
        .from('auditor_engagements')
        .insert({
          org_id: orgId,
          name,
          firm_name: firm,
          contact_email: email,
          status: 'active',
          window_start: windowStart.toISOString(),
          window_end: windowEnd.toISOString(),
          scopes,
          created_by: user.id,
        })
        .select('*')
        .single()
      if (error || !data) return json({ ok: false, error: error?.message || 'Could not create engagement.' }, 500)

      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: 'auditor_engagement_created',
        entity_type: 'auditor_engagement',
        entity_id: data.id,
        changes: { name, firm_name: firm, scopes, window_end: data.window_end },
      })

      // Auto-mint share token for convenience
      const minted = await mintToken(supabase, {
        orgId,
        engagementId: data.id,
        kind: 'share',
        label: 'Share link',
        expiresAt: data.window_end,
        userId: user.id,
      })
      if ('error' in minted) return json({ ok: false, error: minted.error }, 500)

      return json({
        ok: true,
        engagement: publicEngagement(data, [minted.record]),
        share_token: minted.token,
        show_once: true,
      }, 201)
    }

    if (action === 'update_scopes') {
      const engagementId = parseUuid(body.engagement_id, 'Engagement')
      const scopes = normalizeScopes(body.scopes)
      const { data, error } = await supabase
        .from('auditor_engagements')
        .update({ scopes, updated_at: new Date().toISOString() })
        .eq('id', engagementId)
        .eq('org_id', orgId)
        .select('*')
        .single()
      if (error || !data) return json({ ok: false, error: error?.message || 'Could not update scopes.' }, 500)
      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: 'auditor_scopes_updated',
        entity_type: 'auditor_engagement',
        entity_id: engagementId,
        changes: { scopes },
      })
      return json({ ok: true, engagement: publicEngagement(data) })
    }

    if (action === 'complete' || action === 'revoke_engagement') {
      const engagementId = parseUuid(body.engagement_id, 'Engagement')
      const now = new Date().toISOString()
      const status = action === 'complete' ? 'completed' : 'revoked'
      const patch: Record<string, unknown> = {
        status,
        updated_at: now,
        ...(action === 'complete' ? { completed_at: now } : { revoked_at: now }),
      }
      const { data, error } = await supabase
        .from('auditor_engagements')
        .update(patch)
        .eq('id', engagementId)
        .eq('org_id', orgId)
        .select('*')
        .single()
      if (error || !data) return json({ ok: false, error: error?.message || 'Could not update engagement.' }, 500)
      await supabase
        .from('auditor_tokens')
        .update({ revoked_at: now })
        .eq('engagement_id', engagementId)
        .is('revoked_at', null)
      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: action === 'complete' ? 'auditor_engagement_completed' : 'auditor_engagement_revoked',
        entity_type: 'auditor_engagement',
        entity_id: engagementId,
        changes: { status },
      })
      return json({ ok: true, engagement: publicEngagement(data) })
    }

    if (action === 'mint_token') {
      const engagementId = parseUuid(body.engagement_id, 'Engagement')
      const kind = clip(body.kind, 10).toLowerCase()
      if (kind !== 'share' && kind !== 'api') return json({ ok: false, error: 'Token kind must be share or api.' }, 400)
      const { data: eng } = await supabase
        .from('auditor_engagements')
        .select('*')
        .eq('id', engagementId)
        .eq('org_id', orgId)
        .maybeSingle()
      if (!eng) return json({ ok: false, error: 'Engagement not found.' }, 404)
      if (eng.status !== 'active') return json({ ok: false, error: 'Engagement is not active.' }, 400)
      if (new Date(eng.window_end).getTime() <= Date.now()) {
        return json({ ok: false, error: 'Engagement window has ended. Extend or create a new engagement.' }, 400)
      }
      const label = clip(body.label, 80) || (kind === 'api' ? 'Auditor API key' : 'Share link')
      const minted = await mintToken(supabase, {
        orgId,
        engagementId,
        kind: kind as 'share' | 'api',
        label,
        expiresAt: eng.window_end,
        userId: user.id,
      })
      if ('error' in minted) return json({ ok: false, error: minted.error }, 500)
      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: 'auditor_token_minted',
        entity_type: 'auditor_engagement',
        entity_id: engagementId,
        changes: { kind, token_id: minted.record.id, label },
      })
      return json({ ok: true, token: minted.token, token_record: publicToken(minted.record), show_once: true }, 201)
    }

    if (action === 'revoke_token') {
      const tokenId = parseUuid(body.token_id, 'Token')
      const now = new Date().toISOString()
      const { data, error } = await supabase
        .from('auditor_tokens')
        .update({ revoked_at: now })
        .eq('id', tokenId)
        .eq('org_id', orgId)
        .is('revoked_at', null)
        .select('*')
        .maybeSingle()
      if (error) return json({ ok: false, error: error.message }, 500)
      if (!data) return json({ ok: false, error: 'Token not found or already revoked.' }, 404)
      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: 'auditor_token_revoked',
        entity_type: 'auditor_engagement',
        entity_id: data.engagement_id,
        changes: { token_id: tokenId, kind: data.kind },
      })
      return json({ ok: true, token_record: publicToken(data) })
    }

    return json({ ok: false, error: 'Unknown action.' }, 400)
  } catch (err) {
    if (err instanceof Response) return err
    console.error('[auditor-access]', err)
    return json({ ok: false, error: err instanceof Error ? err.message : 'Internal error' }, 500)
  }
})

function scopeLabel(key: string): string {
  const map: Record<string, string> = {
    assets: 'AI asset registry',
    assessments: 'Assessments',
    policies: 'Policies',
    controls: 'Controls',
    frameworks: 'Frameworks',
    evidence: 'Evidence files',
    scores: 'Governance scores',
    activity: 'Activity log',
  }
  return map[key] || key
}

function scopeDescription(key: string): string {
  const map: Record<string, string> = {
    assets: 'Inventory of AI systems and agents (names, owners, risk, lifecycle).',
    assessments: 'Assessment history and outcomes for in-scope assets.',
    policies: 'Published policies and acknowledgement status summaries.',
    controls: 'Control catalogue and assignment status.',
    frameworks: 'Framework mappings attached to your programme.',
    evidence: 'Uploaded evidence metadata linked to controls (not write access).',
    scores: 'Composite governance score history snapshots.',
    activity: 'Selected registry audit events (no secrets or credentials).',
  }
  return map[key] || ''
}

async function mintToken(
  supabase: Awaited<ReturnType<typeof getAuthedUser>>['supabase'],
  opts: {
    orgId: string
    engagementId: string
    kind: 'share' | 'api'
    label: string
    expiresAt: string
    userId: string
  },
): Promise<{ token: string; record: Record<string, unknown> } | { error: string }> {
  const { count } = await supabase
    .from('auditor_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('engagement_id', opts.engagementId)
    .eq('kind', opts.kind)
    .is('revoked_at', null)
  if ((count || 0) >= 5) {
    return { error: `Revoke an existing ${opts.kind} token before minting another (max 5 active).` }
  }
  const random = new Uint8Array(32)
  crypto.getRandomValues(random)
  const prefix = opts.kind === 'api' ? 'ra_aud_api_' : 'ra_aud_sh_'
  const token = `${prefix}${base64Url(random)}`
  const tokenHash = await sha256Hex(token)
  const tokenPrefix = token.slice(0, 14)
  const { data, error } = await supabase
    .from('auditor_tokens')
    .insert({
      engagement_id: opts.engagementId,
      org_id: opts.orgId,
      kind: opts.kind,
      label: opts.label,
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
      expires_at: opts.expiresAt,
      created_by: opts.userId,
    })
    .select('id,kind,label,token_prefix,expires_at,last_used_at,revoked_at,created_at,engagement_id')
    .single()
  if (error || !data) return { error: error?.message || 'Could not mint token.' }
  return { token, record: data }
}
