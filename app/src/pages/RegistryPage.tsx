import { createColumnHelper } from '@tanstack/react-table'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useQueryState, parseAsString } from 'nuqs'
import { ChevronDown, ChevronLeft, ChevronRight, Check, MoreHorizontal, Search, User } from 'lucide-react'
import {
  BrandLoader,
  Button,
  DataTable,
  DelayTip,
  Drawer,
  EmptyState,
  Icon,
  MetricStrip,
  PageFrame,
  PageHeader,
  StatusLabel,
  ToastStack,
  type ToastItem,
} from '../ui'
import { BrandIcon, hasBrandIcon } from '../icons/BrandIcon'
import { usePageChrome } from '../ui/shellChrome'
import { sb } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import {
  DEPLOYMENT_FILTERS,
  DEPLOYMENT_OPTIONS,
  DELETE_REASON_OPTIONS,
  actorName,
  assetHaystack,
  auditChangesFromPatch,
  buildAssetPayload,
  deleteRegistryAsset,
  emptyAssetForm,
  exportAssetsCsv,
  fetchDeletePreview,
  labelLifecycle,
  labelProvider,
  labelTier,
  loadProviderCatalog,
  registryAssetLimit,
  registryLimitMessage,
  requestRegistryAssessments,
  riskSortRank,
  connectionSortRank,
  riskTone,
  validateAssetForm,
  type AssetFormValues,
  type DeletePreview,
  type ProviderCatalogRow,
  type RegistryAsset,
} from '../lib/registry'
import { AssetFormFields } from './AssetFormFields'
import { AssetPreview, AssetPreviewMeta } from './AssetPreview'
import styles from './RegistryPage.module.css'

const col = createColumnHelper<RegistryAsset>()

type BulkPanel = 'root' | 'lifecycle' | 'owner' | 'retire' | 'delete'

type OwnerMember = {
  id: string
  label: string
  email: string
}

function ownerInitials(label: string) {
  const parts = label.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
  return label.slice(0, 2).toUpperCase() || '?'
}

