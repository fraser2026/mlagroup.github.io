import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { Icon, StatusLabel } from '../ui'
import { BrandIcon } from '../icons/BrandIcon'
import { sb } from '../lib/supabase'
import {
  connectionLabel,
  formatAuditPlain,
  labelAssessStatus,
  labelLifecycle,
  labelProvider,
  labelTier,
  modelDisplayName,
  riskTone,
  type RegistryAsset,
} from '../lib/registry'
import styles from './AssetPreview.module.css'

type AssessmentRow = {
  id: string
  status?: string | null
  overall_score?: number | null
  requested_at?: string | null
  completed_at?: string | null
}

type ControlRow = {
  id: string
  status?: string | null
  system_id?: string | null
}

type AuditRow = {
  id: string
  action?: string | null
  created_at?: string | null
  user_id?: string | null
  changes?: Record<string, unknown> | null
}

type Props = {
  asset: RegistryAsset
  orgId: string
}

function fmtWhen(iso?: string | null) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return '—'
  }
}

/** One short line per event — no multi-field dumps that read like a day digest. */
function auditPreviewLine(
  entry: AuditRow,
  namesMap: Record<string, string>,
): { who: string; text: string } {
  const plain = formatAuditPlain(entry, namesMap)
  if (entry.action === 'system_updated') {
    const parts = plain.text.split('. ').filter(Boolean)
    const text = parts.length > 1 ? `Updated ${parts.length} fields on this asset` : parts[0] || 'Updated asset details'
    return { who: plain.who, text }
  }
  const text = plain.text.includes('. ') ? plain.text.split('. ')[0] : plain.text
  return { who: plain.who, text }
}

