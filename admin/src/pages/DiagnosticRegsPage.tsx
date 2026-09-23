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

type RegRow = {
  id: string
  regime: string
  article: string
  obligation: string
  requirement_type: string
  penalty: string | null
  deadline: string | null
  display_order: number | null
  is_active: boolean | null
}

const CSV_HEADERS = ['regime', 'article', 'obligation', 'requirement_type', 'penalty', 'deadline', 'is_active', 'display_order']

const TYPE_OPTIONS = [
  { value: 'M', label: 'Mandatory' },
  { value: 'A', label: 'Advisory' },
]

function regCsvRow(row: RegRow) {
  return [
    row.regime,
    row.article,
    row.obligation,
    row.requirement_type,
    row.penalty,
    row.deadline,
    row.is_active,
    row.display_order,
  ]
}

export function DiagnosticRegsPage() {
  usePageChrome({
    title: 'Diagnostic regs',
    breadcrumbs: [{ label: 'Engines' }, { label: 'Diagnostic regs' }],
  })

  const [rows, setRows] = useState<RegRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<RegRow | null>(null)
  const [dirty, setDirty] = useState(false)
  const [publishing, setPublishing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: qErr } = await sb
        .from('diagnostic_regs')
        .select('id,regime,article,obligation,requirement_type,penalty,deadline,display_order,is_active')
        .order('display_order', { ascending: true })
      if (qErr) throw qErr
      setRows((data as RegRow[]) || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load diagnostic regs.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) =>
      [row.regime, row.article, row.obligation, row.penalty, row.deadline]
        .filter((v) => v != null && String(v).length)
        .some((v) => String(v).toLowerCase().includes(q)),
    )
  }, [rows, search])

  const selection = useCatalogueSelection(filtered.map((r) => r.id))

  function exportRows(list: RegRow[]) {
    downloadCsv(
      `reganchor-diagnostic-regs-${new Date().toISOString().slice(0, 10)}.csv`,
      CSV_HEADERS,
      list.map(regCsvRow),
    )
    setNotice(list.length === 1 ? 'Exported 1 reg row to CSV.' : `Exported ${list.length} reg rows to CSV.`)
  }

  function openRow(row: RegRow) {
    setDraft({ ...row })
    setDirty(false)
    setNotice('')
    setError('')
    setOpen(true)
  }

  function patchDraft(partial: Partial<RegRow>) {
    setDraft((prev) => (prev ? { ...prev, ...partial } : prev))
    setDirty(true)
  }

  async function saveAndPublish() {
    if (!draft) return
    if (
      !window.confirm(
        'Publish these diagnostic reg rows? New diagnostic PDFs will use the active rows from this table.',
      )
    ) {
      return
    }
    setPublishing(true)
    setError('')
    setNotice('')
    try {
      const { data, error: uErr } = await sb
        .from('diagnostic_regs')
        .update({
          regime: draft.regime.trim(),
          article: draft.article.trim(),
          obligation: draft.obligation.trim(),
          requirement_type: draft.requirement_type === 'A' ? 'A' : 'M',
          penalty: draft.penalty?.trim() || null,
          deadline: draft.deadline?.trim() || null,
          display_order: Number(draft.display_order) || 0,
          is_active: draft.is_active !== false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', draft.id)
        .select('id')
        .maybeSingle()
      if (uErr) throw uErr
      if (!data) throw new Error('Publish blocked — no row updated.')
      setDirty(false)
      setNotice('Published to diagnostic engine.')
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
        <PageHeader title="Diagnostic regs" description="Regulatory overview rows for the risk diagnostic PDF." />
        <BrandLoader fill label="Loading regs" />
      </PageFrame>
    )
  }

  return (
    <PageFrame>
      <PageHeader
        title="Diagnostic regs"
        description="Engine copy for the diagnostic PDF regulatory table. Separate from Methodology frameworks and mappings."
      />
      {error && !open ? <Notice tone="risk">{error}</Notice> : null}
      {notice && !open ? <Notice tone="quiet">{notice}</Notice> : null}

      <CatalogueToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search regs"
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
          title={rows.length ? 'No matches' : 'No diagnostic regs'}
          body={rows.length ? 'Try a different search.' : 'diagnostic_regs returned no rows.'}
        />
      ) : (
        <Ledger>
          {filtered.map((row) => {
            const label = `${row.regime} · ${row.article}`
            return (
              <LedgerRow
                key={row.id}
                title={label}
                description={[
                  row.obligation,
                  row.requirement_type === 'A' ? 'Advisory' : 'Mandatory',
                  row.is_active === false ? 'Inactive' : 'Active',
                ].join(' · ')}
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
        title={draft ? `${draft.regime} · ${draft.article}` : 'Reg row'}
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
            <label className={styles.label}>
              Regime
              <input
                className={styles.input}
                value={draft.regime}
                onChange={(e) => patchDraft({ regime: e.target.value })}
              />
            </label>
            <label className={styles.label}>
              Article
              <input
                className={styles.input}
                value={draft.article}
                onChange={(e) => patchDraft({ article: e.target.value })}
              />
            </label>
            <label className={styles.label}>
              Obligation
              <textarea
                className={styles.textarea}
                rows={3}
                value={draft.obligation}
                onChange={(e) => patchDraft({ obligation: e.target.value })}
              />
            </label>
            <div className={styles.label}>
              Type
              <SelectMenu
                aria-label="Requirement type"
                value={draft.requirement_type === 'A' ? 'A' : 'M'}
                options={TYPE_OPTIONS}
                onChange={(value) => patchDraft({ requirement_type: value })}
              />
            </div>
            <label className={styles.label}>
              Penalty
              <input
                className={styles.input}
                value={draft.penalty || ''}
                onChange={(e) => patchDraft({ penalty: e.target.value })}
              />
            </label>
            <label className={styles.label}>
              Deadline
              <input
                className={styles.input}
                value={draft.deadline || ''}
                onChange={(e) => patchDraft({ deadline: e.target.value })}
              />
            </label>
            <label className={styles.label}>
              Display order
              <input
                className={styles.input}
                type="number"
                value={draft.display_order ?? 0}
                onChange={(e) => patchDraft({ display_order: Number(e.target.value) })}
              />
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
        ) : null}
      </Drawer>
    </PageFrame>
  )
}
