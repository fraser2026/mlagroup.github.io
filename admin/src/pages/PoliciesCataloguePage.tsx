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

type PolicyTemplate = {
  id: string
  title: string | null
  description: string | null
  content_template: string | null
  category: string | null
  linked_control_number: number | null
  display_order: number | null
  is_active: boolean | null
  created_at: string | null
}

const POLICY_CATS: Record<string, string> = {
  ai_governance: 'AI Governance',
  data_protection: 'Data Protection',
  acceptable_use: 'Acceptable Use',
  risk_management: 'Risk Management',
  security: 'Security',
  ethics: 'Ethics',
  other: 'Other',
}

const CSV_HEADERS = [
  'title',
  'category',
  'linked_control_number',
  'description',
  'is_active',
  'display_order',
]

function policyCsvRow(row: PolicyTemplate) {
  return [
    row.title,
    row.category,
    row.linked_control_number,
    row.description,
    row.is_active,
    row.display_order,
  ]
}

function categoryLabel(key: string | null | undefined) {
  if (!key) return 'Uncategorised'
  return POLICY_CATS[key] || key.replace(/_/g, ' ')
}

export function PoliciesCataloguePage() {
  usePageChrome({
    title: 'Policy templates',
    breadcrumbs: [{ label: 'Policy templates' }],
  })

  const [rows, setRows] = useState<PolicyTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<PolicyTemplate | null>(null)
  const [dirty, setDirty] = useState(false)
  const [publishing, setPublishing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: qErr } = await sb
        .from('policy_templates')
        .select(
          'id,title,description,content_template,category,linked_control_number,display_order,is_active,created_at',
        )
        .order('display_order', { ascending: true })
      if (qErr) throw qErr
      setRows((data as PolicyTemplate[]) || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load policy templates.')
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
      [row.title, row.description, row.category, categoryLabel(row.category)]
        .filter((v) => v != null && String(v).length)
        .some((v) => String(v).toLowerCase().includes(q)),
    )
  }, [rows, search])

  const selection = useCatalogueSelection(filtered.map((r) => r.id))

  function exportRows(list: PolicyTemplate[]) {
    downloadCsv(
      `reganchor-policy-templates-${new Date().toISOString().slice(0, 10)}.csv`,
      CSV_HEADERS,
      list.map(policyCsvRow),
    )
    setNotice(
      list.length === 1 ? 'Exported 1 policy template to CSV.' : `Exported ${list.length} policy templates to CSV.`,
    )
  }

  function openRow(row: PolicyTemplate) {
    setDraft({ ...row })
    setDirty(false)
    setNotice('')
    setError('')
    setOpen(true)
  }

  function patchDraft(partial: Partial<PolicyTemplate>) {
    setDraft((prev) => (prev ? { ...prev, ...partial } : prev))
    setDirty(true)
  }

  async function saveAndPublish() {
    if (!draft) return
    if (
      !window.confirm(
        'Publish these changes to the live catalogue? Customer app and policy deployment will use them immediately.',
      )
    ) {
      return
    }
    setPublishing(true)
    setError('')
    setNotice('')
    try {
      const { data: updated, error: uErr } = await sb
        .from('policy_templates')
        .update({
          title: draft.title,
          description: draft.description,
          category: draft.category,
          linked_control_number: draft.linked_control_number,
          display_order: draft.display_order,
          is_active: draft.is_active,
          content_template: draft.content_template,
        })
        .eq('id', draft.id)
        .select('id,title')
        .maybeSingle()
      if (uErr) throw uErr
      if (!updated) {
        throw new Error('Publish blocked — no row updated. Check MLA admin write access.')
      }
      setDraft((prev) => (prev ? { ...prev, title: updated.title } : prev))
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
        <PageHeader title="Policy templates" description="MLA policy catalogue for organisation deployment." />
        <BrandLoader fill label="Loading policy templates" />
      </PageFrame>
    )
  }

  return (
    <PageFrame>
      <PageHeader
        title="Policy templates"
        description="Edit MLA policy templates. Changes go live only when you Save & Publish."
      />
      {error && !open ? <Notice tone="risk">{error}</Notice> : null}
      {notice && !open ? <Notice tone="quiet">{notice}</Notice> : null}

      <CatalogueToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search policy templates"
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
          title={rows.length ? 'No matches' : 'No policy templates'}
          body={rows.length ? 'Try a different search.' : 'policy_templates returned no rows.'}
        />
      ) : (
        <Ledger>
          {filtered.map((row) => {
            const label = row.title || 'Untitled template'
            return (
              <LedgerRow
                key={row.id}
                title={label}
                description={[
                  categoryLabel(row.category),
                  row.linked_control_number != null ? `C${row.linked_control_number}` : 'No linked control',
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
        title={draft?.title || 'Policy template'}
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
              Title
              <input
                className={styles.input}
                value={draft.title || ''}
                onChange={(e) => patchDraft({ title: e.target.value })}
              />
            </label>
            <label className={styles.label}>
              Description
              <textarea
                className={styles.textarea}
                rows={3}
                value={draft.description || ''}
                onChange={(e) => patchDraft({ description: e.target.value })}
              />
            </label>
            <div className={styles.row2}>
              <label className={styles.label}>
                Category
                <select
                  className={styles.input}
                  value={draft.category || 'ai_governance'}
                  onChange={(e) => patchDraft({ category: e.target.value })}
                >
                  {Object.entries(POLICY_CATS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.label}>
                Linked control number
                <input
                  className={styles.input}
                  type="number"
                  value={draft.linked_control_number ?? ''}
                  onChange={(e) =>
                    patchDraft({
                      linked_control_number: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
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
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={draft.is_active !== false}
                onChange={(e) => patchDraft({ is_active: e.target.checked })}
              />
              Active
            </label>
            <label className={styles.label}>
              Content template
              <textarea
                className={styles.textarea}
                rows={12}
                value={draft.content_template || ''}
                onChange={(e) => patchDraft({ content_template: e.target.value })}
                placeholder="Markdown body with optional {{org_name}} placeholder"
              />
            </label>
          </div>
        ) : null}
      </Drawer>
    </PageFrame>
  )
}
