import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BrandLoader,
  Button,
  Drawer,
  EmptyState,
  Ledger,
  LedgerRow,
  Notice,
  PageFrame,
  PageHeader,
  SelectMenu,
  StatusLabel,
} from '@ra/ui'
import { usePageChrome } from '@ra/ui/shellChrome'
import { sb } from '../lib/supabase'
import { downloadCsv } from '../lib/csv'
import { CatalogueRowActions, CatalogueToolbar, useCatalogueSelection } from '../components/CatalogueListTools'
import styles from './Catalogue.module.css'

type ControlOpt = { id: string; control_number: number | null; title: string | null }
type ObligationOpt = {
  id: string
  framework: string | null
  obligation_title: string | null
  article_reference: string | null
  obligation_key: string | null
}

type MapRow = {
  id: string
  control_id: string
  obligation_id: string
  requirement_id: string | null
  is_primary: boolean
  source_citation: string | null
  interpretation_note: string | null
  display_order: number | null
  is_active: boolean | null
}

const FRAMEWORK_LABELS: Record<string, string> = {
  eu_ai_act: 'EU AI Act',
  uk_gdpr: 'UK GDPR',
  fca: 'FCA',
}

const CSV_HEADERS = [
  'control_number',
  'control_title',
  'framework',
  'article_reference',
  'obligation_title',
  'is_primary',
  'interpretation_note',
  'source_citation',
  'display_order',
  'is_active',
]

function frameworkLabel(key: string | null | undefined) {
  if (!key) return 'Framework'
  return FRAMEWORK_LABELS[key] || key.replace(/_/g, ' ')
}

function mappingCsvRow(
  row: MapRow,
  controlById: Map<string, ControlOpt>,
  obligationById: Map<string, ObligationOpt>,
) {
  const c = controlById.get(row.control_id)
  const o = obligationById.get(row.obligation_id)
  return [
    c?.control_number,
    c?.title,
    o?.framework,
    o?.article_reference,
    o?.obligation_title,
    row.is_primary,
    row.interpretation_note,
    row.source_citation,
    row.display_order,
    row.is_active,
  ]
}

function blankDraft(controlId = '', obligationId = ''): MapRow {
  return {
    id: '',
    control_id: controlId,
    obligation_id: obligationId,
    requirement_id: null,
    is_primary: true,
    source_citation: '',
    interpretation_note: '',
    display_order: 10,
    is_active: true,
  }
}

