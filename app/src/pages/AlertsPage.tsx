import { useCallback, useEffect, useState } from 'react'
import {
  BrandLoader,
  Button,
  EmptyState,
  MetricStrip,
  Notice,
  PageFrame,
  PageHeader,
  Section,
  StatusLabel,
  type StatusTone,
} from '../ui'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { invokeEdge } from '../lib/edge'
import { fmtDate } from '../lib/rpc'
import { sb } from '../lib/supabase'
import styles from './AlertsPage.module.css'

type Alert = {
  id: string
  title?: string | null
  body?: string | null
  severity?: string | null
  alert_type?: string | null
  created_at?: string | null
  resolved_at?: string | null
  is_read?: boolean | null
  is_dismissed?: boolean | null
  ref_id?: string | null
  ref_type?: string | null
}

type AlertMailCtx = {
  accessToken: string
  email: string
  name: string
}

const TYPE_LABELS: Record<string, string> = {
  score_drop: 'Score drop',
  control_overdue: 'Control overdue',
  assessment_due: 'Assessment due',
  control_regression: 'Regression',
  compliance_rule_fired: 'Automation',
  support_response: 'Support',
}

function sevTone(sev?: string | null): StatusTone {
  if (sev === 'critical') return 'risk'
  if (sev === 'warning') return 'warn'
  return 'info'
}

async function sendAlertEmail(mail: AlertMailCtx, title: string, body: string) {
  try {
    await invokeEdge(
      'send-mail',
      {
        kind: 'portal-alert',
        to_email: mail.email,
        to_name: mail.name,
        alert_title: title,
        alert_body: body,
      },
      mail.accessToken,
    )
  } catch (err) {
    console.warn('Alert email skipped', err)
  }
}

async function maybeCreateAlert(
  orgId: string,
  type: string,
  severity: string,
  title: string,
  body: string,
  refId: string | null,
  refType: string | null,
  mail?: AlertMailCtx | null,
) {
  let query = sb
    .from('governance_alerts')
    .select('id')
    .eq('org_id', orgId)
    .eq('alert_type', type)
    .is('resolved_at', null)
    .eq('is_dismissed', false)
  if (refId) query = query.eq('ref_id', refId)
  const { data: existing } = await query.limit(1)
  if (existing && existing.length) return
  const { data, error } = await sb
    .from('governance_alerts')
    .insert({
      org_id: orgId,
      alert_type: type,
      severity,
      title,
      body,
      ref_id: refId,
      ref_type: refType,
    })
    .select('id')
    .single()
  if (!error && data && mail) {
    await sendAlertEmail(mail, title, body)
  }
}

/** Port of portal checkAndCreateAlerts (Check Now). */
async function runAlertChecks(orgId: string, mail?: AlertMailCtx | null) {
  const { data: history } = await sb
    .from('governance_score_history')
    .select('composite_score,snapshot_at')
    .eq('org_id', orgId)
    .order('snapshot_at', { ascending: false })
    .limit(2)
  if (history && history.length === 2) {
    const drop = history[1].composite_score - history[0].composite_score
    if (drop >= 10) {
      await maybeCreateAlert(
        orgId,
        'score_drop',
        'critical',
        'Governance Score Drop Detected',
        `Your governance score has fallen by ${drop} points to ${history[0].composite_score}%. Review your controls and take action to restore your compliance position.`,
        null,
        null,
        mail,
      )
    }
  }

  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
  const { data: overdue } = await sb
    .from('control_assignments')
    .select('id,control_id')
    .eq('org_id', orgId)
    .eq('status', 'in_progress')
    .lt('updated_at', sixtyDaysAgo)
  if (overdue?.length) {
    const controlIds = overdue.map((a) => a.control_id).filter(Boolean)
    const { data: controls } = controlIds.length
      ? await sb.from('governance_controls').select('id,title').in('id', controlIds)
      : { data: [] as Array<{ id: string; title?: string }> }
    const byId = Object.fromEntries((controls || []).map((c) => [c.id, c.title || 'A governance control']))
    for (const a of overdue) {
      const ctrlName = byId[a.control_id] || 'A governance control'
      await maybeCreateAlert(
        orgId,
        'control_overdue',
        'warning',
        `Control Overdue: ${ctrlName}`,
        `${ctrlName} has been in progress for over 60 days without completion. Open the control and complete the implementation tasks.`,
        a.id,
        'control_assignment',
        mail,
      )
    }
  }

  const { data: systems } = await sb
    .from('ai_systems')
    .select('id,name')
    .eq('org_id', orgId)
    .is('deleted_at', null)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  for (const sys of systems || []) {
    const { data: assessments } = await sb
      .from('registry_assessments')
      .select('requested_at')
      .eq('system_id', sys.id)
      .order('requested_at', { ascending: false })
      .limit(1)
    const last = assessments?.[0]
    if (!last || last.requested_at < ninetyDaysAgo) {
      await maybeCreateAlert(
        orgId,
        'assessment_due',
        'warning',
        `Assessment Due: ${sys.name}`,
        `${sys.name} has not been assessed in over 90 days. Run a new assessment to keep your governance score current and accurate.`,
        sys.id,
        'ai_system',
        mail,
      )
    }
  }
}

