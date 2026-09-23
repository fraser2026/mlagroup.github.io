/**
 * Auditor portal — token-authenticated read of scoped engagement data.
 * Accepts share (ra_aud_sh_) or API (ra_aud_api_) tokens. Never writes.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/provider-connection.ts'

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function scopesOn(scopes: Record<string, unknown> | null | undefined, key: string): boolean {
  return Boolean(scopes && scopes[key] === true)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  try {
    const body = await req.json().catch(() => ({}))
    const token = String(body.token || req.headers.get('x-reganchor-auditor-token') || '').trim()
    if (!token.startsWith('ra_aud_sh_') && !token.startsWith('ra_aud_api_')) {
      return json({ ok: false, error: 'Valid auditor token required.' }, 401)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    )
    const tokenHash = await sha256Hex(token)
    const { data: tok, error: tokErr } = await supabase
      .from('auditor_tokens')
      .select('*, auditor_engagements(*)')
      .eq('token_hash', tokenHash)
      .maybeSingle()

    if (tokErr || !tok) return json({ ok: false, error: 'Token not recognised.' }, 401)
    if (tok.revoked_at) return json({ ok: false, error: 'This access has been revoked.' }, 403)
    if (new Date(tok.expires_at).getTime() <= Date.now()) {
      return json({ ok: false, error: 'This access has expired.' }, 403)
    }

    const eng = tok.auditor_engagements as Record<string, unknown> | null
    if (!eng || eng.status !== 'active') {
      return json({ ok: false, error: 'Engagement is not active.' }, 403)
    }
    if (new Date(String(eng.window_end)).getTime() <= Date.now()) {
      return json({ ok: false, error: 'Engagement window has ended.' }, 403)
    }
    if (new Date(String(eng.window_start)).getTime() > Date.now()) {
      return json({ ok: false, error: 'Engagement window has not started yet.' }, 403)
    }

    await supabase
      .from('auditor_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', tok.id)

    const orgId = String(eng.org_id)
    const scopes = (eng.scopes || {}) as Record<string, unknown>
    const { data: org } = await supabase.from('organisations').select('id,name').eq('id', orgId).maybeSingle()

    const snapshot: Record<string, unknown> = {
      engagement: {
        id: eng.id,
        name: eng.name,
        firm_name: eng.firm_name,
        window_start: eng.window_start,
        window_end: eng.window_end,
        scopes,
      },
      organisation: { id: org?.id, name: org?.name || 'Organisation' },
      access: { kind: tok.kind, expires_at: tok.expires_at },
    }

    if (scopesOn(scopes, 'assets')) {
      const { data } = await supabase
        .from('ai_systems')
        .select('id,name,provider_slug,lifecycle,risk_tier,system_owner,created_at,updated_at')
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .order('name')
        .limit(500)
      snapshot.assets = data || []
    }

    if (scopesOn(scopes, 'assessments')) {
      const { data } = await supabase
        .from('registry_assessments')
        .select('id,system_id,requested_at,completed_at,status,risk_band,overall_score')
        .eq('org_id', orgId)
        .order('requested_at', { ascending: false })
        .limit(200)
      snapshot.assessments = data || []
    }

    if (scopesOn(scopes, 'policies')) {
      const { data } = await supabase
        .from('policy_documents')
        .select('id,title,version,is_active,updated_at,published_at')
        .eq('org_id', orgId)
        .order('title')
        .limit(200)
      snapshot.policies = data || []
    }

    if (scopesOn(scopes, 'controls')) {
      const { data: assignments } = await supabase
        .from('control_assignments')
        .select('id,control_id,status,due_date,updated_at,system_id')
        .eq('org_id', orgId)
        .order('updated_at', { ascending: false })
        .limit(400)
      snapshot.control_assignments = assignments || []
    }

    if (scopesOn(scopes, 'frameworks')) {
      const { data } = await supabase
        .from('org_frameworks')
        .select('id,name,is_active,source,created_at')
        .eq('org_id', orgId)
        .order('name')
        .limit(100)
      snapshot.frameworks = data || []
    }

    if (scopesOn(scopes, 'evidence')) {
      const { data } = await supabase
        .from('evidence_uploads')
        .select('id,file_name,uploaded_at,control_assignment_id,system_id')
        .eq('org_id', orgId)
        .order('uploaded_at', { ascending: false })
        .limit(300)
      snapshot.evidence = data || []
    }

    if (scopesOn(scopes, 'scores')) {
      const { data } = await supabase
        .from('governance_score_history')
        .select('composite_score,snapshot_at')
        .eq('org_id', orgId)
        .order('snapshot_at', { ascending: false })
        .limit(90)
      snapshot.scores = data || []
    }

    if (scopesOn(scopes, 'activity')) {
      const { data } = await supabase
        .from('registry_audit_log')
        .select('id,action,entity_type,entity_id,created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(100)
      snapshot.activity = data || []
    }

    return json({ ok: true, snapshot })
  } catch (err) {
    console.error('[auditor-portal]', err)
    return json({ ok: false, error: err instanceof Error ? err.message : 'Internal error' }, 500)
  }
})
