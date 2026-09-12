import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BrandLoader,
  Button,
  EmptyState,
  FilterBar,
  Ledger,
  LedgerRow,
  MetricStrip,
  PageFrame,
  PageHeader,
  Section,
  StatusLabel,
  Tabs,
  Timeline,
} from '../ui'
import { BrandIcon } from '../icons/BrandIcon'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { loadWorkspace } from '../lib/workspace'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../lib/config'
import { sb } from '../lib/supabase'
import styles from './MonitoringPage.module.css'

type Alert = {
  id: string
  title?: string | null
  body?: string | null
  severity?: string | null
  alert_type?: string | null
  created_at?: string | null
}

type Audit = {
  id: string
  action?: string | null
  entity_type?: string | null
  created_at?: string | null
}

type Usage = {
  id: number
  model?: string | null
  input_tokens?: number | null
  output_tokens?: number | null
  created_at?: string | null
  asset_id?: string | null
}

type SessionRow = {
  id: string
  label?: string | null
  client_name?: string | null
  revoked_at?: string | null
  created_at?: string
}

function sevTone(sev?: string | null) {
  if (sev === 'critical' || sev === 'high') return 'risk' as const
  if (sev === 'medium' || sev === 'warn') return 'warn' as const
  return 'info' as const
}

export function MonitoringPage() {
  const { session } = useAuth()
  const [tab, setTab] = useState('ops')
  const [search, setSearch] = useState('')
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [audit, setAudit] = useState<Audit[]>([])
  const [usage, setUsage] = useState<Usage[]>([])
  const [mcp, setMcp] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)

  usePageChrome({ title: 'Monitoring', breadcrumbs: [{ label: 'Monitoring' }] })

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!session?.user) return
      setLoading(true)
      const ws = await loadWorkspace(session.user.id)
      if (!ws.orgId) {
        if (!cancelled) setLoading(false)
        return
      }
      const [a, au, u] = await Promise.all([
        sb
          .from('governance_alerts')
          .select('id,title,body,severity,alert_type,created_at')
          .eq('org_id', ws.orgId)
          .eq('is_dismissed', false)
          .is('resolved_at', null)
          .order('created_at', { ascending: false })
          .limit(50),
        sb
          .from('registry_audit_log')
          .select('id,action,entity_type,created_at')
          .eq('org_id', ws.orgId)
          .order('created_at', { ascending: false })
          .limit(40),
        sb
          .from('asset_usage_events')
          .select('id,model,input_tokens,output_tokens,created_at,asset_id')
          .eq('org_id', ws.orgId)
          .order('created_at', { ascending: false })
          .limit(40),
      ])

      let sessions: SessionRow[] = []
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/mcp-auth`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action: 'sessions_list' }),
        })
        if (res.ok) {
          const data = await res.json()
          sessions = Array.isArray(data.sessions) ? data.sessions : []
        }
      } catch {
        /* optional */
      }

      if (!cancelled) {
        setAlerts((a.data as Alert[]) || [])
        setAudit((au.data as Audit[]) || [])
        setUsage((u.data as Usage[]) || [])
        setMcp(sessions.filter((s) => !s.revoked_at))
        setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [session])

  const tokensOut = usage.reduce((n, e) => n + (e.output_tokens || 0), 0)
  const tokensIn = usage.reduce((n, e) => n + (e.input_tokens || 0), 0)

  const filteredAlerts = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return alerts
    return alerts.filter((a) => `${a.title || ''} ${a.body || ''}`.toLowerCase().includes(q))
  }, [alerts, search])

  const filteredAudit = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return audit
    return audit.filter((a) => `${a.action || ''} ${a.entity_type || ''}`.toLowerCase().includes(q))
  }, [audit, search])

  if (loading) {
    return (
      <PageFrame>
        <PageHeader
          title="Monitoring"
          description="Agent sessions, gateway usage, alerts, and the audit log."
        />
        <BrandLoader fill label="Loading monitoring" />
      </PageFrame>
    )
  }

  return (
    <PageFrame
      railItems={[
        { id: 'ops', label: 'Ops' },
        { id: 'feed', label: 'Feed' },
      ]}
    >
      <PageHeader
        title="Monitoring"
        description="Agent sessions, gateway usage, alerts, and the audit log."
        actions={
          <Link to="/integrations">
            <Button variant="ghost">Manage connectors</Button>
          </Link>
        }
      />

      <Section id="ops" title="Operations board" description="What is live right now across agents and governed traffic.">
        <MetricStrip
          items={[
            { id: 'mcp', label: 'Agent sessions', value: mcp.length, hint: 'MCP connected' },
            {
              id: 'alerts',
              label: 'Open alerts',
              value: alerts.length,
              tone: alerts.length ? 'risk' : 'ok',
            },
            { id: 'in', label: 'Gateway in', value: tokensIn.toLocaleString(), hint: 'Recent events' },
            { id: 'out', label: 'Gateway out', value: tokensOut.toLocaleString() },
          ]}
        />

        <div className={styles.split}>
          <div className={styles.panel}>
            <div className={styles.panelTitle}>Agent hosts</div>
            {mcp.length === 0 ? (
              <EmptyState
                title="No agent hosts online"
                body="Connect Cursor under Integrations to put governed tools in an agent runtime."
              />
            ) : (
              <Ledger>
                {mcp.map((s) => (
                  <LedgerRow
                    key={s.id}
                    title={
                      <span className={styles.host}>
                        <BrandIcon slug="cursor" size={16} />
                        {s.label || s.client_name || 'MCP session'}
                      </span>
                    }
                    description={s.created_at ? `Since ${new Date(s.created_at).toLocaleString()}` : undefined}
                    meta={<StatusLabel tone="ok">Live</StatusLabel>}
                  />
                ))}
              </Ledger>
            )}
          </div>
          <div className={styles.panel}>
            <div className={styles.panelTitle}>Gateway models</div>
            {usage.length === 0 ? (
              <EmptyState title="No gateway traffic" body="Usage appears when production traffic uses ra_gw_ tokens." />
            ) : (
              <Ledger>
                {usage.slice(0, 6).map((u) => (
                  <LedgerRow
                    key={u.id}
                    title={u.model || 'Model'}
                    description={`${(u.input_tokens || 0).toLocaleString()} in · ${(u.output_tokens || 0).toLocaleString()} out`}
                    meta={<StatusLabel tone="info">{u.created_at ? new Date(u.created_at).toLocaleTimeString() : '-'}</StatusLabel>}
                  />
                ))}
              </Ledger>
            )}
          </div>
        </div>
      </Section>

      <Section id="feed" title="Signal feed">
        <Tabs
          items={[
            { id: 'ops', label: 'Timeline', count: audit.length },
            { id: 'alerts', label: 'Alerts', count: alerts.length },
            { id: 'audit', label: 'Audit table', count: audit.length },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab !== 'ops' ? <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search signals" /> : null}

        {tab === 'ops' ? (
          <Timeline
            empty={<EmptyState title="Quiet" body="Governance actions will stream here." />}
            items={audit.slice(0, 12).map((a) => ({
              id: a.id,
              title: (a.action || 'event').replace(/_/g, ' '),
              meta: [a.entity_type, a.created_at ? new Date(a.created_at).toLocaleString() : null]
                .filter(Boolean)
                .join(' · '),
              tone: a.action?.includes('implemented') ? 'ok' : a.action?.includes('revoke') ? 'warn' : 'info',
            }))}
          />
        ) : tab === 'alerts' ? (
          filteredAlerts.length === 0 ? (
            <EmptyState title="No open alerts" body="Alerts appear when controls, policies, or connectors need attention." />
          ) : (
            <Ledger>
              {filteredAlerts.map((a) => (
                <LedgerRow
                  key={a.id}
                  title={a.title || a.alert_type || 'Alert'}
                  description={a.body || undefined}
                  meta={<StatusLabel tone={sevTone(a.severity)}>{a.severity || 'info'}</StatusLabel>}
                />
              ))}
            </Ledger>
          )
        ) : filteredAudit.length === 0 ? (
          <EmptyState title="No audit events" body="Registry and control actions write an immutable trail." />
        ) : (
          <Ledger>
            {filteredAudit.map((a) => (
              <LedgerRow
                key={a.id}
                title={(a.action || 'event').replace(/_/g, ' ')}
                description={[a.entity_type, a.created_at ? new Date(a.created_at).toLocaleString() : null]
                  .filter(Boolean)
                  .join(' · ')}
                meta={<StatusLabel tone="neutral">Audit</StatusLabel>}
              />
            ))}
          </Ledger>
        )}
      </Section>
    </PageFrame>
  )
}