export function AlertsPage() {
  const { org, user, session, profile } = useAuth()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [unreadCount, setUnreadCount] = useState(0)

  usePageChrome({ title: 'Alerts', breadcrumbs: [{ label: 'Alerts' }] })

  const load = useCallback(async () => {
    if (!org?.id) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const { data } = await sb
        .from('governance_alerts')
        .select('*')
        .eq('org_id', org.id)
        .eq('is_dismissed', false)
        .order('created_at', { ascending: false })
        .limit(50)
      const list = (data as Alert[]) || []
      const unreadIds = list.filter((a) => !a.is_read && !a.resolved_at).map((a) => a.id)
      setUnreadCount(unreadIds.length)
      if (unreadIds.length) {
        await sb.from('governance_alerts').update({ is_read: true }).in('id', unreadIds)
      }
      setAlerts(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load alerts.')
    } finally {
      setLoading(false)
    }
  }, [org?.id])

  useEffect(() => {
    void load()
  }, [load])

  async function checkNow() {
    if (!org?.id) return
    setChecking(true)
    setError('')
    try {
      const mail: AlertMailCtx | null =
        session?.access_token && user?.email
          ? {
              accessToken: session.access_token,
              email: user.email,
              name: profile?.full_name?.split(' ')[0] || 'there',
            }
          : null
      await runAlertChecks(org.id, mail)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Alert check failed.')
    } finally {
      setChecking(false)
    }
  }

  async function resolveAlert(alertId: string) {
    if (!user?.id || !org?.id) return
    await sb
      .from('governance_alerts')
      .update({ resolved_at: new Date().toISOString(), resolved_by: user.id, is_read: true })
      .eq('id', alertId)
    await sb.from('registry_audit_log').insert({
      org_id: org.id,
      user_id: user.id,
      action: 'control_updated',
      entity_type: 'governance_alert',
      entity_id: alertId,
      changes: { _actor_name: user.email, control: 'Alert resolved' },
    })
    await load()
  }

  async function dismissAlert(alertId: string) {
    await sb.from('governance_alerts').update({ is_dismissed: true }).eq('id', alertId)
    await load()
  }

  const active = alerts.filter((a) => !a.resolved_at)
  const resolved = alerts.filter((a) => a.resolved_at)

  if (loading) {
    return (
      <PageFrame>
        <PageHeader
          title="Alerts"
          description="Governance monitoring for score drops, overdue controls, and assessments due."
        />
        <BrandLoader fill label="Loading alerts" />
      </PageFrame>
    )
  }

  return (
    <PageFrame railItems={[{ id: 'active', label: 'Active alerts' }]}>
      <PageHeader
        title="Alerts"
        description="Governance monitoring for score drops, overdue controls, and assessments due."
        actions={
          <Button variant="ghost" pending={checking} onClick={() => void checkNow()}>
            Check now
          </Button>
        }
      />

      {error ? <Notice tone="risk">{error}</Notice> : null}

      <Section id="stats" title="Summary">
        <MetricStrip
          items={[
            { id: 'unread', label: 'Unread', value: String(unreadCount) },
            { id: 'active', label: 'Active', value: String(active.length) },
            { id: 'resolved', label: 'Resolved', value: String(resolved.length) },
          ]}
        />
      </Section>

      <Section id="active" title="Active alerts">
        {active.length === 0 ? (
          <EmptyState
            title="No active alerts"
            body="Your governance platform is monitoring for score drops, overdue controls, and assessments due for review."
          />
        ) : (
          <div className={styles.list}>
            {active.map((a) => {
              const sev = a.severity || 'info'
              return (
                <article key={a.id} className={`${styles.card} ${styles[`sev_${sev}`] || ''}`}>
                  <div className={styles.head}>
                    <div className={styles.meta}>
                      <StatusLabel tone={sevTone(sev)}>{sev}</StatusLabel>
                      <span className={styles.type}>
                        {TYPE_LABELS[a.alert_type || ''] || a.alert_type}
                      </span>
                    </div>
                    <span className={styles.date}>{fmtDate(a.created_at)}</span>
                  </div>
                  <div className={styles.title}>{a.title}</div>
                  <div className={styles.body}>{a.body || ''}</div>
                  <div className={styles.actions}>
                    <Button size="sm" onClick={() => void resolveAlert(a.id)}>
                      Mark resolved
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void dismissAlert(a.id)}>
                      Dismiss
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
        <Notice title="Email alerts">
          Check now runs score-drop, overdue-control, and assessment-due evaluation (portal parity).
          New alerts also email your signed-in address via Resend. The full compliance_rules
          auto-advance engine still runs from the legacy portal boot path.
        </Notice>
      </Section>
    </PageFrame>
  )
}
