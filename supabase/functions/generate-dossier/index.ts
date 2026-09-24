/**
 * RegAnchor — Governance dossier PDF
 *
 * Assembles one point-in-time org governance snapshot from Supabase (existing
 * tables only), mints a PDF via Puppeteer (`POST /render-dossier`), uploads to
 * Storage, and returns a signed download URL.
 *
 * Gate: signed-in org owner/admin on Professional or Enterprise with
 * active/trialing subscription (same commercial door as auditor access).
 *
 * DEPLOY:
 *   supabase functions deploy generate-dossier --project-ref hueftewwenjaiagdoqmb
 * Do NOT pass --no-verify-jwt. config.toml sets verify_jwt = true.
 *
 * RENDERER: redeploy mla-pdf-service with dossier-template.html + /render-dossier.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RENDERER_URL = Deno.env.get('RENDER_SERVICE_URL')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FRAMEWORK_LABELS: Record<string, string> = {
  eu_ai_act: 'EU AI Act',
  uk_gdpr: 'UK GDPR',
  fca: 'FCA expectations',
}

const ACTIVITY_KEEP = new Set([
  'system_created',
  'system_updated',
  'risk_tier_changed',
  'control_assigned',
  'control_updated',
  'control_implemented',
  'assessment_submitted',
  'assessment_requested',
  'policy_adopted',
  'policy_acknowledged',
  'policy_esigned',
  'compliance_status_updated',
])

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function asOne<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? v[0] || null : v
}

function maturityLabel(score: number) {
  if (score >= 85) return 'Operational'
  if (score >= 65) return 'Managed'
  if (score >= 40) return 'Developing'
  if (score > 0) return 'Initial'
  return 'Unscored'
}

function maturityLayers(scoreRow: Record<string, unknown> | null, controlsDone: number, controlsTotal: number) {
  if (scoreRow) {
    return [
      { key: 'organisation', label: 'Organisation', score: Number(scoreRow.org_layer_score) || 0 },
      { key: 'assets', label: 'AI assets', score: Number(scoreRow.system_layer_score) || 0 },
      { key: 'assurance', label: 'Assurance', score: Number(scoreRow.assurance_layer_score) || 0 },
    ]
  }
  const fallback = controlsTotal ? Math.round((100 * controlsDone) / controlsTotal) : 0
  return [
    { key: 'organisation', label: 'Organisation', score: fallback },
    { key: 'assets', label: 'AI assets', score: fallback },
    { key: 'assurance', label: 'Assurance', score: fallback },
  ]
}

function riskBuckets(assets: Array<{ risk_tier?: string | null }>) {
  const map = new Map<string, number>()
  for (const a of assets) {
    const t = String(a.risk_tier || '').toLowerCase()
    let label = 'Unclassified'
    if (t === 'high' || t === 'unacceptable') label = 'High'
    else if (t === 'limited') label = 'Limited'
    else if (t === 'minimal') label = 'Minimal'
    map.set(label, (map.get(label) || 0) + 1)
  }
  return ['High', 'Limited', 'Minimal', 'Unclassified']
    .filter((k) => map.has(k))
    .map((k) => ({ key: k.toLowerCase(), label: k, count: map.get(k) || 0 }))
}

function isDoneStatus(status: unknown) {
  return /^(implemented|verified)$/i.test(String(status || ''))
}

function isInProgressStatus(status: unknown) {
  return /^in_progress$/i.test(String(status || ''))
}

function isOutstandingStatus(status: unknown) {
  const s = String(status || '').toLowerCase()
  return !s || s === 'not_started' || s === 'overdue'
}

async function sha16(payload: unknown) {
  const hex = await sha256Hex(payload)
  return hex.slice(0, 16)
}

async function sha256Hex(payload: unknown) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function sanitizeSignatureSvg(raw: unknown): string | null {
  const s = String(raw || '').trim()
  if (!s.startsWith('<svg') || !s.endsWith('</svg>')) return null
  if (s.length > 80_000) return null
  if (/<script|on\w+\s*=|javascript:|data:/i.test(s)) return null
  return s
}

const DOSSIER_DECLARATION =
  'I confirm that I have reviewed this dossier and approve it as presented.'

const EVENT_LABELS: Record<string, string> = {
  generated: 'Version generated',
  viewed: 'Dossier viewed',
  signed: 'Signed',
  finalised: 'Signed PDF sealed',
  downloaded: 'Downloaded',
}

function requestMeta(req: Request) {
  const fwd = req.headers.get('x-forwarded-for') || ''
  return {
    ip: req.headers.get('cf-connecting-ip') || fwd.split(',')[0].trim() || null,
    userAgent: req.headers.get('user-agent') || null,
  }
}

type Actor = { id: string; name: string | null; email: string | null }

// deno-lint-ignore no-explicit-any
async function recordEvent(supabase: any, input: {
  versionId: string
  orgId: string
  type: 'generated' | 'viewed' | 'signed' | 'finalised' | 'downloaded'
  actor: Actor
  req: Request
  metadata?: Record<string, unknown>
  occurredAt?: string
}) {
  const meta = requestMeta(input.req)
  const { error } = await supabase.from('governance_dossier_events').insert({
    dossier_version_id: input.versionId,
    org_id: input.orgId,
    event_type: input.type,
    actor_user_id: input.actor.id,
    actor_name: input.actor.name,
    actor_email: input.actor.email,
    ip_address: meta.ip,
    user_agent: meta.userAgent,
    metadata: input.metadata || {},
    occurred_at: input.occurredAt || new Date().toISOString(),
  })
  if (error) console.error('[generate-dossier] audit event failed', input.type, error.message)
}

function buildObservations(input: {
  assets: Array<Record<string, unknown>>
  controls: Array<Record<string, unknown>>
  assessments: Array<Record<string, unknown>>
  evidence: Array<Record<string, unknown>>
  policies: Array<Record<string, unknown>>
  counts: Record<string, number>
  score: number
  posture: string
}) {
  const out: string[] = []
  const highRisk = input.assets.filter((a) => {
    const t = String(a.risk_tier || '').toLowerCase()
    return t === 'high' || t === 'unacceptable'
  })
  if (highRisk.length) {
    const names = highRisk.map((a) => String(a.name || 'Unnamed asset')).join(', ')
    out.push(
      `${highRisk.length} high-risk AI asset${highRisk.length === 1 ? ' is' : 's are'} currently in scope${
        names ? ` (${names})` : ''
      }.`,
    )
  }

  const withoutEvidence = input.controls.filter(
    (c) => isDoneStatus(c.status) && !(Array.isArray(c.evidence_provided) && c.evidence_provided.length),
  )
  if (withoutEvidence.length) {
    out.push(
      `${withoutEvidence.length} implemented control${withoutEvidence.length === 1 ? ' has' : 's have'} no supporting evidence recorded.`,
    )
  }

  const outstanding = input.controls.filter((c) => isOutstandingStatus(c.status))
  if (outstanding.length) {
    const withDue = outstanding
      .filter((c) => c.due_date)
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
    const soonest = withDue[0]
    if (outstanding.length === 1 && soonest?.due_date) {
      const due = new Date(String(soonest.due_date))
      const dueLabel = Number.isNaN(due.getTime())
        ? String(soonest.due_date)
        : due.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      out.push(`1 control assignment remains outstanding, with remediation due ${dueLabel}.`)
    } else if (withDue.length) {
      out.push(
        `${outstanding.length} control assignments remain outstanding; earliest remediation due ${
          new Date(String(withDue[0].due_date)).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })
        }.`,
      )
    } else {
      out.push(
        `${outstanding.length} control assignment${outstanding.length === 1 ? '' : 's'} remain outstanding.`,
      )
    }
  }

  const inProgress = input.controls.filter((c) => isInProgressStatus(c.status))
  if (inProgress.length) {
    out.push(`${inProgress.length} control assignment${inProgress.length === 1 ? ' is' : 's are'} in progress.`)
  }

  const dueSoon = input.controls.filter((c) => {
    if (!c.due_date || isDoneStatus(c.status)) return false
    const due = new Date(String(c.due_date)).getTime()
    if (Number.isNaN(due)) return false
    const days = (due - Date.now()) / (24 * 60 * 60 * 1000)
    return days >= 0 && days <= 30
  })
  if (dueSoon.length && outstanding.length !== dueSoon.length) {
    out.push(`${dueSoon.length} open control assignment${dueSoon.length === 1 ? '' : 's'} due within 30 days.`)
  }

  const weakAssess = input.assessments.filter((a) => {
    const band = String(a.risk_band || '').toLowerCase()
    const score = Number(a.overall_score)
    return band === 'high' || band === 'unacceptable' || (Number.isFinite(score) && score > 0 && score < 40)
  })
  if (weakAssess.length) {
    out.push(
      `${weakAssess.length} assessment${weakAssess.length === 1 ? '' : 's'} show elevated risk or a low overall score.`,
    )
  }

  const openAssess = input.assessments.filter((a) => {
    const s = String(a.status || '').toLowerCase()
    return s === 'submitted' || s === 'in_review'
  })
  if (openAssess.length) {
    out.push(`${openAssess.length} assessment${openAssess.length === 1 ? '' : 's'} still awaiting completion or review.`)
  }

  if (input.counts.evidence === 0 && input.counts.controls > 0) {
    out.push('No evidence files are uploaded for this organisation yet.')
  }

  const activePolicies = input.policies.filter((p) => p.is_active)
  if (activePolicies.length >= 3 && input.counts.controls_done > 0) {
    out.push(
      `${activePolicies.length} active policies and ${input.counts.controls_done} implemented control assignments form the current governance baseline.`,
    )
  }

  if (!out.length && input.score > 0) {
    out.push(
      `Governance posture is recorded as ${input.posture} (${input.score}/100) across ${input.counts.assets} AI asset${
        input.counts.assets === 1 ? '' : 's'
      } and ${input.counts.controls} control assignment${input.counts.controls === 1 ? '' : 's'}.`,
    )
  }

  return out.slice(0, 8)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return json({ error: 'Authentication required' }, 401)
    }
    const token = authHeader.slice(7).trim()
    if (!token) return json({ error: 'Authentication required' }, 401)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token)
    if (authError || !user) return json({ error: 'Authentication required' }, 401)

    const body = await req.json().catch(() => ({}))
    const action = String(body?.action || 'assemble').trim().toLowerCase()
    let orgId = String(body?.org_id || '').trim()

    if (!orgId) {
      const { data: profile } = await supabase.from('profiles').select('org_id').eq('id', user.id).maybeSingle()
      orgId = String(profile?.org_id || '').trim()
    }
    if (!orgId) return json({ error: 'No organisation on this account' }, 400)

    const { data: membership } = await supabase
      .from('org_members')
      .select('role')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .maybeSingle()

    const role = String(membership?.role || '').toLowerCase()
    if (role !== 'owner' && role !== 'admin') {
      return json({ error: 'Only organisation owners and admins can export the governance dossier' }, 403)
    }

    const { data: org, error: orgErr } = await supabase
      .from('organisations')
      .select('id,name,sector,org_size,plan,subscription_status')
      .eq('id', orgId)
      .maybeSingle()

    if (orgErr || !org) return json({ error: 'Organisation not found' }, 404)

    const plan = String(org.plan || '').toLowerCase()
    const sub = String(org.subscription_status || '').toLowerCase()
    const planOk = plan === 'professional' || plan === 'enterprise'
    const subOk = sub === 'active' || sub === 'trialing'
    if (!planOk || !subOk) {
      return json(
        {
          error: 'Governance dossier export requires an active Professional or Enterprise plan',
          code: 'plan_required',
        },
        403,
      )
    }

    const { data: actorProfile } = await supabase
      .from('profiles')
      .select('full_name,email')
      .eq('id', user.id)
      .maybeSingle()
    const actor: Actor = {
      id: user.id,
      name: actorProfile?.full_name || null,
      email: actorProfile?.email || user.email || null,
    }

    if (action === 'record_view') {
      const versionId = String(body?.version_id || '').trim()
      if (!versionId) return json({ error: 'version_id is required' }, 400)
      const { data: version } = await supabase
        .from('governance_dossiers')
        .select('id,dossier_code,snapshot_hash,status')
        .eq('id', versionId)
        .eq('org_id', orgId)
        .maybeSingle()
      if (!version) return json({ error: 'Dossier version not found' }, 404)
      await recordEvent(supabase, {
        versionId: version.id,
        orgId,
        type: 'viewed',
        actor,
        req,
        metadata: { dossier_code: version.dossier_code, snapshot_hash: version.snapshot_hash, status: version.status },
      })
      return json({ success: true })
    }

    if (action === 'list') {
      const { data: rows, error: listErr } = await supabase
        .from('governance_dossiers')
        .select('id,dossier_code,snapshot_hash,signed_at,signature_id')
        .eq('org_id', orgId)
        .eq('status', 'signed')
        .order('signed_at', { ascending: false })
        .limit(50)
      if (listErr) throw new Error('Could not load signed dossiers')
      const sigIds = (rows || []).map((r) => r.signature_id).filter(Boolean)
      const sigMap = new Map<string, { signatory_name: string | null; signatory_role: string | null }>()
      if (sigIds.length) {
        const { data: sigs } = await supabase
          .from('e_signatures')
          .select('id,signatory_name,signatory_role')
          .in('id', sigIds)
        for (const s of sigs || []) sigMap.set(s.id, s)
      }
      return json({
        success: true,
        dossiers: (rows || []).map((r) => {
          const sig = r.signature_id ? sigMap.get(r.signature_id) : null
          return {
            version_id: r.id,
            dossier_id: r.dossier_code,
            snapshot_hash: r.snapshot_hash,
            signed_at: r.signed_at,
            signer: sig ? { name: sig.signatory_name, role: sig.signatory_role } : null,
          }
        }),
      })
    }

    if (action === 'audit') {
      const versionId = String(body?.version_id || '').trim()
      if (!versionId) return json({ error: 'version_id is required' }, 400)
      const { data: version } = await supabase
        .from('governance_dossiers')
        .select('id,dossier_code,snapshot_hash,content_hash,status,created_at,signed_at,signature_id')
        .eq('id', versionId)
        .eq('org_id', orgId)
        .maybeSingle()
      if (!version) return json({ error: 'Dossier version not found' }, 404)

      let signature: Record<string, unknown> | null = null
      if (version.signature_id) {
        const { data: sig } = await supabase
          .from('e_signatures')
          .select('id,signatory_name,signatory_email,signatory_role,declaration_text,content_hash,ip_address,user_agent,signed_at')
          .eq('id', version.signature_id)
          .maybeSingle()
        signature = sig || null
      }

      const { data: events } = await supabase
        .from('governance_dossier_events')
        .select('id,event_type,actor_name,actor_email,ip_address,user_agent,metadata,occurred_at')
        .eq('dossier_version_id', version.id)
        .order('occurred_at', { ascending: true })

      return json({
        success: true,
        version: {
          version_id: version.id,
          dossier_id: version.dossier_code,
          snapshot_hash: version.snapshot_hash,
          content_hash: version.content_hash,
          status: version.status,
          created_at: version.created_at,
          signed_at: version.signed_at,
        },
        signature,
        events: events || [],
      })
    }

    if (action === 'status' || action === 'download') {
      const requestedVersion = String(body?.version_id || '').trim()
      const baseQuery = supabase
        .from('governance_dossiers')
        .select(
          'id,dossier_code,snapshot_hash,catalogue_hash,status,signed_at,reviewed_at,created_at,signed_storage_path,unsigned_storage_path,signature_id',
        )
        .eq('org_id', orgId)
      const { data: latest } = requestedVersion
        ? await baseQuery.eq('id', requestedVersion).maybeSingle()
        : await baseQuery.order('created_at', { ascending: false }).limit(1).maybeSingle()

      if (!latest) {
        return json({ success: true, dossier: null })
      }

      if (action === 'download') {
        const storagePath =
          latest.status === 'signed'
            ? latest.signed_storage_path
            : latest.unsigned_storage_path
        if (!storagePath) {
          return json({ error: 'No dossier PDF is available to download yet' }, 404)
        }
        const { data: urlData } = await supabase.storage
          .from('governance-reports')
          .createSignedUrl(storagePath, 60 * 60 * 24 * 7)
        await recordEvent(supabase, {
          versionId: latest.id,
          orgId,
          type: 'downloaded',
          actor,
          req,
          metadata: { dossier_code: latest.dossier_code, status: latest.status, file: storagePath.split('/').pop() },
        })
        return json({
          success: true,
          dossier_id: latest.dossier_code,
          version_id: latest.id,
          status: latest.status,
          download_url: urlData?.signedUrl || null,
        })
      }

      let signer: { name?: string; role?: string } | null = null
      if (latest.signature_id) {
        const { data: sig } = await supabase
          .from('e_signatures')
          .select('signatory_name,signatory_role')
          .eq('id', latest.signature_id)
          .maybeSingle()
        if (sig) {
          signer = {
            name: sig.signatory_name || undefined,
            role: sig.signatory_role || undefined,
          }
        }
      }

      return json({
        success: true,
        dossier: {
          version_id: latest.id,
          dossier_id: latest.dossier_code,
          snapshot_hash: latest.snapshot_hash,
          catalogue_hash: latest.catalogue_hash,
          status: latest.status,
          signed_at: latest.signed_at,
          reviewed_at: latest.reviewed_at,
          created_at: latest.created_at,
          signer,
        },
      })
    }

    // Single parallel fetch — one point-in-time snapshot
    const [
      assetsRes,
      assessRes,
      policiesRes,
      frameworksRes,
      frameworkControlsRes,
      controlsRes,
      evidenceRes,
      activityRes,
      membersRes,
      scoreRes,
      connectionsRes,
    ] = await Promise.all([
      supabase
        .from('ai_systems')
        .select(
          'id,name,description,vendor,provider_slug,model_name,lifecycle,department,system_owner,business_owner_id,compliance_owner_id,technical_owner_id,purpose_category,risk_tier,created_at,updated_at',
        )
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .order('name')
        .limit(500),
      supabase
        .from('registry_assessments')
        .select('id,system_id,requested_at,completed_at,status,risk_band,overall_score')
        .eq('org_id', orgId)
        .order('requested_at', { ascending: false })
        .limit(200),
      supabase
        .from('policy_documents')
        .select(
          'id,title,version,category,is_active,updated_at,published_at,linked_control_id,document_file_name',
        )
        .eq('org_id', orgId)
        .order('title')
        .limit(200),
      supabase
        .from('org_frameworks')
        .select('id,name,description,is_active,source,created_at')
        .eq('org_id', orgId)
        .order('name')
        .limit(100),
      supabase
        .from('org_framework_controls')
        .select('id,framework_id,title,description,category,status,mapped_control_id,display_order')
        .eq('org_id', orgId)
        .order('display_order')
        .limit(400),
      supabase
        .from('control_assignments')
        .select(
          'id,status,due_date,priority,assigned_to,assigned_at,updated_at,system_id,control_id,notes,governance_controls(id,title,control_number,control_type,pillar,description,purpose,evidence_types,is_org_level),ai_systems(name)',
        )
        .eq('org_id', orgId)
        .order('updated_at', { ascending: false })
        .limit(400),
      supabase
        .from('evidence_uploads')
        .select('id,file_name,file_type,description,uploaded_at,control_assignment_id,system_id')
        .eq('org_id', orgId)
        .order('uploaded_at', { ascending: false })
        .limit(300),
      supabase
        .from('registry_audit_log')
        .select('id,action,entity_type,entity_id,created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('org_members').select('user_id,role').eq('org_id', orgId).limit(50),
      supabase
        .from('governance_score_history')
        .select('composite_score,org_layer_score,system_layer_score,assurance_layer_score,snapshot_at')
        .eq('org_id', orgId)
        .is('system_id', null)
        .order('snapshot_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('provider_connections')
        .select('asset_id,status')
        .eq('org_id', orgId)
        .neq('status', 'revoked'),
    ])

    const connByAsset = new Map<string, string>()
    for (const c of connectionsRes.data || []) {
      const assetId = c.asset_id as string | null
      if (!assetId) continue
      if (!connByAsset.has(assetId)) connByAsset.set(assetId, (c.status as string) || 'pending')
      if (c.status === 'connected') connByAsset.set(assetId, 'connected')
    }

    const assets = (assetsRes.data || []).map((a) => ({
      ...a,
      connection_status: connByAsset.get(a.id as string) || null,
    }))
    const assetNames = new Map(assets.map((a) => [a.id, a.name || 'AI asset']))
    const assetIds = new Set(assets.map((a) => a.id))
    const assetIdList = assets.map((a) => a.id)

    // Methodology catalogue (Control Centre SoT) — hashed separately from org snapshot.
    const [catalogueControlsRes, catalogueFrameworksRes, catalogueMapsRes] = await Promise.all([
      supabase
        .from('governance_controls')
        .select(
          'id,control_number,title,description,purpose,control_type,pillar,is_org_level,evidence_types,trigger_rules,display_order,is_active',
        )
        .order('control_number'),
      supabase
        .from('compliance_frameworks')
        .select(
          'id,framework,obligation_key,obligation_title,obligation_description,guidance_text,article_reference,display_order,is_active',
        )
        .order('framework')
        .order('display_order'),
      supabase
        .from('control_requirement_map')
        .select(
          'id,control_id,obligation_id,requirement_id,is_primary,source_citation,interpretation_note,display_order,is_active',
        )
        .eq('is_active', true)
        .order('display_order'),
    ])

    const catalogueControls = [...(catalogueControlsRes.data || [])].sort((a, b) =>
      String(a.id).localeCompare(String(b.id)),
    )
    const catalogueFrameworks = [...(catalogueFrameworksRes.data || [])].sort((a, b) =>
      String(a.id).localeCompare(String(b.id)),
    )
    const catalogueMaps = [...(catalogueMapsRes.data || [])].sort((a, b) =>
      String(a.id).localeCompare(String(b.id)),
    )
    const catalogueHash = await sha16({
      version: 1,
      controls: catalogueControls,
      frameworks: catalogueFrameworks,
      maps: catalogueMaps,
    })

    const { data: currentMethodology } = await supabase
      .from('methodology_versions')
      .select('id,version_label,catalogue_hash,published_at')
      .eq('is_current', true)
      .maybeSingle()

    const obligationMetaById = new Map(
      catalogueFrameworks.map((cf) => [
        String(cf.id),
        {
          id: String(cf.id),
          framework: String(cf.framework || ''),
          framework_label: FRAMEWORK_LABELS[String(cf.framework || '')] || String(cf.framework || '').replace(/_/g, ' '),
          obligation_title: String(cf.obligation_title || 'Obligation'),
          article_reference: cf.article_reference ? String(cf.article_reference) : null,
        },
      ]),
    )

    const mapsByControlId = new Map<string, typeof catalogueMaps>()
    for (const m of catalogueMaps) {
      const key = String(m.control_id || '')
      if (!key) continue
      const list = mapsByControlId.get(key) || []
      list.push(m)
      mapsByControlId.set(key, list)
    }

    // system_compliance has no org_id — scope via this org's AI assets.
    // Join obligations in process (no guaranteed PostgREST embed).
    let complianceRows: Array<{
      system_id: string
      obligation_id: string
      status: string | null
    }> = []
    const obligationById = new Map<
      string,
      {
        id: string
        framework: string
        obligation_title: string
        obligation_description: string | null
        article_reference: string | null
        is_active: boolean | null
      }
    >()

    if (assetIdList.length) {
      const [{ data: scData }, { data: cfData }] = await Promise.all([
        supabase
          .from('system_compliance')
          .select('system_id,obligation_id,status')
          .in('system_id', assetIdList)
          .limit(2000),
        supabase
          .from('compliance_frameworks')
          .select('id,framework,obligation_title,obligation_description,article_reference,is_active')
          .eq('is_active', true)
          .limit(500),
      ])
      complianceRows = (scData || []) as typeof complianceRows
      for (const cf of cfData || []) {
        obligationById.set(String(cf.id), {
          id: String(cf.id),
          framework: String(cf.framework || ''),
          obligation_title: String(cf.obligation_title || 'Obligation'),
          obligation_description: cf.obligation_description ? String(cf.obligation_description) : null,
          article_reference: cf.article_reference ? String(cf.article_reference) : null,
          is_active: cf.is_active,
        })
      }
    }

    const memberIds = (membersRes.data || []).map((m) => m.user_id).filter(Boolean)
    const assigneeIds = (controlsRes.data || [])
      .map((r: Record<string, unknown>) => r.assigned_to)
      .filter(Boolean) as string[]
    const ownerIds = assets.flatMap((a) =>
      [a.business_owner_id, a.compliance_owner_id, a.technical_owner_id].filter(Boolean),
    ) as string[]
    const profileIds = [...new Set([...memberIds, ...assigneeIds, ...ownerIds])]

    let profiles: Array<{
      id: string
      full_name?: string | null
      email?: string | null
      job_title?: string | null
      department?: string | null
    }> = []
    if (profileIds.length) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id,full_name,email,job_title,department')
        .in('id', profileIds)
      profiles = profs || []
    }
    const profileMap = new Map(profiles.map((p) => [p.id, p]))

    function personName(id: unknown) {
      if (!id) return null
      const p = profileMap.get(String(id))
      return p?.full_name || p?.email || null
    }

    const assetsWithOwners = assets.map((a) => ({
      ...a,
      business_owner_name: personName(a.business_owner_id) || (a.system_owner ? String(a.system_owner) : null),
      compliance_owner_name: personName(a.compliance_owner_id),
      technical_owner_name: personName(a.technical_owner_id),
    }))

    const members = (membersRes.data || []).map((m) => {
      const p = profileMap.get(m.user_id)
      const role = String(m.role || '')
      const roleLabel =
        role === 'owner' ? 'Workspace admin' : role ? role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : null
      return {
        user_id: m.user_id,
        role,
        role_label: roleLabel,
        full_name: p?.full_name || null,
        // Names only in accountability; emails omitted from dossier export
      }
    })

    const evidenceRaw = evidenceRes.data || []
    const evidenceByAssignment = new Map<string, typeof evidenceRaw>()
    for (const e of evidenceRaw) {
      const key = String(e.control_assignment_id || '')
      if (!key) continue
      const list = evidenceByAssignment.get(key) || []
      list.push(e)
      evidenceByAssignment.set(key, list)
    }

    const controlDefs = new Map<string, Record<string, unknown>>()
    const controls = (controlsRes.data || []).map((row: Record<string, unknown>) => {
      const gc = asOne(row.governance_controls as Record<string, unknown> | Record<string, unknown>[] | null) || {}
      const sys = asOne(row.ai_systems as Record<string, unknown> | Record<string, unknown>[] | null) || {}
      if (gc.id) controlDefs.set(String(gc.id), gc)

      const assignee = row.assigned_to ? profileMap.get(String(row.assigned_to)) : null
      const provided = (evidenceByAssignment.get(String(row.id)) || []).map((e) => ({
        id: e.id,
        file_name: e.file_name,
        uploaded_at: e.uploaded_at,
        file_type: e.file_type || null,
      }))

      let suggested: string[] = []
      const et = gc.evidence_types
      if (Array.isArray(et)) suggested = et.map((v) => String(v))
      else if (typeof et === 'string') {
        try {
          const parsed = JSON.parse(et)
          if (Array.isArray(parsed)) suggested = parsed.map((v) => String(v))
        } catch {
          /* ignore */
        }
      }

      return {
        id: row.id,
        status: row.status,
        due_date: row.due_date,
        priority: row.priority || null,
        system_id: row.system_id,
        asset_name: sys.name || assetNames.get(String(row.system_id || '')) || null,
        control_id: row.control_id || gc.id || null,
        title: gc.title || null,
        control_number: gc.control_number ?? null,
        control_type: gc.control_type || null,
        pillar: gc.pillar || null,
        description: gc.description || null,
        purpose: gc.purpose || null,
        is_org_level: Boolean(gc.is_org_level),
        suggested_evidence: suggested,
        evidence_provided: provided,
        evidence_count: provided.length,
        owner_name: assignee?.full_name || null,
        assigned_at: row.assigned_at || null,
        updated_at: row.updated_at || null,
      }
    })

    const policies = (policiesRes.data || []).map((p) => {
      const linked = p.linked_control_id ? controlDefs.get(String(p.linked_control_id)) : null
      return {
        id: p.id,
        title: p.title,
        version: p.version,
        category: p.category,
        is_active: p.is_active,
        updated_at: p.updated_at,
        published_at: p.published_at,
        document_file_name: p.document_file_name,
        linked_control_id: p.linked_control_id,
        linked_control_title: linked?.title ? String(linked.title) : null,
        linked_control_number: linked?.control_number ?? null,
      }
    })

    // Built-in framework obligations actually tracked for this org's assets
    type ObAgg = {
      obligation_id: string
      framework: string
      framework_label: string
      obligation_title: string
      article_reference: string | null
      obligation_description: string | null
      asset_count: number
      statuses: Record<string, number>
    }
    const obMap = new Map<string, ObAgg>()
    for (const row of complianceRows) {
      if (!assetIds.has(String(row.system_id))) continue
      const cf = obligationById.get(String(row.obligation_id))
      if (!cf || cf.is_active === false) continue
      const oid = cf.id
      let agg = obMap.get(oid)
      if (!agg) {
        const fw = cf.framework
        agg = {
          obligation_id: oid,
          framework: fw,
          framework_label: FRAMEWORK_LABELS[fw] || fw.replace(/_/g, ' '),
          obligation_title: cf.obligation_title,
          article_reference: cf.article_reference,
          obligation_description: cf.obligation_description,
          asset_count: 0,
          statuses: {},
        }
        obMap.set(oid, agg)
      }
      agg.asset_count += 1
      const st = String(row.status || 'unknown')
      agg.statuses[st] = (agg.statuses[st] || 0) + 1
    }
    const obligations = [...obMap.values()].sort((a, b) => {
      const fa = a.framework.localeCompare(b.framework)
      if (fa) return fa
      return a.obligation_title.localeCompare(b.obligation_title)
    })

    const customFrameworkControls = (frameworkControlsRes.data || []).map((fc) => {
      const mapped = fc.mapped_control_id ? controlDefs.get(String(fc.mapped_control_id)) : null
      const fw = (frameworksRes.data || []).find((f) => f.id === fc.framework_id)
      return {
        id: fc.id,
        framework_id: fc.framework_id,
        framework_name: fw?.name || null,
        title: fc.title,
        description: fc.description,
        category: fc.category,
        status: fc.status,
        mapped_control_id: fc.mapped_control_id,
        mapped_control_title: mapped?.title ? String(mapped.title) : null,
        mapped_control_number: mapped?.control_number ?? null,
      }
    })

    // Attach policy + catalogue maps + custom-framework requirement links (real FKs only)
    const controlsEnriched = controls.map((c) => {
      const linkedPolicies = policies
        .filter((p) => p.linked_control_id && String(p.linked_control_id) === String(c.control_id))
        .map((p) => ({ title: p.title, version: p.version, is_active: p.is_active }))

      const catalogueMapped = (mapsByControlId.get(String(c.control_id || '')) || [])
        .slice()
        .sort((a, b) => {
          if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1
          return Number(a.display_order || 0) - Number(b.display_order || 0)
        })
        .map((m) => {
          const ob = obligationMetaById.get(String(m.obligation_id))
          return {
            framework_name: ob?.framework_label || null,
            requirement_title: ob?.obligation_title || null,
            article_reference: ob?.article_reference || null,
            is_primary: Boolean(m.is_primary),
            interpretation_note: m.interpretation_note ? String(m.interpretation_note) : null,
            source: 'catalogue' as const,
          }
        })

      const customMapped = customFrameworkControls
        .filter((fc) => fc.mapped_control_id && String(fc.mapped_control_id) === String(c.control_id))
        .map((fc) => ({
          framework_name: fc.framework_name,
          requirement_title: fc.title,
          article_reference: null as string | null,
          is_primary: false,
          interpretation_note: null as string | null,
          status: fc.status,
          source: 'org_custom' as const,
        }))

      return {
        ...c,
        linked_policies: linkedPolicies,
        mapped_requirements: [...catalogueMapped, ...customMapped],
      }
    })

    const ctrlDone = controlsEnriched.filter((c) => isDoneStatus(c.status)).length
    const ctrlInProgress = controlsEnriched.filter((c) => isInProgressStatus(c.status)).length
    const ctrlOutstanding = controlsEnriched.filter((c) => isOutstandingStatus(c.status)).length

    const assessments = (assessRes.data || []).map((a) => ({
      ...a,
      asset_name: assetNames.get(String(a.system_id || '')) || null,
    }))

    const evidence = evidenceRaw.map((e) => {
      const assignment = controlsEnriched.find((c) => c.id === e.control_assignment_id)
      return {
        id: e.id,
        file_name: e.file_name,
        file_type: e.file_type || null,
        description: e.description || null,
        uploaded_at: e.uploaded_at,
        control_assignment_id: e.control_assignment_id,
        system_id: e.system_id,
        asset_name: assetNames.get(String(e.system_id || '')) || assignment?.asset_name || null,
        control_title: assignment?.title || null,
        control_number: assignment?.control_number ?? null,
        control_status: assignment?.status || null,
        scope: e.system_id ? 'asset' : assignment?.is_org_level ? 'organisation' : 'control',
      }
    })

    const activity = (activityRes.data || [])
      .filter((row) => ACTIVITY_KEEP.has(String(row.action || '')))
      .slice(0, 18)
      .map((row) => ({
        id: row.id,
        action: row.action,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        created_at: row.created_at,
        entity_label:
          row.entity_type === 'ai_system'
            ? assetNames.get(String(row.entity_id || '')) || null
            : null,
      }))

    const scoreRow = scoreRes.data as Record<string, unknown> | null
    let composite = Number(scoreRow?.composite_score) || 0
    if (!scoreRow && controlsEnriched.length) {
      composite = Math.round((100 * ctrlDone) / controlsEnriched.length)
    }
    composite = Math.round(composite)
    const posture = maturityLabel(composite)

    const highRiskCount = assetsWithOwners.filter((a) => {
      const t = String(a.risk_tier || '').toLowerCase()
      return t === 'high' || t === 'unacceptable'
    }).length

    const activePolicies = policies.filter((p) => p.is_active).length
    const counts = {
      assets: assetsWithOwners.length,
      high_risk_assets: highRiskCount,
      assessments: assessments.length,
      policies: policies.length,
      policies_active: activePolicies,
      frameworks_custom: (frameworksRes.data || []).length,
      obligations: obligations.length,
      controls: controlsEnriched.length,
      controls_done: ctrlDone,
      controls_in_progress: ctrlInProgress,
      controls_outstanding: ctrlOutstanding,
      evidence: evidence.length,
      members: members.length,
    }

    const observations = buildObservations({
      assets: assetsWithOwners as Array<Record<string, unknown>>,
      controls: controlsEnriched as Array<Record<string, unknown>>,
      assessments: assessments as Array<Record<string, unknown>>,
      evidence: evidence as Array<Record<string, unknown>>,
      policies: policies as Array<Record<string, unknown>>,
      counts,
      score: composite,
      posture,
    })

    const peopleById = new Map<
      string,
      {
        id: string
        full_name: string
        job_title: string | null
        department: string | null
        roles: string[]
      }
    >()
    function addPersonRole(id: unknown, roleLabel: string) {
      if (!id) return
      const key = String(id)
      const p = profileMap.get(key)
      const name = p?.full_name || p?.email
      if (!name) return
      const existing = peopleById.get(key)
      if (existing) {
        if (!existing.roles.includes(roleLabel)) existing.roles.push(roleLabel)
        return
      }
      peopleById.set(key, {
        id: key,
        full_name: String(name),
        job_title: p?.job_title ? String(p.job_title) : null,
        department: p?.department ? String(p.department) : null,
        roles: [roleLabel],
      })
    }
    for (const a of assetsWithOwners) {
      addPersonRole(a.business_owner_id, 'Business owner')
      addPersonRole(a.compliance_owner_id, 'Compliance / risk owner')
      addPersonRole(a.technical_owner_id, 'Technical / model owner')
    }

    const generatedAt = new Date().toISOString()
    const coreSnapshot = {
      organisation: {
        id: org.id,
        name: org.name,
        sector: org.sector,
        org_size: org.org_size,
        plan: org.plan,
        subscription_status: org.subscription_status,
      },
      summary: {
        composite_score: composite,
        posture,
        layers: maturityLayers(scoreRow, ctrlDone, controlsEnriched.length),
        risk: riskBuckets(assetsWithOwners),
        counts,
        observations,
        score_as_of: scoreRow?.snapshot_at || generatedAt,
      },
      assets: assetsWithOwners,
      assessments,
      policies,
      frameworks: {
        custom: frameworksRes.data || [],
        custom_controls: customFrameworkControls,
        obligations,
      },
      controls: controlsEnriched,
      evidence,
      activity,
      members,
      accountability: {
        org_roles: members,
        asset_owners: assetsWithOwners.map((a) => ({
          asset_id: a.id,
          asset_name: a.name,
          business_owner: a.business_owner_name,
          compliance_owner: a.compliance_owner_name,
          technical_owner: a.technical_owner_name,
        })),
        people: [...peopleById.values()].sort((a, b) => a.full_name.localeCompare(b.full_name)),
      },
    }

    const snapshotHash = await sha16(coreSnapshot)
    const contentHash = await sha256Hex(coreSnapshot)
    const dossierId = `RAD-${snapshotHash.slice(0, 4).toUpperCase()}-${snapshotHash.slice(4, 10).toUpperCase()}`

    const payload = {
      ...coreSnapshot,
      meta: {
        dossier_id: dossierId,
        generated_at: generatedAt,
        snapshot_hash: snapshotHash,
        catalogue_hash: catalogueHash,
        methodology_version_id: currentMethodology?.id || null,
        methodology_version_label: currentMethodology?.version_label || null,
        methodology_catalogue_hash: currentMethodology?.catalogue_hash || null,
        generator_version: '2.6.0',
        requested_by: user.id,
      },
    }

    console.log(
      `[generate-dossier] action=${action} user=${user.id} org=${orgId} id=${dossierId} snapshot=${snapshotHash} catalogue=${catalogueHash}`,
    )

    if (action === 'sign') {
      const versionId = String(body?.version_id || '').trim()
      const signatoryName = String(body?.signatory_name || '').trim()
      const signatoryRole = String(body?.signatory_role || '').trim()
      const signatureSvg = sanitizeSignatureSvg(body?.signature_svg)
      const confirmed = body?.confirmed === true

      if (!versionId) return json({ error: 'version_id is required to sign' }, 400)
      if (!signatoryName || signatoryName.length < 2) {
        return json({ error: 'Signer name is required' }, 400)
      }
      if (!signatoryRole) return json({ error: 'Signer role is required' }, 400)
      if (!signatureSvg) return json({ error: 'A valid signature is required' }, 400)
      if (!confirmed) return json({ error: 'Confirmation is required before signing' }, 400)

      const { data: version, error: versionErr } = await supabase
        .from('governance_dossiers')
        .select('*')
        .eq('id', versionId)
        .eq('org_id', orgId)
        .maybeSingle()

      if (versionErr || !version) return json({ error: 'Dossier version not found' }, 404)
      if (version.status === 'signed') {
        return json({ error: 'This dossier version is already signed', code: 'already_signed' }, 409)
      }
      if (version.snapshot_hash !== snapshotHash) {
        return json(
          {
            error: 'This dossier has changed since it was generated. Generate a new version before signing.',
            code: 'dossier_changed',
            reviewed_hash: version.snapshot_hash,
            current_hash: snapshotHash,
          },
          409,
        )
      }

      const signedAt = new Date().toISOString()
      const signatureId = crypto.randomUUID()
      const reqMeta = requestMeta(req)

      const { data: priorEvents } = await supabase
        .from('governance_dossier_events')
        .select('event_type,actor_name,actor_email,ip_address,occurred_at')
        .eq('dossier_version_id', version.id)
        .order('occurred_at', { ascending: true })

      const trail = [
        ...(priorEvents || []).map((e) => ({
          event: EVENT_LABELS[e.event_type] || e.event_type,
          at: e.occurred_at,
          actor: e.actor_name || e.actor_email || null,
          ip: e.ip_address || null,
        })),
        { event: EVENT_LABELS.signed, at: signedAt, actor: signatoryName, ip: reqMeta.ip },
      ]
      // First event (generation) plus the most recent activity keeps the certificate on one page.
      const trailForPdf = trail.length > 14 ? [trail[0], ...trail.slice(-13)] : trail

      const reviewedPayload = {
        ...(version.snapshot as Record<string, unknown>),
        approvals: [
          {
            name: signatoryName,
            job_title: signatoryRole,
            signed_at: signedAt,
            signature_svg: signatureSvg,
          },
        ],
        signature_audit: {
          dossier_code: version.dossier_code,
          version: version.snapshot_hash,
          content_hash: version.content_hash,
          signature_id: signatureId,
          signer_name: signatoryName,
          signer_role: signatoryRole,
          signer_email: actor.email,
          signed_at: signedAt,
          ip_address: reqMeta.ip,
          user_agent: reqMeta.userAgent,
          auth_method: 'Authenticated RegAnchor account session',
          declaration: DOSSIER_DECLARATION,
          signature_svg: signatureSvg,
          events: trailForPdf,
        },
        meta: {
          ...((version.snapshot as { meta?: Record<string, unknown> })?.meta || {}),
          signed_at: signedAt,
          signed_by: user.id,
        },
      }

      if (!RENDERER_URL) {
        return json({ error: 'RENDER_SERVICE_URL not configured' }, 500)
      }

      const renderResponse = await fetch(`${RENDERER_URL}/render-dossier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reviewedPayload),
      })

      if (!renderResponse.ok) {
        const detail = await renderResponse.text().catch(() => '')
        console.error('[generate-dossier] signed render failed', renderResponse.status, detail)
        throw new Error(`Renderer error: ${renderResponse.status}`)
      }

      const pdfBuffer = await renderResponse.arrayBuffer()
      const orgSlug = String(org.name || 'organisation')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
      const dateSlug = signedAt.slice(0, 10)
      const filename = `RegAnchor-Governance-Dossier_${orgSlug}_${dateSlug}_${version.snapshot_hash}_signed.pdf`
      const storagePath = `dossiers/${orgId}/${filename}`

      const { error: uploadError } = await supabase.storage
        .from('governance-reports')
        .upload(storagePath, new Uint8Array(pdfBuffer), {
          contentType: 'application/pdf',
          upsert: true,
        })
      if (uploadError) {
        console.error('[generate-dossier] Signed upload error:', uploadError.message)
        throw new Error('Could not store signed dossier PDF')
      }

      const { data: sigRow, error: sigErr } = await supabase
        .from('e_signatures')
        .insert({
          id: signatureId,
          org_id: orgId,
          user_id: user.id,
          document_type: 'dossier',
          document_id: version.id,
          signatory_name: signatoryName,
          signatory_email: user.email || '',
          signatory_role: signatoryRole,
          signature_svg: signatureSvg,
          declaration_text: DOSSIER_DECLARATION,
          content_hash: version.content_hash,
          ip_address: reqMeta.ip,
          user_agent: reqMeta.userAgent,
          signed_at: signedAt,
        })
        .select('id')
        .single()

      if (sigErr || !sigRow) {
        console.error('[generate-dossier] e_signatures insert failed', sigErr?.message)
        throw new Error('Could not record dossier signature')
      }

      const { error: lockErr } = await supabase
        .from('governance_dossiers')
        .update({
          status: 'signed',
          signed_at: signedAt,
          signed_storage_path: storagePath,
          signature_id: sigRow.id,
          snapshot: reviewedPayload,
        })
        .eq('id', version.id)
        .eq('status', 'ready_for_signoff')

      if (lockErr) {
        // Allow ready_for_review → signed as well
        const { error: lockErr2 } = await supabase
          .from('governance_dossiers')
          .update({
            status: 'signed',
            signed_at: signedAt,
            signed_storage_path: storagePath,
            signature_id: sigRow.id,
            snapshot: reviewedPayload,
          })
          .eq('id', version.id)
          .neq('status', 'signed')
        if (lockErr2) {
          console.error('[generate-dossier] lock version failed', lockErr2.message)
          throw new Error('Could not finalise signed dossier version')
        }
      }

      await recordEvent(supabase, {
        versionId: version.id,
        orgId,
        type: 'signed',
        actor: { ...actor, name: signatoryName },
        req,
        occurredAt: signedAt,
        metadata: {
          signature_id: sigRow.id,
          signatory_role: signatoryRole,
          content_hash: version.content_hash,
          declaration: DOSSIER_DECLARATION,
        },
      })
      await recordEvent(supabase, {
        versionId: version.id,
        orgId,
        type: 'finalised',
        actor: { ...actor, name: signatoryName },
        req,
        metadata: { file: filename, pdf_bytes: pdfBuffer.byteLength },
      })

      await supabase.from('registry_audit_log').insert({
        org_id: orgId,
        user_id: user.id,
        action: 'dossier_signed',
        entity_type: 'governance_dossier',
        entity_id: version.id,
        changes: {
          dossier_code: version.dossier_code,
          snapshot_hash: version.snapshot_hash,
          signatory_name: signatoryName,
          signatory_role: signatoryRole,
          _actor_name: signatoryName,
        },
      })

      const { data: urlData } = await supabase.storage
        .from('governance-reports')
        .createSignedUrl(storagePath, 60 * 60 * 24 * 7)

      return json({
        success: true,
        version_id: version.id,
        dossier_id: version.dossier_code,
        snapshot_hash: version.snapshot_hash,
        status: 'signed',
        signed_at: signedAt,
        download_url: urlData?.signedUrl || null,
        filename,
      })
    }

    // Default: assemble for review (no PDF until sign-off)
    const { data: existing } = await supabase
      .from('governance_dossiers')
      .select('id,status,dossier_code,snapshot_hash,catalogue_hash,signed_at,signed_storage_path,created_at,reviewed_at')
      .eq('org_id', orgId)
      .eq('snapshot_hash', snapshotHash)
      .maybeSingle()

    if (existing?.status === 'signed') {
      let downloadUrl: string | null = null
      if (existing.signed_storage_path) {
        const { data: urlData } = await supabase.storage
          .from('governance-reports')
          .createSignedUrl(existing.signed_storage_path, 60 * 60 * 24 * 7)
        downloadUrl = urlData?.signedUrl || null
      }
      return json({
        success: true,
        version_id: existing.id,
        dossier_id: existing.dossier_code,
        snapshot_hash: existing.snapshot_hash,
        catalogue_hash: existing.catalogue_hash,
        status: 'signed',
        signed_at: existing.signed_at,
        download_url: downloadUrl,
        already_signed: true,
      })
    }

    const reviewedAt = new Date().toISOString()
    let versionId = existing?.id || null

    if (existing?.id) {
      await supabase
        .from('governance_dossiers')
        .update({
          status: 'ready_for_signoff',
          snapshot: payload,
          content_hash: contentHash,
          catalogue_hash: catalogueHash,
          dossier_code: dossierId,
          reviewed_at: reviewedAt,
        })
        .eq('id', existing.id)
      versionId = existing.id
    } else {
      const { data: inserted, error: insertErr } = await supabase
        .from('governance_dossiers')
        .insert({
          org_id: orgId,
          dossier_code: dossierId,
          snapshot_hash: snapshotHash,
          content_hash: contentHash,
          catalogue_hash: catalogueHash,
          status: 'ready_for_signoff',
          snapshot: payload,
          created_by: user.id,
          reviewed_at: reviewedAt,
        })
        .select('id')
        .single()
      if (insertErr || !inserted) {
        console.error('[generate-dossier] insert version failed', insertErr?.message)
        throw new Error('Could not store dossier version for review')
      }
      versionId = inserted.id
      await recordEvent(supabase, {
        versionId: inserted.id,
        orgId,
        type: 'generated',
        actor,
        req,
        metadata: { dossier_code: dossierId, snapshot_hash: snapshotHash, content_hash: contentHash },
      })
    }

    return json({
      success: true,
      version_id: versionId,
      dossier_id: dossierId,
      snapshot_hash: snapshotHash,
      catalogue_hash: catalogueHash,
      content_hash: contentHash,
      status: 'ready_for_signoff',
      reviewed_at: reviewedAt,
      snapshot: payload,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Dossier generation failed'
    console.error('[generate-dossier] Error:', message)
    return json({ error: message }, 500)
  }
})