export function MappingsPage() {
  usePageChrome({
    title: 'Mappings',
    breadcrumbs: [{ label: 'Mappings' }],
  })

  const [maps, setMaps] = useState<MapRow[]>([])
  const [controls, setControls] = useState<ControlOpt[]>([])
  const [obligations, setObligations] = useState<ObligationOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [isNew, setIsNew] = useState(false)
  const [draft, setDraft] = useState<MapRow | null>(null)
  const [dirty, setDirty] = useState(false)
  const [publishing, setPublishing] = useState(false)

  const controlById = useMemo(() => new Map(controls.map((c) => [c.id, c])), [controls])
  const obligationById = useMemo(() => new Map(obligations.map((o) => [o.id, o])), [obligations])

  const controlOptions = useMemo(
    () =>
      controls.map((c) => ({
        value: c.id,
        label: `C${c.control_number ?? '—'} · ${c.title || 'Untitled'}`,
      })),
    [controls],
  )

  const obligationOptions = useMemo(
    () =>
      obligations.map((o) => ({
        value: o.id,
        label: `${frameworkLabel(o.framework)} · ${o.article_reference || o.obligation_key || '—'} · ${
          o.obligation_title || 'Obligation'
        }`,
      })),
    [obligations],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [mapsRes, controlsRes, obligationsRes] = await Promise.all([
        sb
          .from('control_requirement_map')
          .select(
            'id,control_id,obligation_id,requirement_id,is_primary,source_citation,interpretation_note,display_order,is_active',
          )
          .order('display_order', { ascending: true }),
        sb
          .from('governance_controls')
          .select('id,control_number,title')
          .order('control_number', { ascending: true }),
        sb
          .from('compliance_frameworks')
          .select('id,framework,obligation_title,article_reference,obligation_key')
          .eq('is_active', true)
          .order('framework')
          .order('display_order'),
      ])
      if (mapsRes.error) throw mapsRes.error
      if (controlsRes.error) throw controlsRes.error
      if (obligationsRes.error) throw obligationsRes.error
      setMaps((mapsRes.data as MapRow[]) || [])
      setControls((controlsRes.data as ControlOpt[]) || [])
      setObligations((obligationsRes.data as ObligationOpt[]) || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load mappings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const sortedMaps = useMemo(() => {
    return [...maps].sort((a, b) => {
      const ca = controlById.get(a.control_id)?.control_number ?? 999
      const cb = controlById.get(b.control_id)?.control_number ?? 999
      if (ca !== cb) return ca - cb
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1
      return (a.display_order ?? 0) - (b.display_order ?? 0)
    })
  }, [maps, controlById])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sortedMaps
    return sortedMaps.filter((row) => {
      const c = controlById.get(row.control_id)
      const o = obligationById.get(row.obligation_id)
      return [c?.control_number, c?.title, frameworkLabel(o?.framework), o?.framework, o?.article_reference, o?.obligation_title]
        .filter((v) => v != null && String(v).length)
        .some((v) => String(v).toLowerCase().includes(q))
    })
  }, [sortedMaps, search, controlById, obligationById])

  const selection = useCatalogueSelection(filtered.map((r) => r.id))

  function exportRows(list: MapRow[]) {
    downloadCsv(
      `reganchor-mappings-${new Date().toISOString().slice(0, 10)}.csv`,
      CSV_HEADERS,
      list.map((row) => mappingCsvRow(row, controlById, obligationById)),
    )
    setNotice(list.length === 1 ? 'Exported 1 mapping to CSV.' : `Exported ${list.length} mappings to CSV.`)
  }

  function openRow(row: MapRow) {
    setIsNew(false)
    setDraft({ ...row })
    setDirty(false)
    setNotice('')
    setError('')
    setOpen(true)
  }

  function openNew() {
    const firstControl = controls[0]?.id || ''
    const firstObligation = obligations[0]?.id || ''
    setIsNew(true)
    setDraft(blankDraft(firstControl, firstObligation))
    setDirty(true)
    setNotice('')
    setError('')
    setOpen(true)
  }

  function patchDraft(partial: Partial<MapRow>) {
    setDraft((prev) => (prev ? { ...prev, ...partial } : prev))
    setDirty(true)
  }

  async function saveAndPublish() {
    if (!draft) return
    if (!draft.control_id || !draft.obligation_id) {
      setError('Choose a control and an obligation.')
      return
    }
    if (
      !window.confirm(
        'Publish this mapping to the live catalogue? New dossiers will use it for governance basis immediately.',
      )
    ) {
      return
    }
    setPublishing(true)
    setError('')
    setNotice('')
    try {
      const payload = {
        control_id: draft.control_id,
        obligation_id: draft.obligation_id,
        is_primary: Boolean(draft.is_primary),
        source_citation: draft.source_citation?.trim() || null,
        interpretation_note: draft.interpretation_note?.trim() || null,
        display_order: Number(draft.display_order) || 0,
        is_active: draft.is_active !== false,
        updated_at: new Date().toISOString(),
      }

      if (isNew || !draft.id) {
        const { data, error: iErr } = await sb
          .from('control_requirement_map')
          .insert(payload)
          .select('id')
          .maybeSingle()
        if (iErr) throw iErr
        if (!data) throw new Error('Publish blocked — mapping was not created.')
        setDraft((prev) => (prev ? { ...prev, id: data.id } : prev))
        setIsNew(false)
      } else {
        const { data, error: uErr } = await sb
          .from('control_requirement_map')
          .update(payload)
          .eq('id', draft.id)
          .select('id')
          .maybeSingle()
        if (uErr) throw uErr
        if (!data) throw new Error('Publish blocked — no row updated. Check MLA admin write access.')
      }

      setDirty(false)
      setNotice('Published to live catalogue.')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publish failed.')
    } finally {
      setPublishing(false)
    }
  }

  if (loading) {
    return (
      <PageFrame>
        <PageHeader title="Mappings" description="Control ↔ obligation join for dossier governance basis." />
        <BrandLoader fill label="Loading mappings" />
      </PageFrame>
    )
  }

  return (
    <PageFrame>
      <PageHeader
        title="Mappings"
        description="Link catalogue controls to framework obligations and articles. Changes go live only when you Save & Publish."
        actions={
          <Button size="sm" variant="ghost" onClick={openNew} disabled={!controls.length || !obligations.length}>
            Add mapping
          </Button>
        }
      />
      {error && !open ? <Notice tone="risk">{error}</Notice> : null}
      {notice && !open ? <Notice tone="quiet">{notice}</Notice> : null}

      <CatalogueToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search mappings"
        selectMode={selection.selectMode}
        selectedCount={selection.selectedCount}
        visibleCount={selection.visibleCount}
        allVisibleSelected={selection.allVisibleSelected}
        someVisibleSelected={selection.someVisibleSelected}
        onToggleBulk={selection.toggleBulk}
        onToggleAllVisible={selection.toggleAllVisible}
        onExportSelected={() => {
          const list = filtered.filter((r) => selection.selectedIds.includes(r.id))
          exportRows(list)
        }}
      />

      {filtered.length === 0 ? (
        <EmptyState
          title={sortedMaps.length ? 'No matches' : 'No mappings'}
          body={
            sortedMaps.length
              ? 'Try a different search.'
              : 'Add a control ↔ obligation link to seed dossier governance basis.'
          }
        />
      ) : (
        <Ledger>
          {filtered.map((row) => {
            const c = controlById.get(row.control_id)
            const o = obligationById.get(row.obligation_id)
            const label = `C${c?.control_number ?? '—'} · ${c?.title || 'Control'}`
            const desc = [
              frameworkLabel(o?.framework),
              o?.article_reference || 'No article',
              o?.obligation_title || 'Obligation',
              row.is_primary ? 'Primary' : 'Secondary',
              row.is_active === false ? 'Inactive' : 'Active',
            ].join(' · ')
            return (
              <LedgerRow
                key={row.id}
                title={label}
                description={desc}
                meta={
                  <CatalogueRowActions
                    label={label}
                    selectMode={selection.selectMode}
                    selected={!!selection.selected[row.id]}
                    onToggleSelect={(checked) => selection.toggleOne(row.id, checked)}
                    onEdit={() => openRow(row)}
                    onExportRow={() => exportRows([row])}
                  />
                }
              />
            )
          })}
        </Ledger>
      )}

      <Drawer
        open={open}
        onClose={() => {
          if (dirty && !window.confirm('Discard unpublished changes?')) return
          setOpen(false)
        }}
        title={isNew ? 'New mapping' : 'Edit mapping'}
        footer={
          <div className={styles.footer}>
            {dirty ? <StatusLabel tone="warn">Unpublished changes</StatusLabel> : null}
            {!dirty && notice ? <StatusLabel tone="ok">Published</StatusLabel> : null}
            <Button pending={publishing} disabled={!dirty} onClick={() => void saveAndPublish()}>
              Save & Publish
            </Button>
          </div>
        }
      >
        {error ? <Notice tone="risk">{error}</Notice> : null}
        {notice && !dirty ? <Notice tone="quiet">{notice}</Notice> : null}
        {draft ? (
          <div className={styles.form}>
            <div className={styles.label}>
              Control
              <SelectMenu
                aria-label="Control"
                value={draft.control_id}
                options={controlOptions}
                onChange={(value) => patchDraft({ control_id: value })}
              />
            </div>
            <div className={styles.label}>
              Obligation
              <SelectMenu
                aria-label="Obligation"
                value={draft.obligation_id}
                options={obligationOptions}
                onChange={(value) => patchDraft({ obligation_id: value })}
              />
            </div>
            <div className={styles.checks}>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={Boolean(draft.is_primary)}
                  onChange={(e) => patchDraft({ is_primary: e.target.checked })}
                />
                Primary basis
              </label>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={draft.is_active !== false}
                  onChange={(e) => patchDraft({ is_active: e.target.checked })}
                />
                Active
              </label>
            </div>
            <label className={styles.label}>
              Display order
              <input
                className={styles.input}
                type="number"
                value={draft.display_order ?? 0}
                onChange={(e) => patchDraft({ display_order: Number(e.target.value) })}
              />
            </label>
            <label className={styles.label}>
              Source citation
              <input
                className={styles.input}
                value={draft.source_citation || ''}
                onChange={(e) => patchDraft({ source_citation: e.target.value })}
                placeholder="Optional citation note"
              />
            </label>
            <label className={styles.label}>
              Interpretation note
              <textarea
                className={styles.textarea}
                rows={4}
                value={draft.interpretation_note || ''}
                onChange={(e) => patchDraft({ interpretation_note: e.target.value })}
                placeholder="How this control supports the obligation"
              />
            </label>
          </div>
        ) : null}
      </Drawer>
    </PageFrame>
  )
}
