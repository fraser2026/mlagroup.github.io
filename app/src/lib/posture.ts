import { sb } from './supabase'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'
import type { Workspace } from './workspace'
import { pct } from './workspace'

export type RiskBucket = { key: string; label: string; count: number }
export type LayerScore = { key: string; label: string; score: number }
export type ScorePoint = { at: string; score: number }

export type Posture = {
  composite: number
  layers: LayerScore[]
  history: ScorePoint[]
  systems: number
  risk: RiskBucket[]
  controlsOpen: number
  controlsDone: number
  controlsTotal: number
  alertsOpen: number
  connections: number
  mcpSessions: number
  gatewayEvents7d: number
  policiesActive: number
  frameworksCustom: number
  maturityLabel: string
}

function maturity(score: number) {
  if (score >= 85) return 'Operational'
  if (score >= 65) return 'Managed'
  if (score >= 40) return 'Developing'
  if (score > 0) return 'Initial'
  return 'Unscored'
}

function riskLabel(tier: string) {
  const t = tier.toLowerCase()
  if (t === 'high' || t === 'unacceptable') return 'High'
  if (t === 'limited') return 'Limited'
  if (t === 'minimal') return 'Minimal'
  return 'Unclassified'
}

export async function loadPosture(workspace: Workspace, accessToken?: string): Promise<Posture> {
  const empty: Posture = {
    composite: 0,
    layers: [
      { key: 'organisation', label: 'Organisation', score: 0 },
      { key: 'system', label: 'System', score: 0 },
      { key: 'assurance', label: 'Assurance', score: 0 },
    ],
    history: [],
    systems: 0,
    risk: [],
    controlsOpen: 0,
    controlsDone: 0,
    controlsTotal: 0,
    alertsOpen: 0,
    connections: 0,
    mcpSessions: 0,
    gatewayEvents7d: 0,
    policiesActive: 0,
    frameworksCustom: 0,
    maturityLabel: 'Unscored',
  }

  const orgId = workspace.orgId
  if (!orgId) return empty

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [
    scoreRes,
    histRes,
    systemsRes,
    assignRes,
    alertsRes,
    connRes,
    usageRes,
    policiesRes,
    fwRes,
  ] = await Promise.all([
    sb
      .from('governance_score_history')
      .select('composite_score,org_layer_score,system_layer_score,assurance_layer_score,snapshot_at')
      .eq('org_id', orgId)
      .is('system_id', null)
      .order('snapshot_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from('governance_score_history')
      .select('composite_score,snapshot_at')
      .eq('org_id', orgId)
      .is('system_id', null)
      .order('snapshot_at', { ascending: true })
      .limit(24),
    sb.from('ai_systems').select('id,risk_tier').eq('org_id', orgId).is('deleted_at', null),
    sb.from('control_assignments').select('id,status').eq('org_id', orgId),
    sb
      .from('governance_alerts')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('is_dismissed', false)
      .is('resolved_at', null),
    sb
      .from('provider_connections')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'connected'),
    sb
      .from('asset_usage_events')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .gte('created_at', since),
    sb
      .from('policy_documents')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('is_active', true),
    sb.from('org_frameworks').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('is_active', true),
  ])

  const systems = systemsRes.data || []
  const riskMap = new Map<string, number>()
  for (const s of systems) {
    const label = riskLabel(String(s.risk_tier || 'unclassified'))
    riskMap.set(label, (riskMap.get(label) || 0) + 1)
  }
  const riskOrder = ['High', 'Limited', 'Minimal', 'Unclassified']
  const risk = riskOrder
    .filter((k) => riskMap.has(k))
    .map((k) => ({ key: k.toLowerCase(), label: k, count: riskMap.get(k) || 0 }))

  const assigns = assignRes.data || []
  const controlsDone = assigns.filter((a) => a.status === 'implemented' || a.status === 'verified').length
  const controlsOpen = assigns.filter((a) => a.status === 'not_started' || a.status === 'in_progress').length

  let composite = scoreRes.data?.composite_score ?? 0
  let layers: LayerScore[] = [
    { key: 'organisation', label: 'Organisation', score: scoreRes.data?.org_layer_score ?? 0 },
    { key: 'system', label: 'System', score: scoreRes.data?.system_layer_score ?? 0 },
    { key: 'assurance', label: 'Assurance', score: scoreRes.data?.assurance_layer_score ?? 0 },
  ]

  if (!scoreRes.data && assigns.length) {
    composite = pct(controlsDone, assigns.length)
    layers = layers.map((l) => ({ ...l, score: composite }))
  }

  let mcpSessions = 0
  if (accessToken) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mcp-auth`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'sessions_list' }),
      })
      if (res.ok) {
        const data = await res.json()
        const list = Array.isArray(data.sessions) ? data.sessions : []
        mcpSessions = list.filter((s: { revoked_at?: string | null }) => !s.revoked_at).length
      }
    } catch {
      /* optional */
    }
  }

  const history = (histRes.data || []).map((h) => ({
    at: h.snapshot_at as string,
    score: Number(h.composite_score) || 0,
  }))

  return {
    composite: Math.round(Number(composite) || 0),
    layers,
    history,
    systems: systems.length,
    risk,
    controlsOpen,
    controlsDone,
    controlsTotal: assigns.length,
    alertsOpen: alertsRes.count ?? 0,
    connections: connRes.count ?? 0,
    mcpSessions,
    gatewayEvents7d: usageRes.count ?? 0,
    policiesActive: policiesRes.count ?? 0,
    frameworksCustom: fwRes.count ?? 0,
    maturityLabel: maturity(Number(composite) || 0),
  }
}