export function RegistryPage() {
  const { session, org, profile, canWriteRegistry, canDeleteRegistry } = useAuth()
  const navigate = useNavigate()
  const [assets, setAssets] = useState<RegistryAsset[]>([])
  const [search, setSearch] = useQueryState('q', parseAsString.withDefault(''))
  const [lifecycleFilter, setLifecycleFilter] = useQueryState('lifecycle', parseAsString.withDefault('all'))
  const [riskFilter, setRiskFilter] = useQueryState('risk', parseAsString.withDefault('all'))
  const [connectionFilter, setConnectionFilter] = useQueryState('connection', parseAsString.withDefault('all'))
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [selectMode, setSelectMode] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkPanel, setBulkPanel] = useState<BulkPanel>('root')
  const [ownerValue, setOwnerValue] = useState('')
  const [ownerQuery, setOwnerQuery] = useState('')
  const [orgMembers, setOrgMembers] = useState<OwnerMember[]>([])
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [flyoutTop, setFlyoutTop] = useState(0)
  const [rowMenuId, setRowMenuId] = useState<string | null>(null)
  const [rowMenuStyle, setRowMenuStyle] = useState<CSSProperties | null>(null)
  const [rowPanel, setRowPanel] = useState<BulkPanel>('root')
  const [deletePreview, setDeletePreview] = useState<DeletePreview | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState<AssetFormValues>(emptyAssetForm())
  const [addError, setAddError] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [providers, setProviders] = useState<ProviderCatalogRow[]>([])
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const bulkRef = useRef<HTMLDivElement>(null)
  const bulkShellRef = useRef<HTMLDivElement>(null)
  const rowMenuRef = useRef<HTMLDivElement>(null)
  const rowMenuTriggerRef = useRef<HTMLElement | null>(null)
  const lifecycleItemRef = useRef<HTMLButtonElement>(null)
  const ownerItemRef = useRef<HTMLButtonElement>(null)
  const retireItemRef = useRef<HTMLButtonElement>(null)
  const ownerSearchRef = useRef<HTMLInputElement>(null)
  const chipsTrackRef = useRef<HTMLDivElement>(null)
  const [chipOverflow, setChipOverflow] = useState({ left: false, right: false })

  const orgId = org?.id || null
  const actor = actorName(profile, session?.user?.email)

  function pushToast(text: string) {
    if (!text.trim()) return
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `t-${Date.now()}-${Math.random().toString(16).slice(2)}`
    setToasts((prev) => [...prev, { id, text }])
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  function closeRowMenu() {
    setRowMenuId(null)
    setRowMenuStyle(null)
    setRowPanel('root')
    setOwnerQuery('')
    rowMenuTriggerRef.current = null
  }

  function liveRowTrigger(id: string | null = rowMenuId): HTMLElement | null {
    if (!id) return null
    const el = document.querySelector(`[data-row-more="${CSS.escape(id)}"] button`)
    return el instanceof HTMLElement ? el : null
  }

  function computeRowMenuStyle(trigger: HTMLElement, menuH: number): CSSProperties {
    const r = trigger.getBoundingClientRect()
    const width = 200
    const gap = 4
    const pad = 8
    const left = Math.min(Math.max(pad, Math.round(r.right - width)), window.innerWidth - width - pad)
    const height = Math.max(menuH, 160)
    const spaceBelow = window.innerHeight - r.bottom - pad
    const spaceAbove = r.top - pad
    const fitsBelow = height + gap <= spaceBelow
    const fitsAbove = height + gap <= spaceAbove
    const openUp = fitsBelow ? false : fitsAbove ? true : spaceAbove > spaceBelow
    const available = Math.max(120, openUp ? spaceAbove - gap : spaceBelow - gap)
    const maxHeight = Math.min(height, available)

    if (openUp) {
      return {
        position: 'fixed',
        left,
        top: 'auto',
        bottom: Math.round(window.innerHeight - r.top + gap),
        maxHeight,
      }
    }
    return {
      position: 'fixed',
      left,
      top: Math.round(r.bottom + gap),
      bottom: 'auto',
      maxHeight,
    }
  }

  function openRowMenu(btn: HTMLElement, id: string, owner: string) {
    rowMenuTriggerRef.current = btn
    setBulkOpen(false)
    setBulkPanel('root')
    setRowPanel('root')
    setOwnerValue(owner)
    setOwnerQuery('')
    setRowMenuStyle(computeRowMenuStyle(btn, 280))
    setRowMenuId(id)
  }

  function syncRowMenuPlacement() {
    const id = rowMenuId
    if (!id) return
    const trigger = liveRowTrigger(id) || (rowMenuTriggerRef.current?.isConnected ? rowMenuTriggerRef.current : null)
    const menu = rowMenuRef.current?.querySelector(`.${styles.rowMenu}`) as HTMLElement | null
    if (!trigger || !rowMenuRef.current) return
    rowMenuTriggerRef.current = trigger
    const r = trigger.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) {
      closeRowMenu()
      return
    }
    if (r.bottom < 8 || r.top > window.innerHeight - 8) {
      closeRowMenu()
      return
    }
    const h = menu ? Math.max(menu.scrollHeight, 160) : 160
    setRowMenuStyle(computeRowMenuStyle(trigger, h))
  }

  function syncFlyoutTop(panel: BulkPanel, shell: HTMLElement | null) {
    if (!shell || (panel !== 'lifecycle' && panel !== 'owner' && panel !== 'retire')) {
      setFlyoutTop(0)
      return
    }
    const item =
      panel === 'lifecycle'
        ? lifecycleItemRef.current
        : panel === 'owner'
          ? ownerItemRef.current
          : retireItemRef.current
    if (!item) return
    const top = Math.round(item.getBoundingClientRect().top - shell.getBoundingClientRect().top)
    setFlyoutTop(Math.max(0, top))
  }

  usePageChrome({
    title: 'Registry',
    breadcrumbs: [{ label: 'Registry' }],
  })

  function updateChipOverflow() {
    const el = chipsTrackRef.current
    if (!el) {
      setChipOverflow({ left: false, right: false })
      return
    }
    const max = el.scrollWidth - el.clientWidth
    const left = el.scrollLeft > 2
    const right = max > 2 && el.scrollLeft < max - 2
    setChipOverflow({ left, right })
  }

  function scrollChips(dir: -1 | 1) {
    const el = chipsTrackRef.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.55), behavior: 'smooth' })
  }

  async function load() {
    if (!session || !orgId) {
      setAssets([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    const [{ data, error: err }, { data: conns }] = await Promise.all([
      sb
        .from('ai_systems')
        .select(
          'id,name,asset_kind,risk_tier,lifecycle,description,provider_slug,model_name,vendor,department,system_owner,purpose_category,notes,updated_at,created_at',
        )
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false }),
      sb.from('provider_connections').select('asset_id,status').eq('org_id', orgId).neq('status', 'revoked'),
    ])
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    const byAsset = new Map<string, string>()
    for (const c of conns || []) {
      if (c.asset_id && !byAsset.has(c.asset_id)) byAsset.set(c.asset_id, c.status || 'pending')
      if (c.status === 'connected') byAsset.set(c.asset_id as string, 'connected')
    }
    setAssets(
      ((data as RegistryAsset[]) || []).map((a) => ({
        ...a,
        connection_status: byAsset.get(a.id) || null,
      })),
    )
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [session, orgId])

  useEffect(() => {
    void loadProviderCatalog().then(setProviders)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadMembers() {
      if (!orgId) {
        setOrgMembers([])
        return
      }
      const { data: mems } = await sb.from('org_members').select('user_id').eq('org_id', orgId)
      const ids = ((mems as { user_id: string }[]) || []).map((m) => m.user_id)
      if (!ids.length) {
        if (!cancelled) setOrgMembers([])
        return
      }
      const { data: profs } = await sb.from('profiles').select('id,full_name,email').in('id', ids)
      if (cancelled) return
      const rows = ((profs as { id: string; full_name?: string | null; email?: string | null }[]) || [])
        .map((p) => ({
          id: p.id,
          label: (p.full_name || p.email || 'Member').trim(),
          email: (p.email || '').trim(),
        }))
        .sort((a, b) => a.label.localeCompare(b.label))
      setOrgMembers(rows)
    }
    void loadMembers()
    return () => {
      cancelled = true
    }
  }, [orgId])

  useLayoutEffect(() => {
    const panel = rowMenuId ? rowPanel : bulkOpen ? bulkPanel : 'root'
    const shell = rowMenuId ? rowMenuRef.current : bulkOpen ? bulkShellRef.current : null
    syncFlyoutTop(panel, shell)
    if (panel === 'owner') {
      requestAnimationFrame(() => ownerSearchRef.current?.focus())
    }
  }, [rowMenuId, rowPanel, bulkOpen, bulkPanel])

  useEffect(() => {
    const el = chipsTrackRef.current
    if (!el) return
    updateChipOverflow()
    const onScroll = () => updateChipOverflow()
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => updateChipOverflow()) : null
    ro?.observe(el)
    window.addEventListener('resize', onScroll)
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro?.disconnect()
      window.removeEventListener('resize', onScroll)
    }
  }, [loading, lifecycleFilter])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const el = e.target as HTMLElement | null
      const t = e.target as Node
      const inBulk = bulkRef.current?.contains(t)
      const inRowMenu = rowMenuRef.current?.contains(t)
      const inRowBtn = !!el?.closest?.('[data-row-more]')
      const inRow = inRowMenu || inRowBtn
      const inTable = !!el?.closest?.('[data-reg-table]')
      if (!inBulk && !inTable) {
        setBulkOpen(false)
        setBulkPanel('root')
      }
      if (!inRow) {
        closeRowMenu()
      }
      if (selectMode && !inBulk && !inRow && !inTable) {
        exitSelectMode()
      }
    }
    function onScrollReposition(e: Event) {
      const t = e.target as Node | null
      if (rowMenuRef.current && t && rowMenuRef.current.contains(t)) return
      if (rowMenuId) syncRowMenuPlacement()
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('scroll', onScrollReposition, true)
    window.addEventListener('resize', onScrollReposition)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('scroll', onScrollReposition, true)
      window.removeEventListener('resize', onScrollReposition)
    }
  }, [selectMode, rowMenuId])

  useLayoutEffect(() => {
    if (!rowMenuId || !rowMenuStyle) return
    syncRowMenuPlacement()
  }, [rowMenuId, rowPanel, deletePreview, ownerValue, deleteReason, deleteConfirmName, deleteError])

  function exitSelectMode() {
    setSelectMode(false)
    setSelected({})
    setBulkOpen(false)
    setBulkPanel('root')
  }

  function enterSelectMode() {
    setSelectMode(true)
    setBulkOpen(true)
    setBulkPanel('root')
    closeRowMenu()
  }

  function toggleBulk() {
    if (!selectMode) enterSelectMode()
    else exitSelectMode()
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return assets.filter((a) => {
      if (lifecycleFilter !== 'all' && (a.lifecycle || 'planned') !== lifecycleFilter) return false
      if (riskFilter !== 'all') {
        const tier = (a.risk_tier || '').toLowerCase()
        if (riskFilter === 'unclassified') {
          if (tier && tier !== 'none' && tier !== 'unclassified') return false
        } else if (tier !== riskFilter) {
          return false
        }
      }
      if (connectionFilter === 'connected' && a.connection_status !== 'connected') return false
      if (connectionFilter === 'not_connected' && a.connection_status === 'connected') return false
      if (!q) return true
      return assetHaystack(a).includes(q)
    })
  }, [assets, search, lifecycleFilter, riskFilter, connectionFilter])

  const selectedRows = useMemo(() => filtered.filter((a) => selected[a.id]), [filtered, selected])
  const selectedCount = selectedRows.length
  const allVisibleSelected = filtered.length > 0 && filtered.every((a) => selected[a.id])
  const someVisibleSelected = filtered.some((a) => selected[a.id])
  function toggleOne(id: string, on: boolean) {
    setSelected((prev) => {
      const next = { ...prev }
      if (on) next[id] = true
      else delete next[id]
      return next
    })
  }

  function toggleAllVisible(on: boolean) {
    setSelected((prev) => {
      const next = { ...prev }
      for (const a of filtered) {
        if (on) next[a.id] = true
        else delete next[a.id]
      }
      return next
    })
  }

  function closeMenus() {
    setBulkOpen(false)
    setBulkPanel('root')
    setRowMenuId(null)
    setRowMenuStyle(null)
    setRowPanel('root')
    setOwnerValue('')
    setOwnerQuery('')
    setDeletePreview(null)
    setDeleteReason('')
    setDeleteConfirmName('')
    setDeleteError('')
  }

  async function patchSelected(
    targets: RegistryAsset[],
    patch: Partial<RegistryAsset>,
    toastMsg?: string,
  ) {
    if (!targets.length || !session?.user || !orgId) return
    if (!canWriteRegistry) {
      setError('You do not have permission to update registry assets.')
      return
    }
    setBusy(true)
    setError('')
    const ids = targets.map((r) => r.id)
    const { error: err } = await sb.from('ai_systems').update(patch).in('id', ids).eq('org_id', orgId)
    if (err) {
      setBusy(false)
      setError(err.message)
      return
    }
    await sb.from('registry_audit_log').insert(
      targets.map((s) => ({
        org_id: orgId,
        user_id: session.user.id,
        action: 'system_updated',
        entity_type: 'ai_system',
        entity_id: s.id,
        changes: auditChangesFromPatch(s, patch as Record<string, unknown>, actor),
      })),
    )
    setBusy(false)
    if (toastMsg) pushToast(toastMsg)
    else pushToast(`Updated ${ids.length} asset${ids.length === 1 ? '' : 's'}.`)
    closeMenus()
    setSelected({})
    await load()
  }

  async function requestAssessment(targets: RegistryAsset[]) {
    if (!targets.length || !session?.user || !orgId) return
    if (!canWriteRegistry) {
      setError('You do not have permission to request assessments.')
      return
    }
    setBusy(true)
    setError('')
    const res = await requestRegistryAssessments({
      orgId,
      userId: session.user.id,
      actor,
      systems: targets.map((t) => ({ id: t.id, name: t.name })),
    })
    setBusy(false)
    closeMenus()
    if (res.error) {
      setError(res.error)
      return
    }
    if (res.added) {
      pushToast(
        targets.length === 1
          ? `Assessment for ${targets[0].name} added to My Tasks.`
          : `${res.added} assessment request${res.added === 1 ? '' : 's'} added to My Tasks.`,
      )
    } else {
      pushToast(
        targets.length === 1
          ? `Assessment for ${targets[0].name} is already in My Tasks.`
          : 'These assessment requests are already in My Tasks.',
      )
    }
  }

  async function openDeletePanel(targets: RegistryAsset[], fromRow: boolean) {
    setDeleteError('')
    setDeleteReason('')
    setDeleteConfirmName('')
    setDeletePreview(null)
    if (fromRow) setRowPanel('delete')
    else setBulkPanel('delete')
    if (targets.length !== 1) {
      setDeleteError('Delete one asset at a time from the row menu.')
      return
    }
    try {
      const preview = await fetchDeletePreview(targets[0].id)
      if (!preview.ok) throw new Error(preview.error || 'Unable to load delete preview.')
      setDeletePreview(preview)
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Unable to load delete preview.')
    }
  }

  async function confirmDelete(targets: RegistryAsset[]) {
    if (!canDeleteRegistry) {
      setDeleteError('Only organisation owners and admins can delete assets.')
      return
    }
    if (targets.length !== 1) {
      setDeleteError('Delete one asset at a time.')
      return
    }
    if (!deleteReason.trim()) {
      setDeleteError('A reason is required.')
      return
    }
    setBusy(true)
    setDeleteError('')
    try {
      const data = await deleteRegistryAsset({
        systemId: targets[0].id,
        reason: deleteReason.trim(),
        confirmName: deleteConfirmName.trim() || null,
      })
      if (!data.ok) throw new Error(data.error || 'Delete failed.')
      closeMenus()
      setSelected({})
      if (data.mode === 'review_requested') {
        pushToast('Deletion request submitted for review.')
      } else {
        pushToast(`Removed ${targets[0].name} from the registry.`)
        await load()
      }
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Delete failed.')
    } finally {
      setBusy(false)
    }
  }

  function openAdd() {
    if (!canWriteRegistry) {
      setError('You do not have permission to add registry assets.')
      return
    }
    const limit = registryAssetLimit(org?.plan)
    if (assets.length >= limit) {
      setError(registryLimitMessage(org?.plan))
      return
    }
    setAddForm(emptyAssetForm())
    setAddError('')
    setAddOpen(true)
  }

  async function submitAdd() {
    if (!session?.user || !orgId) return
    const v = validateAssetForm(addForm)
    if (v) {
      setAddError(v)
      return
    }
    const limit = registryAssetLimit(org?.plan)
    if (assets.length >= limit) {
      setAddError(`Your ${org?.plan || 'free'} plan allows ${limit >= 999 ? 'unlimited' : limit} AI system${limit !== 1 ? 's' : ''}. Upgrade to Professional for unlimited systems.`)
      return
    }
    setAddBusy(true)
    setAddError('')
    const payload = buildAssetPayload(addForm, orgId, session.user.id)
    payload.created_by = session.user.id
    const { error: err } = await sb.from('ai_systems').insert(payload)
    setAddBusy(false)
    if (err) {
      setAddError(err.message)
      return
    }
    setAddOpen(false)
    pushToast('Asset registered.')
    await load()
  }

  const highRisk = assets.filter((a) => {
    const t = (a.risk_tier || '').toLowerCase()
    return t === 'high' || t === 'unacceptable'
  }).length
  const inProd = assets.filter((a) => a.lifecycle === 'production').length
  const connected = assets.filter((a) => a.connection_status === 'connected').length

  function renderActionMenu(opts: {
    panel: BulkPanel
    setPanel: (p: BulkPanel) => void
    targets: RegistryAsset[]
    isRow: boolean
    canWrite: boolean
    canDelete: boolean
  }) {
    const { panel, setPanel, targets, isRow, canWrite, canDelete } = opts
    const n = targets.length
    const writeDisabled = !n || busy || !canWrite
    const exportDisabled = !n || busy
    const currentOwner = (targets[0]?.system_owner || '').trim()
    const currentLifecycle = targets[0]?.lifecycle || ''
    const q = ownerQuery.trim().toLowerCase()
    const memberMatches = orgMembers.filter((m) => {
      if (!q) return true
      return `${m.label} ${m.email}`.toLowerCase().includes(q)
    })
    const orphanOwner =
      currentOwner &&
      !orgMembers.some(
        (m) =>
          m.label.toLowerCase() === currentOwner.toLowerCase() ||
          m.email.toLowerCase() === currentOwner.toLowerCase(),
      )
        ? currentOwner
        : null
    const showOrphan =
      !!orphanOwner && (!q || orphanOwner.toLowerCase().includes(q))

    function ownerIsCurrent(label: string) {
      return !!currentOwner && currentOwner.toLowerCase() === label.toLowerCase()
    }

    if (panel === 'delete') {
      const preview = deletePreview
      return {
        body: (
        <div className={styles.statusPanel}>
          <button type="button" className={styles.bulkItem} onClick={() => setPanel('root')}>
            <span className={styles.bulkItemLabel}>Delete asset</span>
          </button>
          <div className={styles.confirmCopy}>
            {deleteError && !preview
              ? deleteError
              : preview?.pending_request
                ? `A deletion request for ${preview.system_name} is already pending RegAnchor review.`
                : preview?.requires_review
                  ? `This asset has governance history. Deletion of ${preview.system_name} will be submitted to RegAnchor for review.`
                  : preview
                    ? `Permanently remove ${preview.system_name} from your registry. A recoverable archive is kept for 30 days.`
                    : 'Loading delete preview…'}
          </div>
          {preview && !preview.pending_request ? (
            <>
              <label className={styles.deleteField}>
                <span>Reason</span>
                {isRow ? (
                  <textarea
                    className={styles.deleteTextarea}
                    rows={2}
                    value={deleteReason}
                    onChange={(e) => setDeleteReason(e.target.value)}
                    placeholder="Why is this asset being removed?"
                  />
                ) : (
                  <select
                    className={styles.ownerInput}
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
                )}
              </label>
              {!preview.requires_review ? (
                <label className={styles.deleteField}>
                  <span>Type asset name to confirm</span>
                  <input
                    className={styles.ownerInput}
                    value={deleteConfirmName}
                    onChange={(e) => setDeleteConfirmName(e.target.value)}
                    placeholder={preview.system_name || 'Exact asset name'}
                    autoComplete="off"
                  />
                </label>
              ) : null}
              {deleteError ? <div className={styles.deleteErr}>{deleteError}</div> : null}
              <button
                type="button"
                className={`${styles.bulkItem} ${styles.dangerItem}`}
                disabled={busy || !canDelete}
                onClick={() => void confirmDelete(targets)}
              >
                <span className={styles.bulkItemLabel}>Confirm deletion</span>
              </button>
            </>
          ) : null}
          <button type="button" className={styles.bulkItem} onClick={() => setPanel('root')}>
            <span className={styles.bulkItemLabel}>Cancel</span>
          </button>
        </div>
        ),
        flyout: null,
      }
    }

    const flyout =
      panel === 'lifecycle' ? (
        <div className={styles.flyout} style={{ top: flyoutTop }} role="menu" aria-label="Lifecycle">
          {DEPLOYMENT_OPTIONS.filter((s) => s !== 'decommissioned').map((s) => {
            const on = currentLifecycle === s
            return (
              <button
                key={s}
                type="button"
                className={`${styles.ownerOption} ${on ? styles.ownerOptionOn : ''}`}
                disabled={busy || !canWrite}
                onClick={() =>
                  void patchSelected(
                    targets.filter((t) => t.lifecycle !== s),
                    { lifecycle: s },
                    `Lifecycle set to ${labelLifecycle(s)}.`,
                  )
                }
              >
                <span className={styles.ownerOptionLabel}>{labelLifecycle(s)}</span>
                {on ? <Icon icon={Check} size="sm" className={styles.ownerTick} /> : null}
              </button>
            )
          })}
        </div>
      ) : panel === 'owner' ? (
        <div
          className={`${styles.flyout} ${styles.flyoutWide}`}
          style={{ top: flyoutTop }}
          role="menu"
          aria-label="Assign owner"
        >
          <div className={styles.ownerSearch}>
            <Icon icon={Search} size="sm" />
            <input
              ref={ownerSearchRef}
              className={styles.ownerSearchInput}
              value={ownerQuery}
              onChange={(e) => setOwnerQuery(e.target.value)}
              placeholder="Find member…"
              aria-label="Find member"
            />
          </div>
          <button
            type="button"
            className={`${styles.ownerOption} ${!currentOwner ? styles.ownerOptionOn : ''}`}
            disabled={busy || !canWrite}
            onClick={() => void patchSelected(targets, { system_owner: '' }, 'Owner cleared.')}
          >
            <span className={`${styles.ownerAvatar} ${styles.ownerAvatarEmpty}`} aria-hidden>
              <Icon icon={User} size="sm" />
            </span>
            <span className={styles.ownerOptionLabel}>No owner</span>
            {!currentOwner ? <Icon icon={Check} size="sm" className={styles.ownerTick} /> : null}
          </button>
          {showOrphan ? (
            <button
              type="button"
              className={`${styles.ownerOption} ${styles.ownerOptionOn}`}
              disabled={busy || !canWrite}
              onClick={() => void patchSelected(targets, { system_owner: orphanOwner }, 'Owner updated.')}
            >
              <span className={styles.ownerAvatar}>{ownerInitials(orphanOwner)}</span>
              <span className={styles.ownerOptionLabel}>{orphanOwner}</span>
              <Icon icon={Check} size="sm" className={styles.ownerTick} />
            </button>
          ) : null}
          {memberMatches.length === 0 && !showOrphan ? (
            <div className={styles.flyoutEmpty}>No members match.</div>
          ) : (
            memberMatches.map((m) => {
              const on = ownerIsCurrent(m.label) || ownerIsCurrent(m.email)
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`${styles.ownerOption} ${on ? styles.ownerOptionOn : ''}`}
                  disabled={busy || !canWrite}
                  onClick={() =>
                    void patchSelected(targets, { system_owner: m.label }, 'Owner updated.')
                  }
                >
                  <span className={styles.ownerAvatar}>{ownerInitials(m.label)}</span>
                  <span className={styles.ownerOptionLabel}>{m.email || m.label}</span>
                  {on ? <Icon icon={Check} size="sm" className={styles.ownerTick} /> : null}
                </button>
              )
            })
          )}
        </div>
      ) : panel === 'retire' ? (
        <div
          className={`${styles.flyout} ${styles.flyoutWide}`}
          style={{ top: flyoutTop }}
          role="menu"
          aria-label="Mark decommissioned"
        >
          <div className={styles.confirmCopy}>
            {n === 1
              ? `Decommission ${targets[0]?.name}? This sets lifecycle to Decommissioned.`
              : `Decommission ${n} assets? This sets lifecycle to Decommissioned.`}
          </div>
          <button
            type="button"
            className={styles.bulkItem}
            disabled={busy || !canWrite}
            onClick={() =>
              void patchSelected(
                targets.filter((t) => t.lifecycle !== 'decommissioned'),
                { lifecycle: 'decommissioned' },
                'Marked as decommissioned.',
              )
            }
          >
            <span className={styles.bulkItemLabel}>Decommission</span>
          </button>
          <button type="button" className={styles.bulkItem} onClick={() => setPanel('root')}>
            <span className={styles.bulkItemLabel}>Cancel</span>
          </button>
        </div>
      ) : null

    return {
      body: (
        <>
          <button
            type="button"
            className={styles.bulkItem}
            disabled={exportDisabled}
            onClick={() => {
              exportAssetsCsv(targets)
              pushToast(n === 1 ? 'Exported CSV.' : `Exported ${n} assets to CSV.`)
              closeMenus()
            }}
          >
            <span className={styles.bulkItemLabel}>Export CSV</span>
          </button>
          <button
            type="button"
            className={styles.bulkItem}
            disabled={writeDisabled}
            onClick={() => void requestAssessment(targets)}
          >
            <span className={styles.bulkItemLabel}>Request assessment</span>
          </button>
          <button
            ref={lifecycleItemRef}
            type="button"
            className={`${styles.bulkItem} ${panel === 'lifecycle' ? styles.bulkItemOn : ''}`}
            disabled={writeDisabled}
            aria-expanded={panel === 'lifecycle'}
            onClick={() => setPanel(panel === 'lifecycle' ? 'root' : 'lifecycle')}
          >
            <span className={styles.bulkItemLabel}>Set lifecycle</span>
            <Icon icon={ChevronRight} size="sm" className={styles.bulkItemChevron} />
          </button>
          <button
            ref={ownerItemRef}
            type="button"
            className={`${styles.bulkItem} ${panel === 'owner' ? styles.bulkItemOn : ''}`}
            disabled={writeDisabled}
            aria-expanded={panel === 'owner'}
            onClick={() => {
              setOwnerValue(targets[0]?.system_owner || '')
              setOwnerQuery('')
              setPanel(panel === 'owner' ? 'root' : 'owner')
            }}
          >
            <span className={styles.bulkItemLabel}>Assign owner</span>
            <Icon icon={ChevronRight} size="sm" className={styles.bulkItemChevron} />
          </button>
          <button
            ref={retireItemRef}
            type="button"
            className={`${styles.bulkItem} ${panel === 'retire' ? styles.bulkItemOn : ''}`}
            disabled={writeDisabled}
            aria-expanded={panel === 'retire'}
            onClick={() => setPanel(panel === 'retire' ? 'root' : 'retire')}
          >
            <span className={styles.bulkItemLabel}>Mark decommissioned</span>
            <Icon icon={ChevronRight} size="sm" className={styles.bulkItemChevron} />
          </button>
          {isRow && canDelete ? (
            <button
              type="button"
              className={`${styles.bulkItem} ${styles.dangerItem}`}
              disabled={!n || busy}
              onClick={() => void openDeletePanel(targets, true)}
            >
              <span className={styles.bulkItemLabel}>Delete asset</span>
            </button>
          ) : null}
        </>
      ),
      flyout,
    }
  }

  const columns = useMemo(
    () => [
      col.display({
        id: 'select',
        size: 44,
        meta: { selectOnly: true },
        header: () => (
          <span data-reg-check>
            <input
              type="checkbox"
              className={styles.check}
              checked={allVisibleSelected}
              ref={(el) => {
                if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected
              }}
              aria-label="Select all visible assets"
              onChange={(e) => toggleAllVisible(e.target.checked)}
              onClick={(e) => e.stopPropagation()}
            />
          </span>
        ),
        cell: ({ row }) => (
          <span data-reg-check onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              className={styles.check}
              checked={!!selected[row.original.id]}
              aria-label={`Select ${row.original.name}`}
              onChange={(e) => toggleOne(row.original.id, e.target.checked)}
              onClick={(e) => e.stopPropagation()}
            />
          </span>
        ),
        enableSorting: false,
      }),
      col.accessor('name', {
        header: 'Asset',
        meta: { flex: true },
        cell: (info) => {
          const row = info.row.original
          return (
            <div className={styles.assetCell}>
              <div className={styles.assetName}>{row.name}</div>
              {row.description ? (
                <DelayTip text={row.description} className={styles.assetDesc}>
                  {row.description}
                </DelayTip>
              ) : null}
            </div>
          )
        },
      }),
      col.accessor('connection_status', {
        header: 'Connection',
        size: 128,
        sortingFn: (a, b) => connectionSortRank(a.original.connection_status) - connectionSortRank(b.original.connection_status),
        meta: {
          filter: {
            label: 'Filter by Connection',
            value: connectionFilter,
            options: [
              { value: 'all', label: 'All' },
              {
                value: 'connected',
                label: 'Connected',
                badge: (
                  <StatusLabel badge tone="ok">
                    Connected
                  </StatusLabel>
                ),
              },
              {
                value: 'not_connected',
                label: 'Not connected',
                badge: (
                  <StatusLabel badge tone="warn">
                    Not connected
                  </StatusLabel>
                ),
              },
            ],
            onChange: (v) => {
              void setConnectionFilter(v)
            },
          },
        },
        cell: (info) => {
          const connected = info.getValue() === 'connected'
          return (
            <StatusLabel badge tone={connected ? 'ok' : 'warn'}>
              {connected ? 'Connected' : 'Not connected'}
            </StatusLabel>
          )
        },
      }),
      col.accessor('risk_tier', {
        header: 'Risk',
        size: 104,
        sortingFn: (a, b) => riskSortRank(a.original.risk_tier) - riskSortRank(b.original.risk_tier),
        meta: {
          filter: {
            label: 'Filter by Risk',
            value: riskFilter,
            options: [
              { value: 'all', label: 'All' },
              {
                value: 'high',
                label: 'High',
                badge: (
                  <StatusLabel badge tone={riskTone('high')}>
                    High
                  </StatusLabel>
                ),
              },
              {
                value: 'limited',
                label: 'Limited',
                badge: (
                  <StatusLabel badge tone={riskTone('limited')}>
                    Limited
                  </StatusLabel>
                ),
              },
              {
                value: 'minimal',
                label: 'Minimal',
                badge: (
                  <StatusLabel badge tone={riskTone('minimal')}>
                    Minimal
                  </StatusLabel>
                ),
              },
              {
                value: 'unclassified',
                label: 'Unclassified',
                badge: (
                  <StatusLabel badge tone={riskTone(null)}>
                    Unclassified
                  </StatusLabel>
                ),
              },
            ],
            onChange: (v) => {
              void setRiskFilter(v)
            },
          },
        },
        cell: (info) => (
          <StatusLabel badge tone={riskTone(info.getValue())}>
            {labelTier(info.getValue())}
          </StatusLabel>
        ),
      }),
      col.accessor('lifecycle', {
        header: 'Lifecycle',
        size: 112,
        meta: {
          filter: {
            label: 'Filter by Lifecycle',
            value: lifecycleFilter,
            options: DEPLOYMENT_FILTERS.map((s) => ({
              value: s,
              label: s === 'all' ? 'All' : labelLifecycle(s),
            })),
            onChange: (v) => {
              void setLifecycleFilter(v)
            },
          },
        },
        cell: (info) => <span className={styles.cellMeta}>{labelLifecycle(info.getValue())}</span>,
      }),
      col.accessor('provider_slug', {
        header: 'Provider',
        size: 100,
        cell: (info) => {
          const slug = (info.getValue() || '').trim()
          if (!slug) return <span className={styles.providerEmpty}>-</span>
          const name = labelProvider(slug)
          return (
            <span className={styles.providerCell} aria-label={name}>
              {hasBrandIcon(slug) ? <BrandIcon slug={slug} size={18} title={name} /> : name}
            </span>
          )
        },
      }),
      col.accessor('updated_at', {
        header: 'Updated',
        size: 120,
        meta: {
          sortLabels: {
            asc: 'Oldest first',
            desc: 'Newest first',
          },
        },
        cell: (info) => {
          const v = info.getValue()
          return (
            <span className={styles.cellDate}>
              {v
                ? new Date(v).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })
                : '-'}
            </span>
          )
        },
      }),
      col.display({
        id: 'actions',
        size: 44,
        header: () => null,
        cell: ({ row }) => {
          const id = row.original.id
          const open = rowMenuId === id
          return (
            <div className={styles.rowMore} data-row-more={id}>
              <button
                type="button"
                className={styles.moreBtn}
                aria-label={`Actions for ${row.original.name}`}
                aria-expanded={open}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (open) {
                    closeRowMenu()
                  } else {
                    openRowMenu(e.currentTarget, id, row.original.system_owner || '')
                  }
                }}
                onMouseDown={(e) => {
                  e.stopPropagation()
                }}
              >
                <Icon icon={MoreHorizontal} size="sm" />
              </button>
            </div>
          )
        },
        enableSorting: false,
      }),
    ],
    [
      allVisibleSelected,
      someVisibleSelected,
      selected,
      filtered,
      rowMenuId,
      canWriteRegistry,
      canDeleteRegistry,
      busy,
      ownerValue,
      deletePreview,
      deleteReason,
      deleteConfirmName,
      deleteError,
      riskFilter,
      connectionFilter,
      lifecycleFilter,
    ],
  )

  const visibleColumns = useMemo(
    () => (selectMode ? columns : columns.filter((c) => (c as { id?: string }).id !== 'select')),
    [columns, selectMode],
  )

  const rowMenuAsset = useMemo(
    () => (rowMenuId ? assets.find((a) => a.id === rowMenuId) || null : null),
    [assets, rowMenuId],
  )

  const previewAsset = useMemo(
    () => (previewId ? assets.find((a) => a.id === previewId) || null : null),
    [assets, previewId],
  )

  return (
    <PageFrame railItems={[{ id: 'inventory', label: 'Inventory' }]}>
      <PageHeader
        title="Registry"
        description="AI assets in this organisation."
        actions={
          canWriteRegistry ? (
            <Button size="sm" onClick={openAdd}>
              Add asset
            </Button>
          ) : null
        }
      />

      <div className={styles.registryBody} id="inventory">
        {!loading ? (
          <div className={styles.stats}>
            <MetricStrip
              items={[
                { id: 'total', label: 'Total', value: assets.length },
                { id: 'high', label: 'High risk', value: highRisk, tone: highRisk ? 'risk' : 'ok' },
                { id: 'prod', label: 'In production', value: inProd },
                { id: 'connected', label: 'Connected', value: connected },
              ]}
            />
          </div>
        ) : null}

        <div className={styles.toolbar}>
          <div className={styles.chipsRail}>
            {chipOverflow.left ? (
              <button
                type="button"
                className={styles.chipArrow}
                aria-label="Previous status filters"
                onClick={() => scrollChips(-1)}
              >
                <Icon icon={ChevronLeft} size="sm" />
              </button>
            ) : null}
            <div
              className={styles.chips}
              data-ra-noscroll
              role="tablist"
              aria-label="Lifecycle"
              ref={chipsTrackRef}
            >
              {DEPLOYMENT_FILTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={lifecycleFilter === s}
                  className={`${styles.chip} ${lifecycleFilter === s ? styles.chipOn : ''}`}
                  onClick={() => {
                    void setLifecycleFilter(s)
                    // Keep active chip visible when selecting from overflow.
                    requestAnimationFrame(() => {
                      const track = chipsTrackRef.current
                      const btn = track?.querySelector<HTMLElement>(`[aria-selected="true"]`)
                      btn?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
                      updateChipOverflow()
                    })
                  }}
                >
                  {s === 'all' ? 'All' : labelLifecycle(s)}
                </button>
              ))}
            </div>
            {chipOverflow.right ? (
              <button
                type="button"
                className={styles.chipArrow}
                aria-label="More status filters"
                onClick={() => scrollChips(1)}
              >
                <Icon icon={ChevronRight} size="sm" />
              </button>
            ) : null}
          </div>

          <div className={styles.toolbarTools}>
            <input
              className={styles.search}
              type="search"
              value={search}
              placeholder="Search assets"
              onChange={(e) => {
                const value = e.target.value
                startTransition(() => {
                  void setSearch(value || null)
                })
              }}
            />

            <div className={styles.bulk} ref={bulkRef}>
              <Button
                variant="ghost"
                size="sm"
                selected={selectMode}
                onClick={toggleBulk}
                aria-expanded={bulkOpen}
              >
                Bulk actions{selectedCount ? ` (${selectedCount})` : ''}
                <Icon icon={ChevronDown} size="sm" />
              </Button>
              {bulkOpen && selectMode ? (
                <div className={styles.bulkMenuShell} ref={bulkShellRef}>
                  {(() => {
                    const menu = renderActionMenu({
                      panel: bulkPanel,
                      setPanel: setBulkPanel,
                      targets: selectedRows,
                      isRow: false,
                      canWrite: canWriteRegistry,
                      canDelete: canDeleteRegistry,
                    })
                    return (
                      <>
                        <div className={styles.bulkMenu} role="menu">
                          <div className={styles.bulkMeta}>
                            {selectedCount ? `${selectedCount} selected` : 'Select systems in the table'}
                          </div>
                          {menu.body}
                          {bulkPanel !== 'delete' ? (
                            <button type="button" className={styles.bulkDone} onClick={exitSelectMode}>
                              Done
                            </button>
                          ) : null}
                        </div>
                        {menu.flyout}
                      </>
                    )
                  })()}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {error ? <div className={styles.bannerRisk}>{error}</div> : null}

        {loading ? (
          <BrandLoader fill label="Loading registry" />
        ) : (
          <div data-reg-table className={selectMode ? styles.tableSelecting : undefined}>
            <DataTable
              data={filtered}
              columns={visibleColumns}
              getRowId={(row) => row.id}
              initialSorting={[{ id: 'updated_at', desc: true }]}
              onRowClick={(row) => {
                if (selectMode) {
                  toggleOne(row.id, !selected[row.id])
                  return
                }
                setPreviewId(row.id)
              }}
              empty={
                <EmptyState
                  title={
                    search || lifecycleFilter !== 'all' || riskFilter !== 'all' || connectionFilter !== 'all'
                      ? 'No matches'
                      : 'No assets yet'
                  }
                  body={
                    search || lifecycleFilter !== 'all' || riskFilter !== 'all' || connectionFilter !== 'all'
                      ? 'Try a different search or filter.'
                      : 'Register your first AI asset to begin governance inventory.'
                  }
                  action={
                    canWriteRegistry ? (
                      <Button onClick={openAdd}>Add asset</Button>
                    ) : undefined
                  }
                />
              }
            />
          </div>
        )}
      </div>

      <Drawer
        open={addOpen}
        title="Add AI asset"
        description="Register an AI asset in your inventory."
        onClose={() => setAddOpen(false)}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void submitAdd()} pending={addBusy}>
              Register asset
            </Button>
          </>
        }
      >
        <AssetFormFields form={addForm} providers={providers} error={addError} onChange={setAddForm} />
      </Drawer>

      <Drawer
        open={!!previewAsset && !!orgId}
        variant="preview"
        title={previewAsset?.name || 'Asset'}
        headerMeta={previewAsset ? <AssetPreviewMeta asset={previewAsset} /> : null}
        onClose={() => setPreviewId(null)}
        footer={
          previewAsset ? (
            <Button
              size="sm"
              onClick={() => {
                const id = previewAsset.id
                setPreviewId(null)
                navigate(`/registry/${id}`)
              }}
            >
              Open
            </Button>
          ) : null
        }
      >
        {previewAsset && orgId ? <AssetPreview key={previewAsset.id} asset={previewAsset} orgId={orgId} /> : null}
      </Drawer>

      {rowMenuId && rowMenuStyle && rowMenuAsset
        ? createPortal(
            (() => {
              const menu = renderActionMenu({
                panel: rowPanel,
                setPanel: setRowPanel,
                targets: [rowMenuAsset],
                isRow: true,
                canWrite: canWriteRegistry,
                canDelete: canDeleteRegistry,
              })
              const { maxHeight, ...shellPos } = rowMenuStyle
              return (
                <div
                  ref={rowMenuRef}
                  className={styles.rowMenuShell}
                  style={shellPos}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div
                    className={styles.rowMenu}
                    role="menu"
                    style={
                      maxHeight
                        ? { maxHeight, overflowY: rowPanel === 'delete' ? 'auto' : 'visible' }
                        : undefined
                    }
                  >
                    {menu.body}
                  </div>
                  {menu.flyout}
                </div>
              )
            })(),
            document.body,
          )
        : null}

      <ToastStack items={toasts} onDismiss={dismissToast} />
    </PageFrame>
  )
}
