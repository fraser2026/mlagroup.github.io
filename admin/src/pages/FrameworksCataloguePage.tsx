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
  StatusLabel,
} from '@ra/ui'
import { usePageChrome } from '@ra/ui/shellChrome'
import { sb } from '../lib/supabase'
import { downloadCsv } from '../lib/csv'
import { CatalogueRowActions, CatalogueToolbar, useCatalogueSelection } from '../components/CatalogueListTools'
import styles from './Catalogue.module.css'

type FrameworkRow = {
  id: string
  framework: string | null
  obligation_key: string | null
  obligation_title: string | null
  obligation_description: string | null
  guidance_text: string | null
  article_reference: string | null
  display_order: number | null
  is_active: boolean | null
}

const CSV_HEADERS = [
  'framework',
  'obligation_key',
  'obligation_title',
  'obligation_description',
  'guidance_text',
  'article_reference',
  'is_active',
]

function frameworkCsvRow(row: FrameworkRow) {
  return [
    row.framework,
    row.obligation_key,
    row.obligation_title,
    row.obligation_description,
    row.guidance_text,
    row.article_reference,
    row.is_active,
  ]
}

export function FrameworksCataloguePage() {
  usePageChrome({
    title: 'Frameworks',
    breadcrumbs: [{ label: 'Frameworks' }],
  })

  const [rows, setRows] = useState<FrameworkRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<FrameworkRow | null>(null)
  const [dirty, setDirty] = useState(false)
  const [publishing, setPublishing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: qErr } = await sb
        .from('compliance_frameworks')
        .select(
          'id,framework,obligation_key,obligation_title,obligation_description,guidance_text,article_reference,display_order,is_active',
        )
        .order('framework', { ascending: true })
        .order('display_order', { ascending: true })
      if (qErr) throw qErr
      setRows((data as FrameworkRow[]) || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load frameworks.')
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
      [row.framework, row.obligation_key, row.obligation_title, row.article_reference, row.guidance_text]
        .filter((v) => v != null && String(v).length)
        .some((v) => String(v).toLowerCase().includes(q)),
    )
  }, [rows, search])

  const selection = useCatalogueSelection(filtered.map((r) => r.id))

  function exportRows(list: FrameworkRow[]) {
    downloadCsv(
      `reganchor-frameworks-${new Date().toISOString().slice(0, 10)}.csv`,
      CSV_HEADERS,
      list.map(frameworkCsvRow),
    )
    setNotice(list.length === 1 ? 'Exported 1 framework row to CSV.' : `Exported ${list.length} framework rows to CSV.`)
  }

  function openRow(row: FrameworkRow) {
    setDraft({ ...row })
    setDirty(false)
    setNotice('')
    setError('')
    setOpen(true)
  }

  function patchDraft(partial: Partial<FrameworkRow>) {
    setDraft((prev) => (prev ? { ...prev, ...partial } : prev))
    setDirty(true)
  }

  async function saveAndPublish() {
    if (!draft) return
    if (
      !window.confirm(
        'Publish these changes to the live catalogue? Customer app, assessments, and new dossiers will use them immediately.',
      )
    ) {
      return
    }
    setPublishing(true)
    setError('')
    setNotice('')
    try {
      const { data: updated, error: uErr } = await sb
        .from('compliance_frameworks')
        .update({
          framework: draft.framework,
          obligation_key: draft.obligation_key,
          obligation_title: draft.obligation_title,
          obligation_description: draft.obligation_description,
          guidance_text: draft.guidance_text,
          article_reference: draft.article_reference,
          is_active: draft.is_active,
        })
        .eq('id', draft.id)
        .select('id,obligation_title')
        .maybeSingle()
      if (uErr) throw uErr
      if (!updated) {
        throw new Error('Publish blocked — no row updated. Check MLA admin write access.')
      }
      setDraft((prev) => (prev ? { ...prev, obligation_title: updated.obligation_title } : prev))
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
        <PageHeader title="Frameworks" description="Framework requirements and article references." />
        <BrandLoader fill label="Loading frameworks" />
      </PageFrame>
    )
  }

  return (
    <PageFrame>
      <PageHeader
        title="Frameworks"
        description="Edit obligations and article references. Changes go live only when you Save & Publish."
      />
      {error && !open ? <Notice tone="risk">{error}</Notice> : null}
      {notice && !open ? <Notice tone="quiet">{notice}</Notice> : null}

      <CatalogueToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search frameworks"
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
          title={rows.length ? 'No matches' : 'No framework rows'}
          body={rows.length ? 'Try a different search.' : 'compliance_frameworks returned no rows.'}
        />
      ) : (
        <Ledger>
          {filtered.map((row) => {
            const label = row.obligation_title || row.obligation_key || 'Untitled obligation'
            return (
              <LedgerRow
                key={row.id}
                title={label}
                description={[
                  row.framework || 'Framework unset',
                  row.article_reference || 'No article reference',
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
        title={draft?.obligation_title || 'Requirement'}
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
              Framework
              <input
                className={styles.input}
                value={draft.framework || ''}
                onChange={(e) => patchDraft({ framework: e.target.value })}
              />
            </label>
            <label className={styles.label}>
              Obligation key
              <input
                className={styles.input}
                value={draft.obligation_key || ''}
                onChange={(e) => patchDraft({ obligation_key: e.target.value })}
              />
            </label>
            <label className={styles.label}>
              Obligation title
              <input
                className={styles.input}
                value={draft.obligation_title || ''}
                onChange={(e) => patchDraft({ obligation_title: e.target.value })}
              />
            </label>
            <label className={styles.label}>
              Article reference
              <input
                className={styles.input}
                value={draft.article_reference || ''}
                onChange={(e) => patchDraft({ article_reference: e.target.value })}
              />
            </label>
            <label className={styles.label}>
              Description
              <textarea
                className={styles.textarea}
                rows={4}
                value={draft.obligation_description || ''}
                onChange={(e) => patchDraft({ obligation_description: e.target.value })}
              />
            </label>
            <label className={styles.label}>
              Guidance
              <textarea
                className={styles.textarea}
                rows={4}
                value={draft.guidance_text || ''}
                onChange={(e) => patchDraft({ guidance_text: e.target.value })}
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
