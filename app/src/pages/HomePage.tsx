import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BrandLoader,
  Button,
  Checklist,
  EmptyState,
  MetricStrip,
  PageFrame,
  PageHeader,
  ProgressMeter,
  ScoreRing,
  Section,
  StatusLabel,
  Timeline,
} from '../ui'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { loadWorkspace } from '../lib/workspace'
import { loadPosture, type Posture } from '../lib/posture'
import { loadSetupSnapshot, type SetupSnapshot } from '../lib/setup'
import { sb } from '../lib/supabase'
import styles from './HomePage.module.css'

type Audit = { id: string; action?: string | null; created_at?: string | null; entity_type?: string | null }

export function HomePage() {
  const { session } = useAuth()
  const [orgName, setOrgName] = useState('Your organisation')
  const [posture, setPosture] = useState<Posture | null>(null)
  const [setup, setSetup] = useState<SetupSnapshot | null>(null)
  const [audit, setAudit] = useState<Audit[]>([])
  const [loading, setLoading] = useState(true)

  usePageChrome({ title: 'Home', breadcrumbs: [{ label: 'Home' }] })

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!session?.user) return
      setLoading(true)
      const ws = await loadWorkspace(session.user.id)
      const [p, s] = await Promise.all([
        loadPosture(ws, session.access_token),
        loadSetupSnapshot(ws, session.access_token),
      ])
      let events: Audit[] = []
      if (ws.orgId) {
        const { data } = await sb
          .from('registry_audit_log')
          .select('id,action,created_at,entity_type')
          .eq('org_id', ws.orgId)
          .order('created_at', { ascending: false })
          .limit(6)
        events = (data as Audit[]) || []
      }
      if (cancelled) return
      setOrgName(ws.orgName)
      setPosture(p)
      setSetup(s)
      setAudit(events)
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [session])

  const setupPct = setup ? Math.round((setup.completed / setup.total) * 100) : 0
  const next = (setup?.steps || []).filter((x) => !x.done).slice(0, 4)
  const highRisk = posture?.risk.find((r) => r.key === 'high')?.count || 0

  if (loading || !posture) {
    return (
      <PageFrame>
        <PageHeader
          title={orgName}
          description="See where governance stands, then close the next gap."
        />
        <BrandLoader fill label="Loading home" />
      </PageFrame>
    )
  }

  return (
    <PageFrame
      railItems={[
        { id: 'score', label: 'Score' },
        { id: 'next', label: 'Next steps' },
        { id: 'activity', label: 'Activity' },
      ]}
    >
      <PageHeader
        title={orgName}
        description="See where governance stands, then close the next gap."
        actions={
          <Link to="/registry">
            <Button>Registry</Button>
          </Link>
        }
      />

      <Section id="score" title="Score" description="How complete your control work is today.">
        <>
          <div className={styles.scoreRow}>
            <ScoreRing value={posture.composite} label="Governance" sublabel={posture.maturityLabel} />
            <div className={styles.scoreAside}>
              {posture.layers.map((l) => (
                <div key={l.key} className={styles.layer}>
                  <div className={styles.layerTop}>
                    <span>{l.label}</span>
                    <span className={styles.layerScore}>{Math.round(l.score)}%</span>
                  </div>
                  <ProgressMeter value={l.score} size="sm" bare />
                </div>
              ))}
              {highRisk > 0 ? (
                <div className={styles.riskNote}>
                  <StatusLabel tone="risk">High risk</StatusLabel>
                  <span>
                    {highRisk} asset{highRisk === 1 ? '' : 's'} need attention in the registry.
                  </span>
                </div>
              ) : null}
            </div>
          </div>
          <div className={styles.stripWrap}>
            <MetricStrip
              items={[
                { id: 'assets', label: 'Assets', value: posture.systems },
                {
                  id: 'controls',
                  label: 'Controls done',
                  value: `${posture.controlsDone}/${posture.controlsTotal || 0}`,
                  tone: posture.controlsOpen ? 'warn' : 'ok',
                },
                {
                  id: 'alerts',
                  label: 'Alerts',
                  value: posture.alertsOpen,
                  tone: posture.alertsOpen ? 'risk' : 'ok',
                },
                { id: 'mcp', label: 'Agent links', value: posture.mcpSessions },
              ]}
            />
          </div>
        </>
      </Section>

      <Section id="next" title="Next steps" description="Finish these once. They unlock the rest of the product.">
        {setupPct >= 100 ? (
          <EmptyState
            title="Setup is complete"
            body="Keep closing controls and watch Monitoring for alerts."
            action={
              <Link to="/controls">
                <Button variant="ghost">Controls</Button>
              </Link>
            }
          />
        ) : (
          <>
            <ProgressMeter value={setupPct} label={`${setup?.completed} of ${setup?.total} done`} />
            <div className={styles.gap} />
            <Checklist
              items={next.map((s) => ({
                id: s.id,
                title: s.title,
                body: s.body,
                done: false,
                required: s.required,
                action: (
                  <Link to={s.to}>
                    <Button size="sm">Open</Button>
                  </Link>
                ),
              }))}
            />
            <div className={styles.moreSetup}>
              <Link to="/setup">See full checklist</Link>
            </div>
          </>
        )}
      </Section>

      <Section id="activity" title="Activity" description="Recent changes in this organisation.">
        <Timeline
          empty={<EmptyState title="No activity yet" body="Register an asset or update a control to start the log." />}
          items={audit.map((a) => ({
            id: a.id,
            title: (a.action || 'event').replace(/_/g, ' '),
            meta: [a.entity_type, a.created_at ? new Date(a.created_at).toLocaleString() : null]
              .filter(Boolean)
              .join(' · '),
            tone:
              a.action?.includes('implemented') || a.action?.includes('verified')
                ? 'ok'
                : a.action?.includes('revoke')
                  ? 'warn'
                  : 'info',
          }))}
        />
      </Section>
    </PageFrame>
  )
}
