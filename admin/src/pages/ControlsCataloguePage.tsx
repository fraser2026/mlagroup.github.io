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

export type GovernanceControl = {
  id: string
  control_number: number | null
  title: string | null
  description: string | null
  purpose: string | null
  control_type: string | null
  pillar: string | null
  is_org_level: boolean | null
  evidence_types: unknown
  trigger_rules: unknown
  display_order: number | null
  is_active: boolean | null
}

const CSV_HEADERS = [
  'control_number',
  'title',
  'description',
  'purpose',
  'control_type',
  'pillar',
  'is_org_level',
  'is_active',
  'evidence_types',
  'trigger_rules',
]

function controlCsvRow(row: GovernanceControl) {
  return [
    row.control_number,
    row.title,
    row.description,
    row.purpose,
    row.control_type,
    row.pillar,
    row.is_org_level,
    row.is_active,
    JSON.stringify(row.evidence_types ?? null),
    JSON.stringify(row.trigger_rules ?? null),
  ]
}

function prettyJson(value: unknown) {
  try {
    return JSON.stringify(value ?? null, null, 2)
  } catch {
    return 'null'
  }
}

function parseJsonField(raw: string, label: string) {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    throw new Error(`${label} must be valid JSON.`)
  }
}

export function ControlsCataloguePage() {
  usePageChrome({
    title: 'Controls',
    breadcrumbs: [{ label: 'Controls' }],
  })

  const [rows, setRows] = useState<GovernanceControl[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<GovernanceControl | null>(null)
  const [evidenceText, setEvidenceText] = useState('[]')
  const [triggerText, setTriggerText] = useState('{}')
  const [dirty, setDirty] = useState(false)
  const [publishing, setPublishing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: qErr } = await sb
        .from('governance_controls')
        .select(
          'id,control_number,title,description,purpose,control_type,pillar,is_org_level,evidence_types,trigger_rules,display_order,is_active',
        )
        .order('display_order', { ascending: true })
      if (qErr) throw qErr
      setRows((data as GovernanceControl[]) || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load controls.')
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
      [row.control_number, row.title, row.description, row.purpose, row.control_type, row.pillar]
        .filter((v) => v != null && String(v).length)
        .some((v) => String(v).toLowerCase().includes(q)),
    )
  }, [rows, search])

  const selection = useCatalogueSelection(filtered.map((r) => r.id))

  function exportRows(list: GovernanceControl[]) {
    downloadCsv(
      `reganchor-controls-${new Date().toISOString().slice(0, 10)}.csv`,
      CSV_HEADERS,
      list.map(controlCsvRow),
    )
    setNotice(list.length === 1 ? 'Exported 1 control to CSV.' : `Exported ${list.length} controls to CSV.`)
  }

  function openRow(row: GovernanceControl) {
    setDraft({ ...row })
    setEvidenceText(prettyJson(row.evidence_types))
    setTriggerText(prettyJson(row.trigger_rules))
    setDirty(false)
    setNotice('')
    setError('')
    setOpen(true)
  }

  function patchDraft(partial: Partial<GovernanceControl>) {
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
      const evidence_types = parseJsonField(evidenceText, 'Evidence types')
      const trigger_rules = parseJsonField(triggerText, 'Trigger rules')
      const { data: updated, error: uErr } = await sb
        .from('governance_controls')
        .update({
          title: draft.title,
          description: draft.description,
          purpose: draft.purpose,
          control_type: draft.control_type,
          pillar: draft.pillar,
          is_org_level: draft.is_org_level,
          is_active: draft.is_active,
          evidence_types,
          trigger_rules,
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
        <PageHeader title="Controls" description="Governance control catalogue." />
        <BrandLoader fill label="Loading controls" />
      </PageFrame>
    )
  }

  return (
    <PageFrame>
      <PageHeader
        title="Controls"
        description="Edit control definitions and trigger rules. Changes go live only when you Save & Publish."
      />
      {error && !open ? <Notice tone="risk">{error}</Notice> : null}
      {notice && !open ? <Notice tone="quiet">{notice}</Notice> : null}

      <CatalogueToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search controls"
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
          title={rows.length ? 'No matches' : 'No controls'}
          body={rows.length ? 'Try a different search.' : 'governance_controls returned no rows.'}
        />
      ) : (
        <Ledger>
          {filtered.map((row) => {
            const label = `C${row.control_number ?? '—'} · ${row.title || 'Untitled'}`
            return (
              <LedgerRow
                key={row.id}
                title={label}
                description={[
                  row.control_type || 'type unset',
                  row.is_org_level ? 'Organisation' : 'Asset',
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
        title={draft ? `C${draft.control_number ?? '—'} · ${draft.title || 'Control'}` : 'Control'}
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
                rows={4}
                value={draft.description || ''}
                onChange={(e) => patchDraft({ description: e.target.value })}
              />
            </label>
            <label className={styles.label}>
              Purpose
              <textarea
                className={styles.textarea}
                rows={3}
                value={draft.purpose || ''}
                onChange={(e) => patchDraft({ purpose: e.target.value })}
              />
            </label>
            <div className={styles.row2}>
              <label className={styles.label}>
                Type
                <input
                  className={styles.input}
                  value={draft.control_type || ''}
                  onChange={(e) => patchDraft({ control_type: e.target.value })}
                />
              </label>
              <label className={styles.label}>
                Pillar
                <input
                  className={styles.input}
                  value={draft.pillar || ''}
                  onChange={(e) => patchDraft({ pillar: e.target.value })}
                />
              </label>
            </div>
            <div className={styles.checks}>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={Boolean(draft.is_org_level)}
                  onChange={(e) => patchDraft({ is_org_level: e.target.checked })}
                />
                Organisation-level
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
              Evidence types (JSON)
              <textarea
                className={styles.textarea}
                rows={6}
                value={evidenceText}
                onChange={(e) => {
                  setEvidenceText(e.target.value)
                  setDirty(true)
                }}
              />
            </label>
            <label className={styles.label}>
              Trigger rules (JSON)
              <textarea
                className={styles.textarea}
                rows={8}
                value={triggerText}
                onChange={(e) => {
                  setTriggerText(e.target.value)
                  setDirty(true)
                }}
              />
            </label>
          </div>
        ) : null}
      </Drawer>
    </PageFrame>
  )
}
