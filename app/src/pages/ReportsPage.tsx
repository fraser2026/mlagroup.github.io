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
import { EdgeError, invokeEdge } from '../lib/edge'
import { canManageMembers, canUseGovernanceDossier } from '../lib/org'
import { fmtDate } from '../lib/rpc'
import { sb } from '../lib/supabase'
import {
  DossierAuditDrawer,
  DossierPreviewOverlay,
  DossierSignDrawer,
  fmtDateTimeUtc,
} from './DossierReview'
import type { DossierAudit } from './DossierReview'
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

type DossierStatus = {
  version_id: string
  dossier_id: string
  snapshot_hash: string
  catalogue_hash?: string | null
  status: 'ready_for_review' | 'ready_for_signoff' | 'signed'
  signed_at?: string | null
  reviewed_at?: string | null
  created_at?: string | null
  signer?: { name?: string; role?: string } | null
}

type SignedDossier = {
  version_id: string
  dossier_id: string
  snapshot_hash: string
  signed_at?: string | null
  signer?: { name?: string | null; role?: string | null } | null
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

async function buildDossierPreviewUrl(snapshot: Record<string, unknown>) {
  const res = await fetch('/dossier-template.html')
  if (!res.ok) throw new Error('Could not load dossier template for preview.')
  let html = await res.text()
  const injection = `const DOSSIER_DATA = ${JSON.stringify(snapshot)};`
  if (!html.includes('/*__DOSSIER_DATA__*/')) {
    throw new Error('Dossier template is missing the data injection marker.')
  }
  html = html.replace('/*__DOSSIER_DATA__*/', injection)
  // Blob URLs have no path, so relative assets (cover swoosh) need an explicit base.
  html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${window.location.origin}/legacy/">`)
  return URL.createObjectURL(new Blob([html], { type: 'text/html' }))
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
  const [error, setError] = useState('')

  const [dossier, setDossier] = useState<DossierStatus | null>(null)
  const [dossierBusy, setDossierBusy] = useState(false)
  const [dossierNotice, setDossierNotice] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewMeta, setPreviewMeta] = useState<{
    version_id: string
    dossier_id: string
    snapshot_hash: string
  } | null>(null)
  const [signOpen, setSignOpen] = useState(false)
  const [signBusy, setSignBusy] = useState(false)
  const [signError, setSignError] = useState('')
  const [signedDossiers, setSignedDossiers] = useState<SignedDossier[]>([])
  const [rowBusy, setRowBusy] = useState<string | null>(null)
  const [auditOpen, setAuditOpen] = useState(false)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState('')
  const [audit, setAudit] = useState<DossierAudit | null>(null)

  const dossierOk = canUseGovernanceDossier(org)
  const canExportDossier = dossierOk && canManageMembers(role)

  usePageChrome({ title: 'Reports', breadcrumbs: [{ label: 'Reports' }] })

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.location.hash === '#dossier') {
      document.getElementById('dossier')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [loading])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const loadDossierStatus = useCallback(async () => {
    if (!session?.access_token || !org?.id || !canExportDossier) {
      setDossier(null)
      setSignedDossiers([])
      return
    }
    const token = session.access_token
    const [statusRes, listRes] = await Promise.allSettled([
      invokeEdge<{ dossier?: DossierStatus | null }>(
        'generate-dossier',
        { org_id: org.id, action: 'status' },
        token,
      ),
      invokeEdge<{ dossiers?: SignedDossier[] }>(
        'generate-dossier',
        { org_id: org.id, action: 'list' },
        token,
      ),
    ])
    if (statusRes.status === 'fulfilled') setDossier(statusRes.value.dossier || null)
    if (listRes.status === 'fulfilled') setSignedDossiers(listRes.value.dossiers || [])
  }, [session?.access_token, org?.id, canExportDossier])

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

  useEffect(() => {
    void loadDossierStatus()
  }, [loadDossierStatus])

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

  function closePreview() {
    setPreviewOpen(false)
    setSignOpen(false)
    setSignError('')
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }
  }

  async function reviewDossier() {
    if (!session?.access_token || !org?.id) return
    setDossierBusy(true)
    setError('')
    setDossierNotice('Assembling the current workspace snapshot for review…')
    try {
      const data = await invokeEdge<{
        version_id?: string
        dossier_id?: string
        snapshot_hash?: string
        status?: string
        snapshot?: Record<string, unknown>
        download_url?: string
        already_signed?: boolean
      }>('generate-dossier', { org_id: org.id, action: 'assemble' }, session.access_token)

      if (data.already_signed || data.status === 'signed') {
        setDossierNotice(
          `${data.dossier_id ? `Dossier ${data.dossier_id}` : 'This version'} is already signed and listed under Signed dossiers. A new version is created when your workspace changes.`,
        )
        await loadDossierStatus()
        return
      }

      if (!data.snapshot || !data.version_id || !data.dossier_id || !data.snapshot_hash) {
        throw new Error('Dossier snapshot was incomplete.')
      }

      const url = await buildDossierPreviewUrl(data.snapshot)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(url)
      setPreviewMeta({
        version_id: data.version_id,
        dossier_id: data.dossier_id,
        snapshot_hash: data.snapshot_hash,
      })
      setPreviewOpen(true)
      setDossierNotice('')
      void invokeEdge(
        'generate-dossier',
        { org_id: org.id, action: 'record_view', version_id: data.version_id },
        session.access_token,
      ).catch(() => {})
      await loadDossierStatus()
    } catch (e) {
      setDossierNotice('')
      setError(e instanceof Error ? e.message : 'Could not prepare dossier for review.')
    } finally {
      setDossierBusy(false)
    }
  }

  async function downloadSigned(versionId: string) {
    if (!session?.access_token || !org?.id) return
    setRowBusy(versionId)
    setError('')
    try {
      const data = await invokeEdge<{ download_url?: string }>(
        'generate-dossier',
        { org_id: org.id, action: 'download', version_id: versionId },
        session.access_token,
      )
      if (!data.download_url) throw new Error('Signed dossier is not available yet.')
      window.open(data.download_url, '_blank')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed.')
    } finally {
      setRowBusy(null)
    }
  }

  async function openAudit(versionId: string) {
    if (!session?.access_token || !org?.id) return
    setAuditOpen(true)
    setAuditLoading(true)
    setAuditError('')
    setAudit(null)
    try {
      const data = await invokeEdge<DossierAudit>(
        'generate-dossier',
        { org_id: org.id, action: 'audit', version_id: versionId },
        session.access_token,
      )
      setAudit({ version: data.version, signature: data.signature, events: data.events || [] })
    } catch (e) {
      setAuditError(e instanceof Error ? e.message : 'Could not load audit trail.')
    } finally {
      setAuditLoading(false)
    }
  }

  async function submitSignature(input: {
    signatory_name: string
    signatory_role: string
    signature_svg: string
    confirmed: boolean
  }) {
    if (!session?.access_token || !org?.id || !previewMeta) return
    setSignBusy(true)
    setSignError('')
    try {
      const data = await invokeEdge<{
        download_url?: string
        dossier_id?: string
        signed_at?: string
      }>('generate-dossier', {
        org_id: org.id,
        action: 'sign',
        version_id: previewMeta.version_id,
        ...input,
      }, session.access_token)

      setSignOpen(false)
      closePreview()
      setDossierNotice(
        data.dossier_id
          ? `Dossier ${data.dossier_id} signed and finalised.`
          : 'Dossier signed and finalised.',
      )
      await loadDossierStatus()
      if (data.download_url) window.open(data.download_url, '_blank')
    } catch (e) {
      if (e instanceof EdgeError && e.code === 'dossier_changed') {
        setSignError(e.message)
        setSignOpen(false)
        closePreview()
        setError(e.message)
        await loadDossierStatus()
      } else {
        setSignError(e instanceof Error ? e.message : 'Could not finalise signature.')
      }
    } finally {
      setSignBusy(false)
    }
  }

  const defaultSignerName =
    profile?.full_name || user?.email?.split('@')[0] || ''
  const defaultSignerRole =
    role === 'owner' ? 'Organisation owner' : role === 'admin' ? 'Organisation admin' : ''

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

  const hasPendingVersion = !!dossier && dossier.status !== 'signed'

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
          <>
            <div className={styles.dossierCard}>
              <div className={styles.dossierCopy}>
                <div className={styles.dossierTitleRow}>
                  <div className={styles.dossierTitle}>{org?.name || 'Organisation'}</div>
                  {hasPendingVersion ? (
                    <StatusLabel tone="neutral">Ready for sign-off</StatusLabel>
                  ) : null}
                </div>
                <p className={styles.dossierBody}>
                  Review the complete dossier before sign-off. The signed PDF is generated only after
                  you approve a specific version.
                </p>
              </div>
              <div className={styles.dossierAction}>
                <Button
                  className={styles.dossierButton}
                  pending={dossierBusy}
                  onClick={() => void reviewDossier()}
                >
                  {dossierBusy ? 'Preparing…' : 'Review Dossier'}
                </Button>
              </div>
            </div>

            {signedDossiers.length ? (
              <div className={styles.signedList}>
                <h3 className={styles.signedHeading}>Signed dossiers</h3>
                <Ledger>
                  {signedDossiers.map((d) => (
                    <LedgerRow
                      key={d.version_id}
                      title={d.dossier_id}
                      description={[
                        `Signed ${fmtDateTimeUtc(d.signed_at)}`,
                        [d.signer?.name, d.signer?.role].filter(Boolean).join(', '),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      meta={
                        <div className={styles.meta}>
                          <StatusLabel tone="ok">Signed</StatusLabel>
                          <div className={styles.actions}>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void openAudit(d.version_id)}
                            >
                              Audit trail
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              pending={rowBusy === d.version_id}
                              onClick={() => void downloadSigned(d.version_id)}
                            >
                              PDF
                            </Button>
                          </div>
                        </div>
                      }
                    />
                  ))}
                </Ledger>
              </div>
            ) : null}
          </>
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
                        <span className={styles.scoreNum}>{r.adjusted_score ?? '—'}</span>
                        <StatusLabel tone={bandTone(band)}>
                          {BAND_LABELS[band] || band}
                        </StatusLabel>
                      </div>
                      <div className={styles.actions}>
                        {paid ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            pending={pdfBusy === r.id}
                            onClick={() => void savePdf(r.id)}
                          >
                            PDF
                          </Button>
                        ) : (
                          <Link to="/plans">
                            <Button size="sm" variant="ghost">
                              Unlock
                            </Button>
                          </Link>
                        )}
                      </div>
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
            title="No assessments yet"
            body="Run an assessment from an AI asset to produce a system report."
            action={
              <Link to="/registry">
                <Button>Open registry</Button>
              </Link>
            }
          />
        ) : (
          <Ledger>
            {assessments.map((a) => {
              const band = a.risk_band || ''
              const name = (a.system_id && sysNames[a.system_id]) || 'AI system'
              return (
                <LedgerRow
                  key={a.id}
                  title={name}
                  description={`${fmtDate(a.requested_at)}${a.sector ? ` · ${a.sector}` : ''}`}
                  meta={
                    <div className={styles.meta}>
                      <div className={styles.score}>
                        <span className={styles.scoreNum}>{a.overall_score ?? '—'}</span>
                        {band ? (
                          <StatusLabel tone={bandTone(band)}>
                            {BAND_LABELS[band] || band}
                          </StatusLabel>
                        ) : null}
                      </div>
                      <div className={styles.actions}>
                        <a
                          href={`/legacy/system-report.html?aid=${encodeURIComponent(a.id)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Button size="sm" variant="ghost">
                            Open
                          </Button>
                        </a>
                      </div>
                    </div>
                  }
                />
              )
            })}
          </Ledger>
        )}
      </Section>

      <DossierPreviewOverlay
        open={previewOpen}
        dossierId={previewMeta?.dossier_id || ''}
        snapshotHash={previewMeta?.snapshot_hash || ''}
        iframeUrl={previewUrl}
        busy={signBusy}
        onClose={() => {
          if (signOpen || signBusy) return
          closePreview()
        }}
        onSign={() => {
          setSignError('')
          setSignOpen(true)
        }}
      />

      <DossierSignDrawer
        open={signOpen}
        defaultName={defaultSignerName}
        defaultRole={defaultSignerRole}
        pending={signBusy}
        error={signError}
        onClose={() => {
          if (!signBusy) {
            setSignOpen(false)
            setSignError('')
          }
        }}
        onSubmit={(input) => void submitSignature(input)}
      />

      <DossierAuditDrawer
        open={auditOpen}
        loading={auditLoading}
        error={auditError}
        audit={audit}
        onClose={() => setAuditOpen(false)}
      />
    </PageFrame>
  )
}
