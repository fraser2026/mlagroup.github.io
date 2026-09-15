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
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
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
    const names = highRisk
      .slice(0, 3)
      .map((a) => String(a.name || 'Unnamed asset'))
      .join(', ')
    out.push(
      `${highRisk.length} high-risk AI asset${highRisk.length === 1 ? ' is' : 's are'} currently in scope${
        names ? ` (${names}${highRisk.length > 3 ? ', …' : ''})` : ''
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
    ] = await Promise.all([
      supabase
        .from('ai_systems')
        .select(
          'id,name,description,vendor,provider_slug,model_name,lifecycle,department,system_owner,purpose_category,risk_tier,created_at,updated_at',
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
    ])

    const assets = assetsRes.data || []
    const assetNames = new Map(assets.map((a) => [a.id, a.name || 'AI asset']))
    const assetIds = new Set(assets.map((a) => a.id))
    const assetIdList = assets.map((a) => a.id)

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
    const profileIds = [...new Set([...memberIds, ...assigneeIds])]

    let profiles: Array<{ id: string; full_name?: string | null; email?: string | null }> = []
    if (profileIds.length) {
      const { data: profs } = await supabase.from('profiles').select('id,full_name,email').in('id', profileIds)
      profiles = profs || []
    }
    const profileMap = new Map(profiles.map((p) => [p.id, p]))

    const members = (membersRes.data || []).map((m) => {
      const p = profileMap.get(m.user_id)
      return {
        user_id: m.user_id,
        role: m.role,
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

    // Attach policy + custom-framework requirement links onto controls (real FKs only)
    const controlsEnriched = controls.map((c) => {
      const linkedPolicies = policies
        .filter((p) => p.linked_control_id && String(p.linked_control_id) === String(c.control_id))
        .map((p) => ({ title: p.title, version: p.version, is_active: p.is_active }))
      const mappedRequirements = customFrameworkControls
        .filter((fc) => fc.mapped_control_id && String(fc.mapped_control_id) === String(c.control_id))
        .map((fc) => ({
          framework_name: fc.framework_name,
          requirement_title: fc.title,
          status: fc.status,
        }))
      return { ...c, linked_policies: linkedPolicies, mapped_requirements: mappedRequirements }
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
      .slice(0, 60)
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

    const highRiskCount = assets.filter((a) => {
      const t = String(a.risk_tier || '').toLowerCase()
      return t === 'high' || t === 'unacceptable'
    }).length

    const activePolicies = policies.filter((p) => p.is_active).length
    const counts = {
      assets: assets.length,
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
      assets: assets as Array<Record<string, unknown>>,
      controls: controlsEnriched as Array<Record<string, unknown>>,
      assessments: assessments as Array<Record<string, unknown>>,
      evidence: evidence as Array<Record<string, unknown>>,
      policies: policies as Array<Record<string, unknown>>,
      counts,
      score: composite,
      posture,
    })

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
        risk: riskBuckets(assets),
        counts,
        observations,
        score_as_of: scoreRow?.snapshot_at || generatedAt,
      },
      assets,
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
        asset_owners: assets
          .filter((a) => a.system_owner)
          .map((a) => ({
            asset_id: a.id,
            asset_name: a.name,
            owner: a.system_owner,
            department: a.department || null,
            risk_tier: a.risk_tier || null,
          })),
      },
    }

    const snapshotHash = await sha16(coreSnapshot)
    const dossierId = `RAD-${snapshotHash.slice(0, 4).toUpperCase()}-${snapshotHash.slice(4, 10).toUpperCase()}`

    const payload = {
      ...coreSnapshot,
      meta: {
        dossier_id: dossierId,
        generated_at: generatedAt,
        snapshot_hash: snapshotHash,
        generator_version: '2.0.0',
        requested_by: user.id,
      },
    }

    console.log(`[generate-dossier] user=${user.id} org=${orgId} id=${dossierId} hash=${snapshotHash}`)

    if (!RENDERER_URL) {
      return json({ error: 'RENDER_SERVICE_URL not configured' }, 500)
    }

    const renderResponse = await fetch(`${RENDERER_URL}/render-dossier`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!renderResponse.ok) {
      const detail = await renderResponse.text().catch(() => '')
      console.error('[generate-dossier] renderer failed', renderResponse.status, detail)
      throw new Error(`Renderer error: ${renderResponse.status}`)
    }

    const pdfBuffer = await renderResponse.arrayBuffer()
    const orgSlug = String(org.name || 'organisation')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
    const dateSlug = generatedAt.slice(0, 10)
    const filename = `RegAnchor-Governance-Dossier_${orgSlug}_${dateSlug}_${snapshotHash}.pdf`
    const storagePath = `dossiers/${orgId}/${filename}`

    const { error: uploadError } = await supabase.storage
      .from('governance-reports')
      .upload(storagePath, new Uint8Array(pdfBuffer), {
        contentType: 'application/pdf',
        upsert: true,
      })

    if (uploadError) {
      console.error('[generate-dossier] Upload error:', uploadError.message)
    }

    const { data: urlData } = await supabase.storage
      .from('governance-reports')
      .createSignedUrl(storagePath, 60 * 60 * 24 * 7)

    return json({
      success: true,
      dossier_id: dossierId,
      snapshot_hash: snapshotHash,
      filename,
      download_url: urlData?.signedUrl || null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Dossier generation failed'
    console.error('[generate-dossier] Error:', message)
    return json({ error: message }, 500)
  }
})
