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

type Option = { label: string; score: number }

type QuestionRow = {
  id: string
  section_key: string
  question_key: string
  prompt: string
  hint: string | null
  display_order: number | null
  is_active: boolean | null
  options: Option[]
}

type SectionRow = {
  section_key: string
  title: string
  description: string | null
  regulatory_basis: string | null
  display_order: number | null
}

const CSV_HEADERS = ['section_key', 'question_key', 'prompt', 'hint', 'is_active', 'display_order', 'options_json']

function parseOptions(raw: unknown): Option[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    const row = item as Record<string, unknown>
    return {
      label: String(row.label ?? row.l ?? ''),
      score: Number(row.score ?? row.s ?? 0),
    }
  })
}

export function AssessmentQuestionsPage() {
  usePageChrome({
    title: 'Asset assessment questions',
    breadcrumbs: [{ label: 'Engines' }, { label: 'Asset assessment questions' }],
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
          .from('assessment_sections')
          .select('section_key,title,description,regulatory_basis,display_order')
          .order('display_order', { ascending: true }),
        sb
          .from('assessment_questions')
          .select('id,section_key,question_key,prompt,hint,display_order,is_active,options')
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
      setError(e instanceof Error ? e.message : 'Could not load assessment questions.')
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
      [row.question_key, row.prompt, row.hint, row.section_key, sectionTitle(row.section_key)]
        .filter((v) => v != null && String(v).length)
        .some((v) => String(v).toLowerCase().includes(q)),
    )
  }, [rows, search, sectionTitle])

  const selection = useCatalogueSelection(filtered.map((r) => r.id))

  function exportRows(list: QuestionRow[]) {
    downloadCsv(
      `reganchor-assessment-questions-${new Date().toISOString().slice(0, 10)}.csv`,
      CSV_HEADERS,
      list.map((row) => [
        row.section_key,
        row.question_key,
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
        'Publish this assessment question? New asset assessments will use the updated prompt and scores. Past assessments are unchanged.',
      )
    ) {
      return
    }
    setPublishing(true)
    setError('')
    setNotice('')
    try {
      const { data, error: uErr } = await sb
        .from('assessment_questions')
        .update({
          prompt: draft.prompt.trim(),
          hint: draft.hint?.trim() || null,
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
      setNotice('Published to asset assessment engine.')
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
          title="Asset assessment questions"
          description="Per-AI-asset questionnaire. Separate from the org-wide diagnostic."
        />
        <BrandLoader fill label="Loading questions" />
      </PageFrame>
    )
  }

  return (
    <PageFrame>
      <PageHeader
        title="Asset assessment questions"
        description="Edit prompts and scored options for the registry assessment. Keep question keys stable — they drive scoring and control triggers."
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
          title={rows.length ? 'No matches' : 'No assessment questions'}
          body={rows.length ? 'Try a different search.' : 'assessment_questions returned no rows.'}
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
              Each option needs <code>label</code> and <code>score</code> (0–3). Changing scores changes the assessment
              engine immediately after publish.
            </p>
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
