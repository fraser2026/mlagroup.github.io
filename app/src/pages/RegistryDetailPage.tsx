import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  BrandLoader,
  Button,
  Drawer,
  EmptyState,
  Ledger,
  LedgerRow,
  MetricStrip,
  Notice,
  PageFrame,
  PageHeader,
  ProgressMeter,
  Section,
  StatusLabel,
  Tabs,
  Timeline,
  ToastStack,
} from '../ui'
import type { ToastItem } from '../ui'
import { BrandIcon } from '../icons/BrandIcon'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { sb } from '../lib/supabase'
import { invokeEdge } from '../lib/edge'
import { GATEWAY_MESSAGES_URL } from '../lib/config'
import {
  DELETE_REASON_OPTIONS,
  actorName,
  assessmentUrl,
  auditChangesFromUpdate,
  buildAssetPayload,
  connectionLabel,
  controlCode,
  controlFamilyLabel,
  ctrlTone,
  deleteRegistryAsset,
  emptyAssetForm,
  fetchDeletePreview,
  fmtProviderTokens,
  fmtProviderUsd,
  formFromAsset,
  formatAuditPlain,
  insightsUsageFetchFailed,
  labelAssessStatus,
  labelCtrlStatus,
  labelPurpose,
  labelLifecycle,
  labelProvider,
  labelTier,
  loadProviderCatalog,
  modelDisplayName,
  riskTone,
  systemReportUrl,
  validateAssetForm,
  type AssetFormValues,
  type DeletePreview,
  type ProviderCatalogRow,
  type ProviderInsights,
  type RegistryAsset,
} from '../lib/registry'
import { AssetFormFields } from './AssetFormFields'
import styles from './RegistryDetailPage.module.css'

type Conn = {
  id: string
  provider_slug?: string | null
  status?: string | null
  last_verified_at?: string | null
  last_error?: string | null
  credential_secret_id?: string | null
  admin_credential_secret_id?: string | null
  metadata?: {
    insights?: ProviderInsights
    capabilities?: {
      governance_tier?: string
      encouragement?: string
      limitations?: string[]
      capabilities?: { key?: string; label?: string; description?: string; available?: boolean }[]
      models_count?: number
    }
  } | null
}

type OrgCred = {
  id: string
  admin_credential_secret_id?: string | null
  last_verified_at?: string | null
  connected_at?: string | null
}

type GatewayToken = {
  id: string
  label?: string | null
  revoked_at?: string | null
  created_at?: string | null
}

type UsageEvent = {
  id: number
  model?: string | null
  input_tokens?: number | null
  output_tokens?: number | null
  created_at?: string | null
}

type Assessment = {
  id: string
  status?: string | null
  overall_score?: number | null
  risk_band?: string | null
  sector?: string | null
  requested_at?: string | null
  completed_at?: string | null
  client_notes?: string | null
  mla_notes?: string | null
  requested_by?: string | null
  completed_by?: string | null
  section_scores?: Record<string, { title?: string; score?: number }> | null
  tier_validation?: { mismatch?: boolean; message?: string } | null
}

type ControlAssign = {
  id: string
  status?: string | null
  control_id?: string | null
  system_id?: string | null
  governance_controls?: {
    title?: string | null
    control_number?: string | null
    control_type?: string | null
  } | null
}

type AuditEntry = {
  id: string
  action?: string | null
  created_at?: string | null
  user_id?: string | null
  changes?: Record<string, unknown> | null
}

const DETAIL_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'assessment', label: 'Assessment' },
  { id: 'controls', label: 'Controls' },
  { id: 'connection', label: 'Connection' },
  { id: 'audit', label: 'Audit log' },
]

const BAND_LABELS: Record<string, string> = {
  high: 'High Risk',
  medium: 'Medium Risk',
  low: 'Low Risk',
}

function parseDetailTab(sp: URLSearchParams): string {
  const tabParam = (sp.get('tab') || '').toLowerCase()
  if (DETAIL_TABS.some((t) => t.id === tabParam)) return tabParam
  // Legacy spike deep links land on Connection
  if ((sp.get('module') || '').toLowerCase() === 'operate') return 'connection'
  return 'overview'
}

