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

type Option = {
  label: string
  score?: number
  uncertainty?: boolean
  value?: string
}

type QuestionRow = {
  id: string
  section_key: string
  question_key: string
  prompt: string
  hint: string | null
  question_kind: string
  is_required: boolean | null
  display_order: number | null
  is_active: boolean | null
  options: Option[]
}

type SectionRow = {
  section_key: string
  title: string
  description: string | null
  display_order: number | null
}

const CSV_HEADERS = [
  'section_key',
  'question_key',
  'question_kind',
  'is_required',
  'prompt',
  'hint',
  'is_active',
  'display_order',
  'options_json',
]

const KIND_OPTIONS = [
  { value: 'single', label: 'Single choice' },
  { value: 'multi', label: 'Multi select' },
]

function parseOptions(raw: unknown): Option[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    const row = item as Record<string, unknown>
    const out: Option = { label: String(row.label ?? row.l ?? '') }
    if (row.score != null || row.s != null) out.score = Number(row.score ?? row.s ?? 0)
    if (row.uncertainty === true) out.uncertainty = true
    if (row.value != null) out.value = String(row.value)
    return out
  })
}

export function DiagnosticQuestionsPage() {
  usePageChrome({
    title: 'Diagnostic questions',
    breadcrumbs: [{ label: 'Engines' }, { label: 'Diagnostic questions' }],
  })

  const [sections, setSections] = useState<SectionRow[]>([])
  const [rows, setRows] = useState<QuestionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<QuestionRow | null>(null)
  const [optionsText, setOptionsText] = useState('')
  const [dirty, setDirty] = useState(false)
  const [publishing, setPublishing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [sRes, qRes] = await Promise.all([
        sb
          .from('diagnostic_sections')
          .select('section_key,title,description,display_order')
          .order('display_order', { ascending: true }),
        sb
          .from('diagnostic_questions')
          .select('id,section_key,question_key,prompt,hint,question_kind,is_required,display_order,is_active,options')
          .order('display_order', { ascending: true }),
      ])
      if (sRes.error) throw sRes.error
      if (qRes.error) throw qRes.error
      const nextSections = (sRes.data as SectionRow[]) || []
      setSections(nextSections)
      const sectionOrder = new Map(nextSections.map((s, i) => [s.section_key, s.display_order ?? (i + 1) * 10]))
      const parsed = ((qRes.data as Array<Omit<QuestionRow, 'options'> & { options: unknown }>) || []).map((row) => ({
        ...row,
        options: parseOptions(row.options),
      }))
      parsed.sort((a, b) => {
        const sa = sectionOrder.get(a.section_key) ?? 9999
        const sb = sectionOrder.get(b.section_key) ?? 9999
        if (sa !== sb) return sa - sb
        return (a.display_order ?? 0) - (b.display_order ?? 0)
      })
      setRows(parsed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load diagnostic questions.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const sectionTitle = useMemo(() => {
    const map = new Map(sections.map((s) => [s.section_key, s.title]))
    return (key: string) => map.get(key) || key
  }, [sections])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    // rows are already in client UX order (section then question)
    if (!q) return rows
    return rows.filter((row) =>
      [row.question_key, row.prompt, row.hint, row.section_key, sectionTitle(row.section_key), row.question_kind]
        .filter((v) => v != null && String(v).length)
        .some((v) => String(v).toLowerCase().includes(q)),
    )
  }, [rows, search, sectionTitle])

  const selection = useCatalogueSelection(filtered.map((r) => r.id))

  function exportRows(list: QuestionRow[]) {
    downloadCsv(
      `reganchor-diagnostic-questions-${new Date().toISOString().slice(0, 10)}.csv`,
      CSV_HEADERS,
      list.map((row) => [
        row.section_key,
        row.question_key,
        row.question_kind,
        row.is_required,
        row.prompt,
        row.hint,
        row.is_active,
        row.display_order,
        JSON.stringify(row.options),
      ]),
    )
    setNotice(list.length === 1 ? 'Exported 1 question to CSV.' : `Exported ${list.length} questions to CSV.`)
  }

  function openRow(row: QuestionRow) {
    setDraft({ ...row, options: row.options.map((o) => ({ ...o })) })
    setOptionsText(JSON.stringify(row.options, null, 2))
    setDirty(false)
    setNotice('')
    setError('')
    setOpen(true)
  }

  function patchDraft(partial: Partial<QuestionRow>) {
    setDraft((prev) => (prev ? { ...prev, ...partial } : prev))
    setDirty(true)
  }

  async function saveAndPublish() {
    if (!draft) return
    let options: Option[]
    try {
      const parsed = JSON.parse(optionsText) as unknown
      options = parseOptions(parsed)
      if (!Array.isArray(parsed) || !options.length) throw new Error('Options must be a non-empty JSON array.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Options JSON is invalid.')
      return
    }
    if (
      !window.confirm(
        'Publish this diagnostic question? New org diagnostics will use the updated prompt and options. Past results are unchanged.',
      )
    ) {
      return
    }
    setPublishing(true)
    setError('')
    setNotice('')
    try {
      const { data, error: uErr } = await sb
        .from('diagnostic_questions')
        .update({
          prompt: draft.prompt.trim(),
          hint: draft.hint?.trim() || null,
          question_kind: draft.question_kind === 'multi' ? 'multi' : 'single',
          is_required: draft.is_required !== false,
          display_order: Number(draft.display_order) || 0,
          is_active: draft.is_active !== false,
          options,
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
        <PageHeader
          title="Diagnostic questions"
          description="Org-wide risk diagnostic questionnaire (lead funnel). Separate from per-asset assessment."
        />
        <BrandLoader fill label="Loading questions" />
      </PageFrame>
    )
  }

  return (
    <PageFrame>
      <PageHeader
        title="Diagnostic questions"
        description="Edit prompts and options for the public diagnostic. Keep question keys stable — they drive scores, priority flags, and high-risk additions."
      />
      {error && !open ? <Notice tone="risk">{error}</Notice> : null}
      {notice && !open ? <Notice tone="quiet">{notice}</Notice> : null}

      <CatalogueToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search questions"
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
          title={rows.length ? 'No matches' : 'No diagnostic questions'}
          body={rows.length ? 'Try a different search.' : 'diagnostic_questions returned no rows.'}
        />
      ) : (
        <Ledger>
          {filtered.map((row) => {
            const label = `${row.question_key} · ${sectionTitle(row.section_key)}`
            return (
              <LedgerRow
                key={row.id}
                title={label}
                description={[
                  row.prompt,
                  row.question_kind === 'multi' ? 'Multi' : 'Single',
                  row.is_required === false ? 'Optional' : 'Required',
                  `${row.options.length} options`,
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
        title={draft ? draft.question_key : 'Question'}
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
              Question key
              <input className={styles.input} value={draft.question_key} disabled />
            </label>
            <label className={styles.label}>
              Section
              <input
                className={styles.input}
                value={`${draft.section_key} — ${sectionTitle(draft.section_key)}`}
                disabled
              />
            </label>
            <div className={styles.label}>
              Kind
              <SelectMenu
                aria-label="Question kind"
                value={draft.question_kind === 'multi' ? 'multi' : 'single'}
                options={KIND_OPTIONS}
                onChange={(value) => patchDraft({ question_kind: value })}
              />
            </div>
            <label className={styles.label}>
              Prompt
              <textarea
                className={styles.textarea}
                rows={4}
                value={draft.prompt}
                onChange={(e) => patchDraft({ prompt: e.target.value })}
              />
            </label>
            <label className={styles.label}>
              Hint
              <textarea
                className={styles.textarea}
                rows={2}
                value={draft.hint || ''}
                onChange={(e) => patchDraft({ hint: e.target.value })}
              />
            </label>
            <label className={styles.label}>
              Options JSON
              <textarea
                className={styles.textarea}
                rows={12}
                value={optionsText}
                onChange={(e) => {
                  setOptionsText(e.target.value)
                  setDirty(true)
                }}
                spellCheck={false}
              />
            </label>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--ra-text-2)', lineHeight: 1.45 }}>
              Single: <code>label</code>, <code>score</code>, optional <code>uncertainty</code>. Multi:{' '}
              <code>label</code>, <code>value</code> (high-risk category id). Do not rename question keys used by
              scoring or priority flags.
            </p>
            <label className={styles.check}>
              <input
                className={styles.checkBox}
                type="checkbox"
                checked={draft.is_required !== false}
                onChange={(e) => patchDraft({ is_required: e.target.checked })}
              />
              Required to continue
            </label>
            <label className={styles.check}>
              <input
                className={styles.checkBox}
                type="checkbox"
                checked={draft.is_active !== false}
                onChange={(e) => patchDraft({ is_active: e.target.checked })}
              />
              Active
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
          </div>
        ) : null}
      </Drawer>
    </PageFrame>
  )
}
