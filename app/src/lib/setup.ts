import { sb } from './supabase'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'
import type { Workspace } from './workspace'

export type SetupStep = {
  id: string
  title: string
  body: string
  done: boolean
  to: string
  required?: boolean
}

export type SetupSnapshot = {
  steps: SetupStep[]
  completed: number
  total: number
  systems: number
  controlsOpen: number
  policiesPending: number
  connections: number
  mcpSessions: number
  frameworks: number
  alertsOpen: number
  firstAssetId: string | null
}

export async function loadSetupSnapshot(
  workspace: Workspace,
  accessToken?: string,
): Promise<SetupSnapshot> {
  const orgId = workspace.orgId
  let systems = 0
  let connections = 0
  let controlsOpen = 0
  let policiesPending = 0
  let frameworks = 0
  let alertsOpen = 0
  let mcpSessions = 0
  let firstAssetId: string | null = null

  if (orgId) {
    const [
      systemsRes,
      firstAssetRes,
      connRes,
      assignRes,
      policiesRes,
      fwRes,
      alertsRes,
    ] = await Promise.all([
      sb.from('ai_systems').select('id', { count: 'exact', head: true }).eq('org_id', orgId).is('deleted_at', null),
      sb
        .from('ai_systems')
        .select('id')
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
      sb.from('provider_connections').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'connected'),
      sb
        .from('control_assignments')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .in('status', ['not_started', 'in_progress']),
      sb.from('policy_documents').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('is_active', true),
      sb.from('org_frameworks').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('is_active', true),
      sb
        .from('governance_alerts')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('is_dismissed', false)
        .is('resolved_at', null),
    ])

    systems = systemsRes.count ?? 0
    firstAssetId = (firstAssetRes.data as { id?: string } | null)?.id || null
    connections = connRes.count ?? 0
    controlsOpen = assignRes.count ?? 0
    policiesPending = policiesRes.count ?? 0
    frameworks = fwRes.count ?? 0
    alertsOpen = alertsRes.count ?? 0
  }

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

  const steps: SetupStep[] = [
    {
      id: 'register',
      title: 'Register an asset',
      body: 'Add your first AI system to the registry so assessments and controls have a place to live.',
      done: systems > 0,
      to: '/registry',
      required: true,
    },
    {
      id: 'framework',
      title: 'Adopt a framework',
      body: 'Activate a framework so policies and controls map to known obligations.',
      done: frameworks > 0,
      to: '/frameworks',
      required: true,
    },
    {
      id: 'provider',
      title: 'Connect a provider',
      body: 'Attach a runtime key on an asset Connection tab, or set org admin credentials under Connect.',
      done: connections > 0,
      to: '/integrations',
    },
    {
      id: 'mcp',
      title: 'Connect via MCP',
      body: 'Give Cursor or Claude governed tools from Connect without pasting secrets into chat.',
      done: mcpSessions > 0,
      to: '/integrations',
    },
    {
      id: 'controls',
      title: 'Close open controls',
      body: 'Drive safeguard assignments to implemented or verified.',
      done: systems > 0 && controlsOpen === 0,
      to: '/controls',
    },
    {
      id: 'policies',
      title: 'Publish policies',
      body: 'Adopt templates and publish active policies for your organisation.',
      done: policiesPending > 0,
      to: '/policies',
    },
  ]

  const completed = steps.filter((s) => s.done).length
  return {
    steps,
    completed,
    total: steps.length,
    systems,
    controlsOpen,
    policiesPending,
    connections,
    mcpSessions,
    frameworks,
    alertsOpen,
    firstAssetId,
  }
}
