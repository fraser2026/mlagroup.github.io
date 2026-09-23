import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BrandLoader,
  Button,
  EmptyState,
  Ledger,
  LedgerRow,
  Notice,
  PageFrame,
  PageHeader,
  Section,
  StatusLabel,
} from '../ui'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { MARKETING_ORIGIN } from '../lib/config'
import { invokeEdge } from '../lib/edge'
import { canManageMembers, canUseGovernanceDossier } from '../lib/org'
import { fmtDate } from '../lib/rpc'
import { sb } from '../lib/supabase'
import styles from './ReportsPage.module.css'

type Diagnostic = {
  id: string
  organisation?: string | null
  sector?: string | null
  created_at?: string | null
  adjusted_score?: number | null
  risk_band?: string | null
}

type Assessment = {
  id: string
  system_id?: string | null
  requested_at?: string | null
  sector?: string | null
  overall_score?: number | null
  risk_band?: string | null
  questionnaire_version?: string | null
}

const BAND_LABELS: Record<string, string> = {
  high: 'High risk',
  medium: 'Medium risk',
  moderate: 'Moderate risk',
  lowmod: 'Low-moderate',
  low: 'Low risk',
  critical: 'Critical',
}

function bandTone(band?: string | null) {
  if (band === 'critical' || band === 'high') return 'risk' as const
  if (band === 'medium' || band === 'moderate') return 'warn' as const
  if (band === 'low' || band === 'lowmod') return 'ok' as const
  return 'neutral' as const
}