export function AssetPreview({ asset, orgId }: Props) {
  const [busy, setBusy] = useState(true)
  const [assessments, setAssessments] = useState<AssessmentRow[]>([])
  const [ctrlTotal, setCtrlTotal] = useState(0)
  const [ctrlDone, setCtrlDone] = useState(0)
  const [connStatus, setConnStatus] = useState<string | null>(asset.connection_status || null)
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [auditNames, setAuditNames] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    const id = asset.id

    async function load() {
      setBusy(true)
      setAssessments([])
      setCtrlTotal(0)
      setCtrlDone(0)
      setAudit([])
      setAuditNames({})
      setConnStatus(asset.connection_status || null)

      const slug = asset.provider_slug || ''
      const [{ data: assessRows }, { data: auditRows }, connRes] = await Promise.all([
        sb
          .from('registry_assessments')
          .select('id,status,overall_score,requested_at,completed_at')
          .eq('system_id', id)
          .order('requested_at', { ascending: false })
          .limit(3),
        sb
          .from('registry_audit_log')
          .select('id,action,created_at,user_id,changes')
          .eq('entity_id', id)
          .order('created_at', { ascending: false })
          .limit(5),
        slug
          ? sb
              .from('provider_connections')
              .select('status,credential_secret_id')
              .eq('asset_id', id)
              .eq('provider_slug', slug)
              .neq('status', 'revoked')
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ])

      if (cancelled) return

      const assessmentsList = (assessRows as AssessmentRow[]) || []
      setAssessments(assessmentsList)

      const conn = connRes.data as { status?: string | null; credential_secret_id?: string | null } | null
      if (conn) {
        const connected = !!conn.credential_secret_id || conn.status === 'connected'
        setConnStatus(connected ? 'connected' : conn.status || null)
      } else if (!asset.connection_status) {
        setConnStatus(null)
      }

      const { data: sysAssign } = await sb
        .from('control_assignments')
        .select('id,status,system_id')
        .eq('system_id', id)
        .eq('org_id', orgId)
      if (cancelled) return

      let allCtrl = (sysAssign as ControlRow[]) || []
      if (assessmentsList.length) {
        const { data: orgAssign } = await sb
          .from('control_assignments')
          .select('id,status,system_id')
          .eq('org_id', orgId)
          .is('system_id', null)
        if (cancelled) return
        allCtrl = allCtrl.concat((orgAssign as ControlRow[]) || [])
      }
      setCtrlTotal(allCtrl.length)
      setCtrlDone(allCtrl.filter((c) => c.status === 'implemented' || c.status === 'verified').length)

      const entries = (auditRows as AuditRow[]) || []
      setAudit(entries)
      const userIds = [...new Set(entries.map((e) => e.user_id).filter(Boolean) as string[])]
      if (userIds.length) {
        const { data: profiles } = await sb.from('profiles').select('id,full_name,email').in('id', userIds)
        if (cancelled) return
        const map: Record<string, string> = {}
        for (const p of profiles || []) map[p.id] = p.full_name || p.email || 'Unknown'
        setAuditNames(map)
      } else {
        setAuditNames({})
      }

      setBusy(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [asset.id, asset.provider_slug, asset.connection_status, orgId])

  const latest = assessments[0]
  const provider = (asset.provider_slug || '').trim()
  const model = modelDisplayName(provider, asset.model_name)
  const href = (tab: 'overview' | 'assessment' | 'controls' | 'connection' | 'audit') => {
    if (tab === 'overview') return `/registry/${asset.id}`
    return `/registry/${asset.id}?tab=${tab}`
  }

  return (
    <div className={styles.root}>
      {/* No "Overview" chrome — drawer already is the preview. Description is primary body. */}
      <section className={styles.block}>
        <div className={styles.descBlock}>
          <div className={styles.metaLabel}>Description</div>
          {asset.description ? (
            <p className={styles.desc}>{asset.description}</p>
          ) : (
            <p className={styles.muted}>No description.</p>
          )}
        </div>
        <dl className={styles.meta}>
          <div>
            <dt>Business owner</dt>
            <dd>{asset.business_owner_name || asset.system_owner || '—'}</dd>
          </div>
          <div>
            <dt>Compliance / risk</dt>
            <dd>{asset.compliance_owner_name || '—'}</dd>
          </div>
          <div>
            <dt>Technical / model</dt>
            <dd>{asset.technical_owner_name || '—'}</dd>
          </div>
          <div>
            <dt>Department</dt>
            <dd>{asset.department || '—'}</dd>
          </div>
          <div>
            <dt>Provider</dt>
            <dd className={styles.providerRow}>
              {provider ? <BrandIcon slug={provider} size={14} title={labelProvider(provider)} /> : null}
              <span>{provider ? labelProvider(provider) : '—'}</span>
            </dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{model || '—'}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd className={styles.date}>{fmtWhen(asset.updated_at || asset.created_at)}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h3 className={styles.blockTitle}>Assessment</h3>
          <Link className={styles.blockLink} to={href('assessment')}>
            Open
            <Icon icon={ChevronRight} size="sm" />
          </Link>
        </div>
        {busy && !latest ? (
          <p className={styles.muted}>Loading…</p>
        ) : latest ? (
          <p className={styles.row}>
            <span className={styles.value}>{labelAssessStatus(latest.status)}</span>
            <span className={styles.date}>{fmtWhen(latest.completed_at || latest.requested_at)}</span>
          </p>
        ) : (
          <p className={styles.muted}>No assessments yet.</p>
        )}
      </section>

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h3 className={styles.blockTitle}>Controls</h3>
          <Link className={styles.blockLink} to={href('controls')}>
            Open
            <Icon icon={ChevronRight} size="sm" />
          </Link>
        </div>
        {busy && ctrlTotal === 0 ? (
          <p className={styles.muted}>Loading…</p>
        ) : ctrlTotal === 0 ? (
          <p className={styles.muted}>No controls assigned.</p>
        ) : (
          <p className={styles.value}>{ctrlDone} of {ctrlTotal} completed</p>
        )}
      </section>

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h3 className={styles.blockTitle}>Connection</h3>
          <Link className={styles.blockLink} to={href('connection')}>
            Open
            <Icon icon={ChevronRight} size="sm" />
          </Link>
        </div>
        <p className={styles.connRow}>
          {provider ? <BrandIcon slug={provider} size={14} title={labelProvider(provider)} /> : null}
          <span className={styles.value}>{provider ? labelProvider(provider) : 'No provider'}</span>
          <StatusLabel badge tone={connStatus === 'connected' ? 'ok' : 'warn'}>
            {connectionLabel(connStatus)}
          </StatusLabel>
        </p>
      </section>

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <h3 className={styles.blockTitle}>Audit log</h3>
          <Link className={styles.blockLink} to={href('audit')}>
            Open
            <Icon icon={ChevronRight} size="sm" />
          </Link>
        </div>
        {busy && audit.length === 0 ? (
          <p className={styles.muted}>Loading…</p>
        ) : audit.length === 0 ? (
          <p className={styles.muted}>No activity yet.</p>
        ) : (
          <div className={styles.auditStack}>
            {audit.map((entry) => {
              const { who, text } = auditPreviewLine(entry, auditNames)
              return (
                <div key={entry.id} className={styles.auditRow}>
                  <p className={styles.auditAction}>{text}</p>
                  <div className={styles.auditMeta}>
                    <span>{who}</span>
                    <span className={styles.date}>{fmtWhen(entry.created_at)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

/** Header badges for the preview drawer chrome */
export function AssetPreviewMeta({ asset }: { asset: RegistryAsset }) {
  return (
    <>
      <StatusLabel badge tone={riskTone(asset.risk_tier)}>
        {labelTier(asset.risk_tier)}
      </StatusLabel>
      <span className={styles.metaKind}>{labelLifecycle(asset.lifecycle)}</span>
    </>
  )
}