export function RegistryDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { session, org, profile, canWriteRegistry, canDeleteRegistry, isPaidTier } = useAuth()
  const [asset, setAsset] = useState<RegistryAsset | null>(null)
  const [tab, setTab] = useState(() => parseDetailTab(searchParams))
  const [loading, setLoading] = useState(true)
  const [conn, setConn] = useState<Conn | null>(null)
  const [orgCred, setOrgCred] = useState<OrgCred | null>(null)
  const [tokens, setTokens] = useState<GatewayToken[]>([])
  const [usage, setUsage] = useState<UsageEvent[]>([])
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [controls, setControls] = useState<ControlAssign[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [auditNames, setAuditNames] = useState<Record<string, string>>({})
  const [apiKey, setApiKey] = useState('')
  const [tokenLabel, setTokenLabel] = useState('')
  const [onceToken, setOnceToken] = useState('')
  const [insightsWindow, setInsightsWindow] = useState(30)
  const [error, setError] = useState('')
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [busy, setBusy] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<AssetFormValues>(emptyAssetForm())
  const [editError, setEditError] = useState('')
  const [editBusy, setEditBusy] = useState(false)
  const [providers, setProviders] = useState<ProviderCatalogRow[]>([])
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePreview, setDeletePreview] = useState<DeletePreview | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [deleteError, setDeleteError] = useState('')

  const name = asset?.name || 'Asset'
  const actor = actorName(profile, session?.user?.email)

  function pushToast(text: string) {
    if (!text.trim()) return
    const tid =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `t-${Date.now()}-${Math.random().toString(16).slice(2)}`
    setToasts((prev) => [...prev, { id: tid, text }])
  }

  function dismissToast(toastId: string) {
    setToasts((prev) => prev.filter((t) => t.id !== toastId))
  }

  useEffect(() => {
    setTab(parseDetailTab(searchParams))
  }, [searchParams])

  usePageChrome({
    title: name,
    breadcrumbs: [{ label: 'Registry', to: '/registry' }, { label: name }],
  })

  async function refresh() {
    if (!id || !session || !org?.id) return
    setLoading(true)
    setError('')
    const { data } = await sb
      .from('ai_systems')
      .select(
        'id,name,asset_kind,risk_tier,risk_tier_rationale,lifecycle,description,provider_slug,model_name,vendor,department,system_owner,purpose_category,system_type,notes,created_at,updated_at',
      )
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()

    if (!data) {
      setAsset(null)
      setLoading(false)
      return
    }
    const sys = data as RegistryAsset
    setAsset(sys)

    const connectorSlug = sys.provider_slug || ''
    const [{ data: assessmentsRows }, { data: auditRows }, connRes, orgCredRes, { data: usageRows }] =
      await Promise.all([
        sb
          .from('registry_assessments')
          .select('*')
          .eq('system_id', id)
          .order('requested_at', { ascending: false }),
        sb.from('registry_audit_log').select('*').eq('entity_id', id).order('created_at', { ascending: false }),
        connectorSlug
          ? sb
              .from('provider_connections')
              .select(
                'id,status,provider_slug,last_verified_at,last_error,credential_secret_id,admin_credential_secret_id,metadata',
              )
              .eq('asset_id', id)
              .eq('provider_slug', connectorSlug)
              .neq('status', 'revoked')
              .maybeSingle()
          : Promise.resolve({ data: null }),
        connectorSlug && org.id
          ? sb
              .from('org_provider_credentials')
              .select('id,admin_credential_secret_id,last_verified_at,connected_at')
              .eq('org_id', org.id)
              .eq('provider_slug', connectorSlug)
              .neq('status', 'revoked')
              .maybeSingle()
          : Promise.resolve({ data: null }),
        sb
          .from('asset_usage_events')
          .select('id,model,input_tokens,output_tokens,created_at')
          .eq('asset_id', id)
          .order('created_at', { ascending: false })
          .limit(20),
      ])

    setAssessments((assessmentsRows as Assessment[]) || [])
    setAudit((auditRows as AuditEntry[]) || [])
    setConn((connRes.data as Conn) || null)
    setOrgCred((orgCredRes.data as OrgCred) || null)
    setUsage((usageRows as UsageEvent[]) || [])

    const userIds = [
      ...((auditRows || []).map((e: AuditEntry) => e.user_id).filter(Boolean) as string[]),
      ...((assessmentsRows || []).map((a: Assessment) => a.requested_by).filter(Boolean) as string[]),
      ...((assessmentsRows || []).map((a: Assessment) => a.completed_by).filter(Boolean) as string[]),
    ]
    if (userIds.length) {
      const { data: profiles } = await sb.from('profiles').select('id,full_name,email').in('id', [...new Set(userIds)])
      const map: Record<string, string> = {}
      for (const p of profiles || []) map[p.id] = p.full_name || p.email || 'Unknown'
      setAuditNames(map)
    } else setAuditNames({})

    // Controls for this system (+ org-level if assessed)
    const { data: sysAssign } = await sb
      .from('control_assignments')
      .select('id,status,control_id,system_id,governance_controls(title,control_number,control_type)')
      .eq('system_id', id)
      .eq('org_id', org.id)
    let allCtrl = (sysAssign as ControlAssign[]) || []
    if ((assessmentsRows || []).length) {
      const { data: orgAssign } = await sb
        .from('control_assignments')
        .select('id,status,control_id,system_id,governance_controls(title,control_number,control_type)')
        .eq('org_id', org.id)
        .is('system_id', null)
      allCtrl = allCtrl.concat((orgAssign as ControlAssign[]) || [])
    }
    setControls(allCtrl)

    if (session.access_token && sys.provider_slug === 'anthropic') {
      try {
        const tokenRes = await invokeEdge<{ tokens?: GatewayToken[] }>(
          'asset-gateway-token',
          { action: 'list', asset_id: id },
          session.access_token,
        )
        setTokens(Array.isArray(tokenRes.tokens) ? tokenRes.tokens : [])
      } catch {
        setTokens([])
      }
    } else {
      setTokens([])
    }

    const insights = (connRes.data as Conn | null)?.metadata?.insights
    if (insights?.window_days) setInsightsWindow(insights.window_days)

    setLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [id, session, org?.id])

  useEffect(() => {
    void loadProviderCatalog().then(setProviders)
  }, [])

  const activeTokens = tokens.filter((t) => !t.revoked_at)
  const connected = !!conn?.credential_secret_id || conn?.status === 'connected'
  const provider = asset?.provider_slug || ''
  const providerRow = providers.find((p) => p.slug === provider)
  const connectorReady = !!providerRow?.connector_available
  const isAnthropic = provider === 'anthropic'
  const hasOrgAdmin = !!orgCred?.admin_credential_secret_id
  const hasLegacyAdmin = !!conn?.admin_credential_secret_id
  const hasAdmin = hasOrgAdmin || hasLegacyAdmin
  const insights = conn?.metadata?.insights
  const inputTotal = usage.reduce((n, u) => n + (u.input_tokens || 0), 0)
  const outputTotal = usage.reduce((n, u) => n + (u.output_tokens || 0), 0)
  const ctrlDone = controls.filter((c) => c.status === 'implemented' || c.status === 'verified').length
  const ctrlPct = controls.length ? Math.round((ctrlDone / controls.length) * 100) : 0
  const controlsOrdered = useMemo(() => {
    return [...controls].sort((a, b) => {
      const na = Number(a.governance_controls?.control_number)
      const nb = Number(b.governance_controls?.control_number)
      const aN = Number.isFinite(na) ? na : 999
      const bN = Number.isFinite(nb) ? nb : 999
      if (aN !== bN) return aN - bN
      return (a.governance_controls?.title || '').localeCompare(b.governance_controls?.title || '')
    })
  }, [controls])
  const controlGroups = useMemo(() => {
    const order = ['organisation', 'system', 'assurance'] as const
    const buckets = new Map<string, ControlAssign[]>()
    for (const c of controlsOrdered) {
      const key = (c.governance_controls?.control_type || 'system').toLowerCase()
      const list = buckets.get(key) || []
      list.push(c)
      buckets.set(key, list)
    }
    return order
      .filter((k) => (buckets.get(k) || []).length > 0)
      .map((k) => ({ key: k, label: controlFamilyLabel(k), items: buckets.get(k) || [] }))
  }, [controlsOrdered])

  function openEdit() {
    if (!asset || !canWriteRegistry) return
    setEditForm(formFromAsset(asset))
    setEditError('')
    setEditOpen(true)
  }

  async function submitEdit() {
    if (!session?.user || !org?.id || !asset) return
    const v = validateAssetForm(editForm)
    if (v) {
      setEditError(v)
      return
    }
    setEditBusy(true)
    setEditError('')
    const payload = buildAssetPayload(editForm, org.id, session.user.id)
    const { error: err } = await sb.from('ai_systems').update(payload).eq('id', asset.id)
    if (err) {
      setEditBusy(false)
      setEditError(err.message)
      return
    }
    const changes = auditChangesFromUpdate(asset, payload, actor)
    await sb.from('registry_audit_log').insert({
      org_id: org.id,
      user_id: session.user.id,
      action: 'system_updated',
      entity_type: 'ai_system',
      entity_id: asset.id,
      changes,
    })
    setEditBusy(false)
    setEditOpen(false)
    pushToast('Asset updated.')
    await refresh()
  }

  async function openDelete() {
    if (!asset || !canDeleteRegistry) return
    setDeleteReason('')
    setDeleteConfirmName('')
    setDeleteError('')
    setDeletePreview(null)
    setDeleteOpen(true)
    try {
      const preview = await fetchDeletePreview(asset.id)
      if (!preview.ok) throw new Error(preview.error || 'Unable to load delete preview.')
      setDeletePreview(preview)
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Unable to load delete preview.')
    }
  }

  async function confirmDelete() {
    if (!asset) return
    if (!deleteReason.trim()) {
      setDeleteError('Select a reason.')
      return
    }
    setBusy('delete')
    setDeleteError('')
    try {
      const data = await deleteRegistryAsset({
        systemId: asset.id,
        reason: deleteReason.trim(),
        confirmName: deleteConfirmName.trim() || null,
      })
      if (!data.ok) throw new Error(data.error || 'Delete failed.')
      setDeleteOpen(false)
      if (data.mode === 'review_requested') {
        pushToast('Deletion request submitted. RegAnchor will review before this asset is removed.')
        await refresh()
      } else {
        navigate('/registry')
      }
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Delete failed.')
    } finally {
      setBusy('')
    }
  }

  async function connectRuntime() {
    if (!id || !session?.access_token || !provider) return
    const key = apiKey.trim()
    if (!key) {
      setError('Paste a runtime API key first.')
      return
    }
    setBusy('connect')
    setError('')
    pushToast('')
    try {
      await invokeEdge(
        'provider-connect',
        { asset_id: id, provider_slug: provider, api_key: key, credential_slot: 'api' },
        session.access_token,
      )
      setApiKey('')
      pushToast('Runtime key stored. Run a live check to verify.')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connect failed.')
    } finally {
      setBusy('')
    }
  }

  async function testConnection() {
    if (!id || !session?.access_token || !provider) return
    setBusy('test')
    setError('')
    pushToast('')
    try {
      await invokeEdge(
        'provider-test',
        { asset_id: id, provider_slug: provider, probe_all: true },
        session.access_token,
      )
      pushToast('Live check passed.')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Live check failed.')
      await refresh()
    } finally {
      setBusy('')
    }
  }

  async function revokeRuntime() {
    if (!id || !session?.access_token || !provider) return
    if (!confirm('Revoke the runtime API key for this asset?')) return
    setBusy('revoke')
    setError('')
    try {
      await invokeEdge(
        'provider-revoke',
        { asset_id: id, provider_slug: provider, credential_slot: 'api' },
        session.access_token,
      )
      pushToast('Runtime key revoked.')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Revoke failed.')
    } finally {
      setBusy('')
    }
  }

  async function refreshInsights() {
    if (!id || !session?.access_token || !provider) return
    setBusy('insights')
    setError('')
    try {
      await invokeEdge(
        'provider-insights',
        { asset_id: id, provider_slug: provider, window_days: insightsWindow },
        session.access_token,
      )
      pushToast('Insights refreshed.')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not refresh insights.')
    } finally {
      setBusy('')
    }
  }

  async function mintToken() {
    if (!id || !session?.access_token) return
    const label = tokenLabel.trim() || 'Gateway token'
    setBusy('mint')
    setError('')
    setOnceToken('')
    try {
      const data = await invokeEdge<{ token?: string }>(
        'asset-gateway-token',
        { action: 'mint', asset_id: id, label },
        session.access_token,
      )
      if (data.token) setOnceToken(data.token)
      setTokenLabel('')
      pushToast('Token minted. Copy it now. It will not be shown again.')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Mint failed.')
    } finally {
      setBusy('')
    }
  }

  async function revokeToken(tokenId: string) {
    if (!id || !session?.access_token) return
    if (!confirm('Revoke this gateway token? Clients using it will lose access immediately.')) return
    setBusy(`revoke-${tokenId}`)
    setError('')
    try {
      await invokeEdge(
        'asset-gateway-token',
        { action: 'revoke', asset_id: id, token_id: tokenId },
        session.access_token,
      )
      pushToast('Gateway token revoked.')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Revoke failed.')
    } finally {
      setBusy('')
    }
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      pushToast('Copied.')
    } catch {
      setError('Could not copy. Select the text and copy manually.')
    }
  }

  function domainRisk(pct: number) {
    if (pct < 40) return { lbl: 'High', cls: styles.toneRisk }
    if (pct < 70) return { lbl: 'Medium', cls: styles.toneWarn }
    return { lbl: 'Low', cls: styles.toneOk }
  }

  function bandTone(band: string) {
    if (band === 'high') return 'risk' as const
    if (band === 'low') return 'ok' as const
    return 'warn' as const
  }

  const railItems =
    tab === 'connection'
      ? [
          { id: 'connection', label: 'Connection' },
          { id: 'gateway', label: 'Gateway' },
          { id: 'usage', label: 'Usage' },
        ]
      : [
          {
            id: tab,
            label: DETAIL_TABS.find((t) => t.id === tab)?.label || 'Overview',
          },
        ]

  if (loading) {
    return (
      <PageFrame>
        <PageHeader title="Asset" description="Loading registry asset" />
        <BrandLoader fill label="Loading asset" />
      </PageFrame>
    )
  }

  if (!asset) {
    return (
      <PageFrame railItems={DETAIL_TABS.map((t) => ({ id: t.id, label: t.label }))}>
        <PageHeader title="Asset not found" description="This registry asset may have been removed." />
        <EmptyState
          title="Asset not found"
          body="Return to the registry and select an active asset."
          action={
            <Link to="/registry">
              <Button variant="ghost">Back to registry</Button>
            </Link>
          }
        />
      </PageFrame>
    )
  }

  return (
    <PageFrame railItems={railItems}>
      <PageHeader
        title={name}
        description={
          <div className={styles.pageMeta}>
            <StatusLabel badge tone={riskTone(asset?.risk_tier)}>
              {labelTier(asset?.risk_tier)}
            </StatusLabel>
            <span>{labelLifecycle(asset?.lifecycle)}</span>
          </div>
        }
        actions={
          <>
            {canWriteRegistry ? (
              <Button variant="ghost" onClick={openEdit}>
                Edit
              </Button>
            ) : null}
            <Link to="/registry">
              <Button variant="ghost">Back to registry</Button>
            </Link>
          </>
        }
      />

      {error ? <div className={styles.bannerRisk}>{error}</div> : null}

      <Tabs
        items={DETAIL_TABS}
        value={tab}
        onChange={(next) => {
          setTab(next)
          setSearchParams(next === 'overview' ? {} : { tab: next }, { replace: true })
        }}
      />

      {tab === 'overview' ? (
        <Section id="overview">
          <div className={styles.grid}>
              <div className={styles.fieldWide}>
                <div className={styles.label}>Description</div>
                <div className={styles.value}>{asset.description || 'No description provided.'}</div>
              </div>
              <div className={styles.field}>
                <div className={styles.label}>Asset ID</div>
                <div className={styles.value}>{asset.id}</div>
              </div>
              <div className={styles.field}>
                <div className={styles.label}>Provider</div>
                <div className={styles.provider}>
                  {provider ? <BrandIcon slug={provider} size={14} /> : null}
                  <span>{provider ? labelProvider(provider) : 'Not set'}</span>
                  <button
                    type="button"
                    className={styles.connTag}
                    onClick={() => {
                      setTab('connection')
                      setSearchParams({ tab: 'connection' }, { replace: true })
                    }}
                    aria-label={`${connected ? 'Connected' : 'Not connected'}. Open Connection.`}
                  >
                    <StatusLabel badge tone={connected ? 'ok' : 'warn'}>
                      {connected ? 'Connected' : 'Not connected'}
                    </StatusLabel>
                  </button>
                </div>
              </div>
              <div className={styles.field}>
                <div className={styles.label}>Model</div>
                <div className={styles.value}>
                  {modelDisplayName(asset.provider_slug, asset.model_name) || 'Not set'}
                </div>
              </div>
              <div className={styles.field}>
                <div className={styles.label}>Vendor</div>
                <div className={styles.value}>{asset.vendor || 'In-house'}</div>
              </div>
              <div className={styles.field}>
                <div className={styles.label}>Department</div>
                <div className={styles.value}>{asset.department || 'Not set'}</div>
              </div>
              <div className={styles.field}>
                <div className={styles.label}>Owner</div>
                <div className={styles.value}>{asset.system_owner || 'Not set'}</div>
              </div>
              <div className={styles.field}>
                <div className={styles.label}>Lifecycle</div>
                <div className={styles.value}>{labelLifecycle(asset.lifecycle)}</div>
              </div>
              <div className={styles.field}>
                <div className={styles.label}>Purpose</div>
                <div className={styles.value}>{labelPurpose(asset.purpose_category)}</div>
              </div>
              <div className={styles.field}>
                <div className={styles.label}>Risk</div>
                <StatusLabel badge tone={riskTone(asset.risk_tier)}>
                  {labelTier(asset.risk_tier)}
                </StatusLabel>
              </div>
              <div className={styles.field}>
                <div className={styles.label}>Registered</div>
                <div className={styles.value}>
                  {asset.created_at ? new Date(asset.created_at).toLocaleDateString('en-GB') : '—'}
                </div>
              </div>
              <div className={styles.field}>
                <div className={styles.label}>Last updated</div>
                <div className={styles.value}>
                  {asset.updated_at ? new Date(asset.updated_at).toLocaleDateString('en-GB') : '—'}
                </div>
              </div>
            </div>
        </Section>
      ) : null}

      {tab === 'assessment' ? (
        <Section
          id="assessment"
          title={assessments.length === 0 ? 'Assessment' : undefined}
          description={
            assessments.length === 0 ? 'Governance maturity history for this asset.' : undefined
          }
        >
          {assessments.length === 0 ? (
            <EmptyState
              title="No assessments yet"
              body="Run an assessment to evaluate this AI system's governance maturity across 7 domains and receive a risk score."
              action={
                id ? (
                  <a href={assessmentUrl(id)}>
                    <Button>Run assessment</Button>
                  </a>
                ) : undefined
              }
            />
          ) : (
            <div className={styles.assessList}>
              <div className={styles.actions}>
                {id ? (
                  <a href={assessmentUrl(id)}>
                    <Button variant="ghost">Request / run assessment</Button>
                  </a>
                ) : null}
              </div>
              {assessments.map((a, i) => {
                const band = a.risk_band || 'medium'
                const ss = a.section_scores || {}
                return (
                  <div key={a.id} className={styles.assessCard}>
                    <div className={styles.assessHead}>
                      <div className={styles.assessReading}>
                        <StatusLabel badge tone={bandTone(band)}>
                          {BAND_LABELS[band] || band}
                        </StatusLabel>
                        {i === 0 ? <span className={styles.latestMark}>Latest</span> : null}
                      </div>
                      <div className={styles.assessStatus}>
                        <span className={styles.statusWord}>{labelAssessStatus(a.status)}</span>
                        <span className={styles.assessDate}>
                          {a.requested_at
                            ? new Date(a.requested_at).toLocaleString('en-GB', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '—'}
                        </span>
                      </div>
                    </div>
                    {Object.keys(ss).length ? (
                      <div className={styles.domList}>
                        {Object.entries(ss).map(([k, v]) => {
                          const pct = Math.max(0, Math.min(100, Number(v.score) || 0))
                          const risk = domainRisk(pct)
                          return (
                            <div key={k} className={styles.domRow}>
                              <span className={styles.domLabel}>{v.title || k}</span>
                              <div className={styles.domTrack}>
                                <span className={styles.domFill} style={{ width: `${pct}%` }} />
                              </div>
                              <span className={styles.domPct}>{Math.round(pct)}%</span>
                              <span className={`${styles.domRisk} ${risk.cls}`}>{risk.lbl}</span>
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                    <div className={styles.assessMeta}>
                      <div className={styles.assessMetaCell}>
                        <span className={styles.label}>Submitted by</span>
                        <span className={styles.value}>
                          {(a.requested_by && auditNames[a.requested_by]) || 'Unknown'}
                        </span>
                      </div>
                      <div className={styles.assessMetaCell}>
                        <span className={styles.label}>Sector</span>
                        <span className={styles.value}>{a.sector || 'Not set'}</span>
                      </div>
                      <div className={styles.assessMetaCell}>
                        <span className={styles.label}>Review state</span>
                        <span className={styles.value}>{labelAssessStatus(a.status)}</span>
                      </div>
                    </div>
                    <div className={styles.assessFoot}>
                      {a.tier_validation?.mismatch ? (
                        <Notice tone="warn">
                          {a.tier_validation.message ||
                            'Risk tier mismatch detected. RegAnchor recommends reviewing the classification.'}
                        </Notice>
                      ) : null}
                      {a.client_notes ? <Notice>{a.client_notes}</Notice> : null}
                      {a.status === 'controls_issued' ? (
                        <Notice title="RegAnchor controls issued">
                          {a.mla_notes || ''}
                          {a.completed_at
                            ? ` Completed by ${(a.completed_by && auditNames[a.completed_by]) || 'RegAnchor'}, ${new Date(a.completed_at).toLocaleString('en-GB')}.`
                            : ''}
                        </Notice>
                      ) : null}
                      {a.status === 'submitted' ? (
                        <Notice>
                          Your assessment has been submitted. RegAnchor will review this AI system and provide
                          tailored compliance controls. You will be notified when results are ready.
                        </Notice>
                      ) : null}
                      <div className={styles.assessActions}>
                        {isPaidTier ? (
                          <a href={systemReportUrl(a.id)} target="_blank" rel="noreferrer">
                            <Button size="sm">View report</Button>
                          </a>
                        ) : (
                          <Link to="/plans">
                            <Button variant="ghost" size="sm">
                              Upgrade to view report
                            </Button>
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Section>
      ) : null}

      {tab === 'controls' ? (
        <Section
          id="controls"
          title={controls.length === 0 ? 'Controls' : undefined}
          description={controls.length === 0 ? 'Control assignments for this system.' : undefined}
        >
          {controls.length === 0 ? (
            <EmptyState
              title="No controls triggered yet"
              body="Run an assessment on this AI system. Controls will be automatically triggered based on governance gaps identified."
              action={
                id ? (
                  <a href={assessmentUrl(id)}>
                    <Button>Run assessment</Button>
                  </a>
                ) : undefined
              }
            />
          ) : (
            <>
              <div className={styles.ctrlStack}>
                <div className={styles.ctrlSummary}>
                  <div className={styles.ctrlSummaryRow}>
                    <div className={styles.ctrlPct}>{ctrlPct}%</div>
                    <div className={styles.ctrlCount}>
                      {ctrlDone} of {controls.length} controls implemented
                    </div>
                  </div>
                  <ProgressMeter value={ctrlPct} bare />
                </div>
                {controlGroups.map((group) => (
                  <div key={group.key} className={styles.ctrlGroup}>
                    <div className={styles.ctrlGroupTitle}>{group.label}</div>
                    <Ledger flush>
                      {group.items.map((c) => {
                        const code = controlCode(c.governance_controls?.control_number)
                        const title = c.governance_controls?.title || 'Control'
                        return (
                          <LedgerRow
                            key={c.id}
                            title={code ? `${code} ${title}` : title}
                            meta={<StatusLabel tone={ctrlTone(c.status)}>{labelCtrlStatus(c.status)}</StatusLabel>}
                            onClick={() =>
                              navigate(`/controls/${c.id}`, {
                                state: {
                                  from: 'registry',
                                  assetId: id,
                                  assetName: name,
                                },
                              })
                            }
                          />
                        )
                      })}
                    </Ledger>
                  </div>
                ))}
              </div>
            </>
          )}
        </Section>
      ) : null}

      {tab === 'connection' ? (
        <Section
          id="connection"
          title={!provider || !connectorReady ? 'Connection' : undefined}
          description={
            !provider || !connectorReady
              ? 'Attach the runtime key this asset uses, then verify connectivity.'
              : undefined
          }
        >
          {!provider ? (
            <EmptyState
              title="No provider on this asset"
              body="Set a provider on Overview (Edit), then return here to connect a runtime key."
              action={
                canWriteRegistry ? (
                  <Button variant="ghost" onClick={openEdit}>
                    Edit asset
                  </Button>
                ) : undefined
              }
            />
          ) : !connectorReady ? (
            <EmptyState
              title="No connector yet"
              body={`${labelProvider(provider, providerRow?.name)} is recorded on this asset. Live key connect is not available for this provider yet. Use Connect for org-level setup docs and keys when a full connector is not shipped.`}
            />
          ) : (
            <div className={styles.connStack}>
              <div className={styles.connIdentity}>
                <div className={styles.connIdentityMain}>
                  <BrandIcon slug={provider} size={18} title={labelProvider(provider)} />
                  <span className={styles.connProviderName}>{labelProvider(provider)}</span>
                  <StatusLabel
                    badge
                    tone={
                      connected ? 'ok' : conn?.status === 'error' ? 'risk' : 'warn'
                    }
                  >
                    {connectionLabel(conn?.status)}
                  </StatusLabel>
                </div>
                {modelDisplayName(provider, asset?.model_name) ? (
                  <div className={styles.connModel}>{modelDisplayName(provider, asset?.model_name)}</div>
                ) : null}
                {conn?.last_verified_at ? (
                  <div className={styles.connDate}>
                    Verified{' '}
                    {new Date(conn.last_verified_at).toLocaleString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                ) : null}
              </div>

              {conn?.last_error ? <Notice tone="risk">{conn.last_error}</Notice> : null}

              <div className={styles.connBlock}>
                <div className={styles.connBlockTitle}>Runtime key</div>
                <p className={styles.connHint}>
                  This asset&apos;s calls authenticate with this key. Stored in Vault. Never shown again.
                </p>
                {canDeleteRegistry ? (
                  <>
                    <input
                      className={styles.secret}
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      aria-label="Runtime API key"
                      placeholder={connected ? 'Paste a new key to replace' : 'Paste runtime API key'}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                    <div className={styles.actions}>
                      <Button size="sm" onClick={() => void connectRuntime()} pending={busy === 'connect'}>
                        {connected ? 'Replace key' : 'Connect key'}
                      </Button>
                      {connected || conn?.status === 'error' || conn?.status === 'pending' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void testConnection()}
                          pending={busy === 'test'}
                        >
                          Live check
                        </Button>
                      ) : null}
                      {connected ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void revokeRuntime()}
                          pending={busy === 'revoke'}
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <Notice>Only organisation owners and admins can manage runtime keys.</Notice>
                )}
              </div>

              {isAnthropic ? (
                <div className={styles.connBlock}>
                  <div className={styles.connBlockHead}>
                    <div className={styles.connBlockTitle}>Organisation admin</div>
                    <StatusLabel badge tone={hasAdmin ? 'ok' : 'warn'}>
                      {hasOrgAdmin ? 'Connected' : hasLegacyAdmin ? 'Legacy on asset' : 'Not connected'}
                    </StatusLabel>
                  </div>
                  <p className={styles.connHint}>
                    One Admin key for the org unlocks usage and cost for every Anthropic asset.
                  </p>
                  <Link to="/organisation">
                    <Button variant="ghost" size="sm">
                      {hasAdmin ? 'Manage in Organisation' : 'Connect in Organisation'}
                    </Button>
                  </Link>
                </div>
              ) : null}

              {hasAdmin && isAnthropic ? (
                <div className={styles.connBlock}>
                  <div className={styles.connBlockHead}>
                    <div className={styles.connBlockTitle}>Provider usage</div>
                    {canDeleteRegistry ? (
                      <div className={styles.insightsActions}>
                        <select
                          className={styles.select}
                          aria-label="Usage window"
                          value={insightsWindow}
                          onChange={(e) => setInsightsWindow(Number(e.target.value))}
                        >
                          {[7, 30, 90].map((d) => (
                            <option key={d} value={d}>
                              {d}d
                            </option>
                          ))}
                        </select>
                        <Button
                          variant="ghost"
                          size="sm"
                          pending={busy === 'insights'}
                          onClick={() => void refreshInsights()}
                        >
                          Refresh
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <p className={styles.connHint}>
                    Anthropic Admin data for this asset&apos;s runtime key. Can lag the provider console.
                  </p>
                  {!insights ? (
                    <p className={styles.connHint}>No snapshot yet. Connect the runtime key, generate traffic, then refresh.</p>
                  ) : insights.scope !== 'asset' ? (
                    <p className={styles.connHint}>
                      Runtime key not matched yet. Run a live check, send a call, wait a few minutes, then refresh.
                    </p>
                  ) : insightsUsageFetchFailed(insights) &&
                    !(insights.usage && (insights.usage.total_tokens || 0) > 0) ? (
                    <p className={styles.connHint}>Admin usage is temporarily unavailable. Try refresh shortly.</p>
                  ) : (
                    <>
                      <div className={styles.insightsGrid}>
                        <div>
                          <div className={styles.connMetaLabel}>Tokens</div>
                          <div className={styles.insightValue}>
                            {fmtProviderTokens(insights.usage?.total_tokens)}
                          </div>
                        </div>
                        {insights.estimated_asset_usd != null && insights.estimated_asset_usd !== '' ? (
                          <div>
                            <div className={styles.connMetaLabel}>Est. spend</div>
                            <div className={styles.insightValue}>
                              {fmtProviderUsd(insights.estimated_asset_usd)}
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <p className={styles.connHint}>List-price estimate only. Not a bill.</p>
                      {insights.usage?.by_model?.length ? (
                        <ul className={styles.insightList}>
                          {insights.usage.by_model.slice(0, 5).map((row) => (
                            <li key={row.model}>
                              <span>{row.model}</span>
                              <span>{fmtProviderTokens(row.total_tokens)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}

              <div className={styles.connBlock} id="gateway">
                <div className={styles.connBlockTitle}>Gateway</div>
                {!isAnthropic ? (
                  <p className={styles.connHint}>
                    Governed Messages routing is available when this asset uses Anthropic.
                  </p>
                ) : (
                  <>
                    <p className={styles.connHint}>
                      Route Messages through RegAnchor with an <code className={styles.inlineCode}>ra_gw_</code> token.
                      Prompt bodies are not stored.
                    </p>
                    <div className={styles.endpointRow}>
                      <code className={styles.endpoint}>{GATEWAY_MESSAGES_URL}</code>
                      <Button variant="ghost" size="sm" onClick={() => void copyText(GATEWAY_MESSAGES_URL)}>
                        Copy
                      </Button>
                    </div>
                    {!connected ? (
                      <p className={styles.connHint}>Connect and verify the runtime key before minting a token.</p>
                    ) : canDeleteRegistry ? (
                      <div className={styles.mintRow}>
                        <input
                          className={styles.input}
                          value={tokenLabel}
                          onChange={(e) => setTokenLabel(e.target.value)}
                          placeholder="Token label (for example, Production)"
                          maxLength={80}
                          aria-label="Gateway token label"
                        />
                        <Button size="sm" onClick={() => void mintToken()} pending={busy === 'mint'}>
                          Mint token
                        </Button>
                      </div>
                    ) : null}
                    {onceToken ? (
                      <div className={styles.once}>
                        <div className={styles.onceLabel}>Copy now. This token will not be shown again.</div>
                        <code className={styles.onceCode}>{onceToken}</code>
                        <Button variant="ghost" size="sm" onClick={() => void copyText(onceToken)}>
                          Copy token
                        </Button>
                      </div>
                    ) : null}
                    {activeTokens.length === 0 ? (
                      <p className={styles.connHint}>No active tokens. Mint one to send governed traffic for this asset.</p>
                    ) : (
                      <Ledger flush>
                        {activeTokens.map((t) => (
                          <LedgerRow
                            key={t.id}
                            title={t.label || 'Gateway token'}
                            description={
                              t.created_at
                                ? `Created ${new Date(t.created_at).toLocaleDateString('en-GB', {
                                    day: 'numeric',
                                    month: 'short',
                                    year: 'numeric',
                                  })}`
                                : undefined
                            }
                            meta={
                              <StatusLabel badge tone="ok">
                                Active
                              </StatusLabel>
                            }
                            trailing={
                              canDeleteRegistry ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  pending={busy === `revoke-${t.id}`}
                                  onClick={() => void revokeToken(t.id)}
                                >
                                  Revoke
                                </Button>
                              ) : null
                            }
                          />
                        ))}
                      </Ledger>
                    )}
                  </>
                )}
              </div>

              <div className={styles.connBlock} id="usage">
                <div className={styles.connBlockTitle}>Gateway usage</div>
                <p className={styles.connHint}>Metering for Messages traffic that used an ra_gw_ token on this asset.</p>
                <MetricStrip
                  items={[
                    { id: 'in', label: 'Input tokens', value: inputTotal.toLocaleString() },
                    { id: 'out', label: 'Output tokens', value: outputTotal.toLocaleString() },
                    { id: 'calls', label: 'Events', value: usage.length },
                  ]}
                />
                {usage.length === 0 ? (
                  <p className={styles.connHint}>No gateway events yet.</p>
                ) : (
                  <Ledger flush>
                    {usage.map((u) => (
                      <LedgerRow
                        key={u.id}
                        title={u.model || 'Model'}
                        description={`${(u.input_tokens || 0).toLocaleString()} in · ${(u.output_tokens || 0).toLocaleString()} out`}
                        meta={
                          <span className={styles.connDate}>
                            {u.created_at
                              ? new Date(u.created_at).toLocaleDateString('en-GB', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric',
                                })
                              : '—'}
                          </span>
                        }
                      />
                    ))}
                  </Ledger>
                )}
              </div>
            </div>
          )}
        </Section>
      ) : null}

      {tab === 'audit' ? (
        <Section id="audit">
          {audit.length === 0 ? (
            <EmptyState title="No audit entries" body="Entries are created automatically on system changes." />
          ) : (
            <Timeline
              items={audit.map((entry) => {
                const a = formatAuditPlain(entry, auditNames)
                return {
                  id: entry.id,
                  title: a.text,
                  meta: `${a.who}${entry.created_at ? ` · ${new Date(entry.created_at).toLocaleString('en-GB')}` : ''}`,
                  tone: 'info' as const,
                }
              })}
            />
          )}
        </Section>
      ) : null}

      <Drawer
        open={editOpen}
        title="Edit asset"
        onClose={() => setEditOpen(false)}
        actions={
          <>
            {canDeleteRegistry ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setEditOpen(false)
                  void openDelete()
                }}
              >
                Remove from registry
              </Button>
            ) : null}
            <Button onClick={() => void submitEdit()} pending={editBusy}>
              Save changes
            </Button>
          </>
        }
      >
        <p className={styles.drawerSub}>{asset?.name}</p>
        <AssetFormFields form={editForm} providers={providers} error={editError} onChange={setEditForm} />
      </Drawer>

      <Drawer open={deleteOpen} title="Remove from registry" onClose={() => setDeleteOpen(false)}>
        <div className={styles.deletePanel}>
          <p className={styles.slotCopy}>
            {deleteError && !deletePreview
              ? deleteError
              : deletePreview?.pending_request
                ? 'A deletion request is already pending RegAnchor review.'
                : deletePreview?.requires_review
                  ? 'This asset has governance history. Deletion will be submitted to RegAnchor for review. A recoverable archive is kept for 30 days after approval.'
                  : deletePreview
                    ? 'Permanently remove this asset from your active registry. A recoverable archive is kept for 30 days.'
                    : 'Loading…'}
          </p>
          {deletePreview && !deletePreview.pending_request ? (
            <>
              <label className={styles.fieldBlock}>
                <span>Reason</span>
                <select
                  className={styles.input}
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                >
                  <option value="">Select reason</option>
                  {DELETE_REASON_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              {!deletePreview.requires_review ? (
                <label className={styles.fieldBlock}>
                  <span>Type asset name to confirm</span>
                  <input
                    className={styles.input}
                    value={deleteConfirmName}
                    onChange={(e) => setDeleteConfirmName(e.target.value)}
                    placeholder={deletePreview.system_name || asset?.name}
                    autoComplete="off"
                  />
                </label>
              ) : null}
              {deleteError ? <div className={styles.bannerRisk}>{deleteError}</div> : null}
              <Button onClick={() => void confirmDelete()} pending={busy === 'delete'}>
                Confirm deletion
              </Button>
            </>
          ) : null}
        </div>
      </Drawer>

      <ToastStack items={toasts} onDismiss={dismissToast} />
    </PageFrame>
  )
}