export function ReportsPage() {
  const { org, user, session, isPaidTier, profile, role } = useAuth()
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [sysNames, setSysNames] = useState<Record<string, string>>({})
  const [paidIds, setPaidIds] = useState<Set<string>>(new Set())
  const [isPaid, setIsPaid] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pdfBusy, setPdfBusy] = useState<string | null>(null)
  const [dossierBusy, setDossierBusy] = useState(false)
  const [dossierNotice, setDossierNotice] = useState('')
  const [error, setError] = useState('')

  const dossierOk = canUseGovernanceDossier(org)
  const canExportDossier = dossierOk && canManageMembers(role)

  usePageChrome({ title: 'Reports', breadcrumbs: [{ label: 'Reports' }] })

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.location.hash === '#dossier') {
      document.getElementById('dossier')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [loading])

  const load = useCallback(async () => {
    if (!user?.id) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const [{ data: results }, { data: entitlements }] = await Promise.all([
        sb
          .from('diagnostic_results')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        sb
          .from('entitlements')
          .select('id,diagnostic_id,status')
          .eq('user_id', user.id)
          .eq('status', 'active'),
      ])
      const ents = entitlements || []
      const ids = new Set(ents.map((e) => e.diagnostic_id).filter(Boolean) as string[])
      setPaidIds(ids)
      setIsPaid(ents.length > 0 || profile?.paid === true)
      setDiagnostics((results as Diagnostic[]) || [])

      if (org?.id) {
        const [{ data: assess }, { data: systems }] = await Promise.all([
          sb
            .from('registry_assessments')
            .select('*')
            .eq('org_id', org.id)
            .order('requested_at', { ascending: false }),
          sb.from('ai_systems').select('id,name').eq('org_id', org.id).is('deleted_at', null),
        ])
        setAssessments((assess as Assessment[]) || [])
        const names: Record<string, string> = {}
        ;(systems || []).forEach((s: { id: string; name?: string }) => {
          names[s.id] = s.name || 'AI system'
        })
        setSysNames(names)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load reports.')
    } finally {
      setLoading(false)
    }
  }, [user?.id, org?.id, profile?.paid])

  useEffect(() => {
    void load()
  }, [load])

  function canViewDiagnostic(id: string) {
    return isPaid || isPaidTier || paidIds.has(id)
  }

  async function savePdf(resultId: string) {
    if (!session?.access_token) return
    setPdfBusy(resultId)
    setError('')
    try {
      const data = await invokeEdge<{ download_url?: string }>(
        'generate-report',
        { response_id: resultId },
        session.access_token,
      )
      if (!data?.download_url) throw new Error('No download URL returned.')
      window.open(data.download_url, '_blank')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF generation failed.')
    } finally {
      setPdfBusy(null)
    }
  }

  async function downloadDossier() {
    if (!session?.access_token || !org?.id) return
    setDossierBusy(true)
    setError('')
    setDossierNotice('Assembling workspace snapshot and rendering PDF. This can take up to a minute.')
    try {
      const data = await invokeEdge<{
        download_url?: string
        dossier_id?: string
        catalogue_hash?: string
        snapshot_hash?: string
      }>('generate-dossier', { org_id: org.id }, session.access_token)
      if (!data?.download_url) throw new Error('No download URL returned.')
      const parts = [
        data.dossier_id ? `Dossier ${data.dossier_id} ready` : 'Dossier ready',
        data.catalogue_hash ? `catalogue ${data.catalogue_hash}` : null,
      ].filter(Boolean)
      setDossierNotice(`${parts.join(' · ')}. Opening download…`)
      window.open(data.download_url, '_blank')
    } catch (e) {
      setDossierNotice('')
      setError(e instanceof Error ? e.message : 'Dossier generation failed.')
    } finally {
      setDossierBusy(false)
    }
  }

  if (loading) {
    return (
      <PageFrame>
        <PageHeader
          title="Reports"
          description="Governance records, assessments, and diagnostic reports."
        />
        <BrandLoader fill label="Loading reports" />
      </PageFrame>
    )
  }

  return (
    <PageFrame
      railItems={[
        { id: 'dossier', label: 'Dossier' },
        { id: 'diagnostic', label: 'Diagnostics' },
        { id: 'assessments', label: 'Assessments' },
      ]}
    >
      <PageHeader
        title="Reports"
        description="Governance records, assessments, and diagnostic reports."
      />

      {error ? <Notice tone="risk">{error}</Notice> : null}
      {dossierNotice && !error ? <Notice tone="quiet">{dossierNotice}</Notice> : null}

      <Section
        id="dossier"
        title="AI Governance Dossier"
        description="A point-in-time record of your AI governance, prepared for review, assurance, and procurement."
      >
        {canExportDossier ? (
          <div className={styles.dossierCard}>
            <div className={styles.dossierCopy}>
              <div className={styles.dossierTitle}>{org?.name || 'Organisation'}</div>
              <p className={styles.dossierBody}>
                Generate a dated PDF from your RegAnchor workspace, including AI assets,
                accountability, mapped requirements, controls, evidence, assessments and governance
                activity.
              </p>
            </div>
            <div className={styles.dossierAction}>
              <Button
                className={styles.dossierButton}
                pending={dossierBusy}
                onClick={() => void downloadDossier()}
              >
                {dossierBusy ? 'Generating…' : 'Governance Dossier'}
              </Button>
            </div>
          </div>
        ) : dossierOk ? (
          <Notice tone="quiet">
            AI Governance Dossier export is available to organisation owners and admins on this plan.
          </Notice>
        ) : (
          <EmptyState
            title="Professional feature"
            body="AI Governance Dossier export is included with Professional and Enterprise."
            action={
              <Link to="/plans">
                <Button>View plans</Button>
              </Link>
            }
          />
        )}
      </Section>

      <Section id="diagnostic" title="Diagnostic reports">
        {diagnostics.length === 0 ? (
          <EmptyState
            title="No diagnostic reports yet"
            body="Run a diagnostic to generate your first exposure report."
            action={
              <a href={`${MARKETING_ORIGIN}/diagnostic.html`} target="_blank" rel="noreferrer">
                <Button>Run diagnostic</Button>
              </a>
            }
          />
        ) : (
          <Ledger>
            {diagnostics.map((r) => {
              const band = r.risk_band || 'moderate'
              const paid = canViewDiagnostic(r.id)
              return (
                <LedgerRow
                  key={r.id}
                  title={r.organisation || 'Diagnostic'}
                  description={`${fmtDate(r.created_at)}${r.sector ? ` · ${r.sector}` : ''}`}
                  meta={
                    <div className={styles.meta}>
                      <div className={styles.score}>
                        <span className={styles.scoreNum}>{r.adjusted_score ?? 0}%</span>
                        <StatusLabel tone={bandTone(band)}>{BAND_LABELS[band] || band}</StatusLabel>
                      </div>
                      {paid ? (
                        <div className={styles.actions}>
                          <a href={`/legacy/report.html?rid=${r.id}`} target="_blank" rel="noreferrer">
                            <Button size="sm">View</Button>
                          </a>
                          <Button
                            variant="ghost"
                            size="sm"
                            pending={pdfBusy === r.id}
                            onClick={() => void savePdf(r.id)}
                          >
                            Download
                          </Button>
                        </div>
                      ) : (
                        <a href={`${MARKETING_ORIGIN}/pricing.html`} target="_blank" rel="noreferrer">
                          <Button size="sm">Unlock for £295</Button>
                        </a>
                      )}
                    </div>
                  }
                />
              )
            })}
          </Ledger>
        )}
      </Section>

      <Section id="assessments" title="System assessments">
        {assessments.length === 0 ? (
          <EmptyState
            title="No system assessments yet"
            body="Run an assessment from the Registry."
            action={
              <Link to="/registry">
                <Button variant="ghost">Open registry</Button>
              </Link>
            }
          />
        ) : (
          <Ledger>
            {assessments.map((a) => {
              const band = a.risk_band || 'medium'
              const sn = (a.system_id && sysNames[a.system_id]) || 'AI system'
              return (
                <LedgerRow
                  key={a.id}
                  title={sn}
                  description={`${fmtDate(a.requested_at)}${a.sector ? ` · ${a.sector}` : ''} · v${a.questionnaire_version || '1.0.0'}`}
                  meta={
                    <div className={styles.meta}>
                      <div className={styles.score}>
                        <span className={styles.scoreNum}>
                          {a.overall_score !== null && a.overall_score !== undefined
                            ? `${a.overall_score}%`
                            : 'Not set'}
                        </span>
                        <StatusLabel tone={bandTone(band)}>{BAND_LABELS[band] || band}</StatusLabel>
                      </div>
                      {isPaidTier ? (
                        <a
                          href={`/legacy/system-report.html?aid=${a.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Button size="sm">View</Button>
                        </a>
                      ) : (
                        <Link to="/plans">
                          <Button size="sm">Upgrade to view</Button>
                        </Link>
                      )}
                    </div>
                  }
                />
              )
            })}
          </Ledger>
        )}
      </Section>
    </PageFrame>
  )
}
