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
  type StatusTone,
} from '@ra/ui'
import { usePageChrome } from '@ra/ui/shellChrome'
import { sb } from '../lib/supabase'
import { downloadCsv } from '../lib/csv'
import { CatalogueRowActions, CatalogueToolbar, useCatalogueSelection } from '../components/CatalogueListTools'
import styles from './Catalogue.module.css'
import rq from './RequirementsPage.module.css'

type ReviewState = 'draft' | 'approved' | 'retired'
type LegalStatus = 'in_force' | 'pending' | 'repealed'

type LinkedObligation = { key: string; framework: string; title: string; active: boolean }
type LinkedControl = { number: number | null; title: string | null; primary: boolean }
type LinkedCitation = { type: string; key: string; primary: boolean; label: string | null }

type RequirementRow = {
  key: string
  parent_key: string | null
  kind: string
  citation: string
  short_citation: string
  title: string
  summary: string
  evidence_expected: string | null
  applies_to: string[]
  jurisdictions: string[]
  risk_tiers: string[] | null
  penalty: string | null
  effective_from: string | null
  effective_to: string | null
  status: LegalStatus
  superseded_by_key: string | null
  official_url: string | null
  review_state: ReviewState
  review_note: string | null
  reviewed_at: string | null
  source_key: string
  source_title: string
  source_url: string
  source_licence: string
  source_redistributable: boolean
  captured_text: string | null
  captured_hash: string | null
  captured_url: string | null
  captured_at: string | null
  obligations: LinkedObligation[]
  controls: LinkedControl[]
  citations: LinkedCitation[]
}

type HistoryRow = {
  action: string
  changes: Record<string, { from: unknown; to: unknown }>
  note: string | null
  actor_name: string
  created_at: string
}

type EditableFields = Pick<
  RequirementRow,
  'title' | 'citation' | 'short_citation' | 'summary' | 'evidence_expected' | 'penalty' | 'effective_from' | 'effective_to' | 'official_url'
>

const EDITABLE: (keyof EditableFields)[] = [
  'title',
  'citation',
  'short_citation',
  'summary',
  'evidence_expected',
  'penalty',
  'effective_from',
  'effective_to',
  'official_url',
]

const SOURCE_LABELS: Record<string, string> = {
  eu_ai_act: 'EU AI Act',
  eu_ai_omnibus: 'AI Omnibus',
  eu_gdpr: 'EU GDPR',
  eu_dora: 'DORA',
  uk_gdpr: 'UK GDPR',
  uk_duaa_2025: 'Data (Use and Access) Act 2025',
  uk_si_2026_82: 'SI 2026/82',
  uk_dpa_2018: 'Data Protection Act 2018',
  uk_fsma_2000: 'FSMA 2000',
  fca_handbook: 'FCA Handbook',
  fca_ai_approach: 'FCA AI approach',
  fca_ai_good_practice: 'FCA AI good practice',
  fca_fg21_1: 'FCA FG21/1',
  pra_ss1_23: 'PRA SS1/23',
  ico_accountability: 'ICO',
  iso_42001: 'ISO/IEC 42001',
}

const REVIEW_LABEL: Record<ReviewState, string> = { draft: 'Draft', approved: 'Approved', retired: 'Retired' }
const REVIEW_TONE: Record<ReviewState, StatusTone> = { draft: 'warn', approved: 'ok', retired: 'neutral' }

const ACTION_LABEL: Record<string, string> = {
  approve: 'Approved',
  return_to_draft: 'Returned to draft',
  retire: 'Retired',
  edit: 'Edited',
}

const CITATION_TYPE_LABEL: Record<string, string> = {
  assessment_section: 'Assessment section',
  assessment_question: 'Assessment question',
  diagnostic_reg: 'Diagnostic overview row',
  diagnostic_question: 'Diagnostic question',
  diagnostic_flag: 'Diagnostic priority flag',
  guardrail: 'Guardrail',
  report_text: 'Report text',
}

const DIAGNOSTIC_FLAG_LABEL: Record<string, string> = {
  pf_governance: 'No named AI governance owner',
  pf_oversight: 'No human oversight of AI decisions',
  pf_dpia: 'No DPIA conducted',
  pf_transparency: 'Individuals not informed of AI-assisted decisions',
  pf_no_inventory: 'No AI inventory',
  pf_no_policy: 'No AI use policies in place',
}

const FIELD_LABEL: Record<string, string> = {
  title: 'Title',
  citation: 'Citation',
  short_citation: 'Short citation',
  summary: 'Summary',
  evidence_expected: 'Evidence expected',
  penalty: 'Penalty',
  effective_from: 'Applies from',
  effective_to: 'Applies until',
  official_url: 'Official link',
  review_state: 'Review state',
}

const CSV_HEADERS = [
  'key',
  'source',
  'citation',
  'title',
  'review_state',
  'status',
  'effective_from',
  'effective_to',
  'applies_to',
  'jurisdictions',
  'penalty',
  'summary',
  'evidence_expected',
  'linked_obligations',
  'linked_controls',
  'citations',
  'has_verbatim_text',
]

function sourceLabel(key: string) {
  return SOURCE_LABELS[key] || key.replace(/_/g, ' ')
}

function formatDate(value: string | null) {
  if (!value) return ''
  return new Date(value.length === 10 ? `${value}T00:00:00Z` : value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function legalStatusText(row: Pick<RequirementRow, 'status' | 'effective_from' | 'effective_to'>) {
  if (row.status === 'pending') return `Applies from ${formatDate(row.effective_from)}`
  if (row.status === 'repealed') return `Replaced after ${formatDate(row.effective_to)}`
  return row.effective_from ? `In force since ${formatDate(row.effective_from)}` : 'In force'
}

function linkCount(row: RequirementRow) {
  return row.obligations.length + row.controls.length + row.citations.length
}

function csvRow(row: RequirementRow) {
  return [
    row.key,
    sourceLabel(row.source_key),
    row.citation,
    row.title,
    row.review_state,
    row.status,
    row.effective_from,
    row.effective_to,
    row.applies_to.join('; '),
    row.jurisdictions.join('; '),
    row.penalty,
    row.summary,
    row.evidence_expected,
    row.obligations.map((o) => o.key).join('; '),
    row.controls.map((c) => `C${c.number}`).join('; '),
    row.citations.map((c) => `${c.type}:${c.label || c.key}`).join('; '),
    row.captured_text ? 'yes' : 'no',
  ]
}

function pickEditable(row: RequirementRow): EditableFields {
  return {
    title: row.title,
    citation: row.citation,
    short_citation: row.short_citation,
    summary: row.summary,
    evidence_expected: row.evidence_expected,
    penalty: row.penalty,
    effective_from: row.effective_from,
    effective_to: row.effective_to,
    official_url: row.official_url,
  }
}

function formatChange(value: unknown) {
  if (value == null || value === '') return 'empty'
  const s = String(value)
  return s.length > 80 ? `${s.slice(0, 77)}...` : s
}

export function RequirementsPage() {
  usePageChrome({
    title: 'Requirements',
    breadcrumbs: [{ label: 'Requirements' }],
  })

  const [rows, setRows] = useState<RequirementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<'all' | ReviewState>('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [draft, setDraft] = useState<EditableFields | null>(null)
  const [dirty, setDirty] = useState(false)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [history, setHistory] = useState<HistoryRow[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: qErr } = await sb.rpc('reg_admin_requirements')
      if (qErr) throw qErr
      setRows((data as RequirementRow[]) || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load requirements.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadHistory = useCallback(async (key: string) => {
    const { data, error: hErr } = await sb.rpc('reg_admin_review_log', { p_key: key })
    setHistory(hErr ? [] : ((data as HistoryRow[]) || []))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const current = useMemo(() => rows.find((r) => r.key === openKey) || null, [rows, openKey])

  const counts = useMemo(() => {
    const c = { all: rows.length, draft: 0, approved: 0, retired: 0 }
    for (const r of rows) c[r.review_state]++
    return c
  }, [rows])

  const sourceOptions = useMemo(() => {
    const keys = Array.from(new Set(rows.map((r) => r.source_key)))
    return [
      { value: 'all', label: 'All sources' },
      ...keys.map((k) => ({ value: k, label: sourceLabel(k) })),
    ]
  }, [rows])

  const stateOptions = [
    { value: 'all', label: `All states (${counts.all})` },
    { value: 'draft', label: `Drafts (${counts.draft})` },
    { value: 'approved', label: `Approved (${counts.approved})` },
    { value: 'retired', label: `Retired (${counts.retired})` },
  ]

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (stateFilter !== 'all' && row.review_state !== stateFilter) return false
      if (sourceFilter !== 'all' && row.source_key !== sourceFilter) return false
      if (!q) return true
      return [row.key, row.citation, row.title, row.summary, sourceLabel(row.source_key)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    })
  }, [rows, search, stateFilter, sourceFilter])

  const selection = useCatalogueSelection(filtered.map((r) => r.key))

  function exportRows(list: RequirementRow[]) {
    downloadCsv(`reganchor-requirements-${new Date().toISOString().slice(0, 10)}.csv`, CSV_HEADERS, list.map(csvRow))
    setNotice(list.length === 1 ? 'Exported 1 requirement to CSV.' : `Exported ${list.length} requirements to CSV.`)
  }

  function openRow(row: RequirementRow) {
    setOpenKey(row.key)
    setDraft(pickEditable(row))
    setDirty(false)
    setNote('')
    setNotice('')
    setError('')
    setHistory([])
    void loadHistory(row.key)
  }

  function closeDrawer() {
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    setOpenKey(null)
  }

  function patchDraft(partial: Partial<EditableFields>) {
    setDraft((prev) => (prev ? { ...prev, ...partial } : prev))
    setDirty(true)
  }

  async function saveEdits() {
    if (!draft || !current) return
    const patch: Record<string, string | null> = {}
    for (const field of EDITABLE) {
      const next = draft[field] ?? null
      if ((current[field] ?? null) !== next) patch[field] = next
    }
    if (!Object.keys(patch).length) {
      setDirty(false)
      return
    }
    if (
      current.review_state === 'approved' &&
      !window.confirm('This requirement is approved. Products that read the registry will show the new wording immediately. Save?')
    ) {
      return
    }
    setSaving(true)
    setError('')
    try {
      const { error: sErr } = await sb.rpc('reg_admin_save_requirement', {
        p_key: current.key,
        p_patch: patch,
        p_note: note.trim() || null,
      })
      if (sErr) throw sErr
      setDirty(false)
      setNote('')
      setNotice('Changes saved.')
      await load()
      await loadHistory(current.key)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  async function setReviewState(state: ReviewState) {
    if (!current) return
    if (dirty) {
      setError('Save or discard your edits before changing the review state.')
      return
    }
    const prompts: Record<ReviewState, string> = {
      approved: 'Approve this requirement? It becomes readable by the product and can be cited.',
      draft: 'Return this requirement to draft? The product stops reading it.',
      retired: 'Retire this requirement? It stays available for old reports but is no longer current.',
    }
    if (!window.confirm(prompts[state])) return
    setSaving(true)
    setError('')
    try {
      const { error: rErr } = await sb.rpc('reg_admin_set_review_state', {
        p_key: current.key,
        p_state: state,
        p_note: note.trim() || null,
      })
      if (rErr) throw rErr
      setNote('')
      setNotice(`${REVIEW_LABEL[state]}.`)
      await load()
      await loadHistory(current.key)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review update failed.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <PageFrame>
        <PageHeader title="Requirements" description="The law RegAnchor cites, by source." />
        <BrandLoader fill label="Loading requirements" />
      </PageFrame>
    )
  }

  return (
    <PageFrame>
      <PageHeader
        title="Requirements"
        description="The law RegAnchor cites, held once and linked to obligations, controls, assessment sections and the diagnostic. Drafts stay out of the product until approved."
      />
      {error && !openKey ? <Notice tone="risk">{error}</Notice> : null}
      {notice && !openKey ? <Notice tone="quiet">{notice}</Notice> : null}

      <CatalogueToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search requirements"
        selectMode={selection.selectMode}
        selectedCount={selection.selectedCount}
        visibleCount={selection.visibleCount}
        allVisibleSelected={selection.allVisibleSelected}
        someVisibleSelected={selection.someVisibleSelected}
        onToggleBulk={selection.toggleBulk}
        onToggleAllVisible={selection.toggleAllVisible}
        onExportSelected={() => exportRows(filtered.filter((r) => selection.selectedIds.includes(r.key)))}
        leading={
          <div className={rq.filters}>
            <SelectMenu
              aria-label="Review state"
              value={stateFilter}
              options={stateOptions}
              onChange={(v) => setStateFilter(v as 'all' | ReviewState)}
              className={rq.filter}
            />
            <SelectMenu
              aria-label="Source"
              value={sourceFilter}
              options={sourceOptions}
              onChange={setSourceFilter}
              className={rq.filter}
            />
          </div>
        }
      />

      {filtered.length === 0 ? (
        <EmptyState
          title={rows.length ? 'No matches' : 'No requirements'}
          body={rows.length ? 'Try a different search or filter.' : 'The registry returned no requirements.'}
        />
      ) : (
        <Ledger>
          {filtered.map((row) => {
            const links = linkCount(row)
            return (
              <LedgerRow
                key={row.key}
                title={
                  <button type="button" className={rq.rowTitle} onClick={() => openRow(row)}>
                    <span>{row.title}</span>
                    <span className={rq.rowCitation}>{row.short_citation}</span>
                  </button>
                }
                description={[
                  sourceLabel(row.source_key),
                  legalStatusText(row),
                  links ? `${links} ${links === 1 ? 'link' : 'links'}` : 'Not linked',
                  row.captured_text ? 'Verbatim text' : 'Link and summary',
                ].join(' · ')}
                meta={
                  <span className={rq.rowMeta}>
                    <StatusLabel tone={REVIEW_TONE[row.review_state]}>{REVIEW_LABEL[row.review_state]}</StatusLabel>
                    <CatalogueRowActions
                      label={row.title}
                      selectMode={selection.selectMode}
                      selected={!!selection.selected[row.key]}
                      onToggleSelect={(checked) => selection.toggleOne(row.key, checked)}
                      onEdit={() => openRow(row)}
                      onExportRow={() => exportRows([row])}
                    />
                  </span>
                }
              />
            )
          })}
        </Ledger>
      )}

      <Drawer
        open={!!openKey}
        onClose={closeDrawer}
        title={current?.title || 'Requirement'}
        description={current ? `${current.citation} · ${sourceLabel(current.source_key)}` : undefined}
        headerMeta={
          current ? (
            <span className={rq.headerMeta}>
              <StatusLabel tone={REVIEW_TONE[current.review_state]}>{REVIEW_LABEL[current.review_state]}</StatusLabel>
              <span className={rq.quiet}>{legalStatusText(current)}</span>
            </span>
          ) : null
        }
        footer={
          <div className={styles.footer}>
            {dirty ? <StatusLabel tone="warn">Unsaved changes</StatusLabel> : null}
            <Button pending={saving} disabled={!dirty} onClick={() => void saveEdits()}>
              Save changes
            </Button>
          </div>
        }
      >
        {error ? <Notice tone="risk">{error}</Notice> : null}
        {notice && !dirty ? <Notice tone="quiet">{notice}</Notice> : null}
        {current && draft ? (
          <div className={rq.sections}>
            <section className={rq.section}>
              <h3 className={rq.sectionTitle}>Review</h3>
              <dl className={rq.facts}>
                <dt>Key</dt>
                <dd className={rq.ident}>{current.key}</dd>
                <dt>Applies to</dt>
                <dd>{current.applies_to.join(', ') || 'Not set'}</dd>
                <dt>Jurisdiction</dt>
                <dd>{current.jurisdictions.join(', ')}</dd>
                {current.risk_tiers?.length ? (
                  <>
                    <dt>Risk tiers</dt>
                    <dd>{current.risk_tiers.join(', ')}</dd>
                  </>
                ) : null}
                {current.parent_key ? (
                  <>
                    <dt>Part of</dt>
                    <dd className={rq.ident}>{current.parent_key}</dd>
                  </>
                ) : null}
                {current.superseded_by_key ? (
                  <>
                    <dt>Replaced by</dt>
                    <dd className={rq.ident}>{current.superseded_by_key}</dd>
                  </>
                ) : null}
                {current.reviewed_at ? (
                  <>
                    <dt>Last reviewed</dt>
                    <dd>{formatDate(current.reviewed_at)}</dd>
                  </>
                ) : null}
              </dl>
              <label className={styles.label}>
                Note for the review log
                <input
                  className={styles.input}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Why this decision or edit (optional)"
                />
              </label>
              <div className={rq.actions}>
                {current.review_state !== 'approved' ? (
                  <Button size="sm" pending={saving} onClick={() => void setReviewState('approved')}>
                    Approve
                  </Button>
                ) : null}
                {current.review_state !== 'draft' ? (
                  <Button size="sm" variant="ghost" disabled={saving} onClick={() => void setReviewState('draft')}>
                    Return to draft
                  </Button>
                ) : null}
                {current.review_state !== 'retired' ? (
                  <Button size="sm" variant="ghost" disabled={saving} onClick={() => void setReviewState('retired')}>
                    Retire
                  </Button>
                ) : null}
              </div>
            </section>

            <section className={rq.section}>
              <h3 className={rq.sectionTitle}>Wording</h3>
              <div className={styles.form}>
                <label className={styles.label}>
                  Title
                  <input className={styles.input} value={draft.title} onChange={(e) => patchDraft({ title: e.target.value })} />
                </label>
                <div className={styles.row2}>
                  <label className={styles.label}>
                    Citation
                    <input className={styles.input} value={draft.citation} onChange={(e) => patchDraft({ citation: e.target.value })} />
                  </label>
                  <label className={styles.label}>
                    Short citation
                    <input
                      className={styles.input}
                      value={draft.short_citation}
                      onChange={(e) => patchDraft({ short_citation: e.target.value })}
                    />
                  </label>
                </div>
                <label className={styles.label}>
                  Summary
                  <textarea
                    className={rq.prose}
                    rows={4}
                    value={draft.summary}
                    onChange={(e) => patchDraft({ summary: e.target.value })}
                  />
                </label>
                <label className={styles.label}>
                  Evidence expected
                  <textarea
                    className={rq.prose}
                    rows={2}
                    value={draft.evidence_expected || ''}
                    onChange={(e) => patchDraft({ evidence_expected: e.target.value })}
                  />
                </label>
                <label className={styles.label}>
                  Penalty
                  <input
                    className={styles.input}
                    value={draft.penalty || ''}
                    onChange={(e) => patchDraft({ penalty: e.target.value })}
                  />
                </label>
                <div className={styles.row2}>
                  <label className={styles.label}>
                    Applies from
                    <input
                      className={styles.input}
                      type="date"
                      value={draft.effective_from || ''}
                      onChange={(e) => patchDraft({ effective_from: e.target.value || null })}
                    />
                  </label>
                  <label className={styles.label}>
                    Applies until
                    <input
                      className={styles.input}
                      type="date"
                      value={draft.effective_to || ''}
                      onChange={(e) => patchDraft({ effective_to: e.target.value || null })}
                    />
                  </label>
                </div>
                <label className={styles.label}>
                  Official link
                  <input
                    className={styles.input}
                    value={draft.official_url || ''}
                    onChange={(e) => patchDraft({ official_url: e.target.value })}
                    placeholder={current.source_url}
                  />
                </label>
              </div>
            </section>

            <section className={rq.section}>
              <h3 className={rq.sectionTitle}>Linked from</h3>
              {linkCount(current) === 0 ? (
                <p className={rq.quiet}>Nothing in RegAnchor cites this requirement yet.</p>
              ) : (
                <ul className={rq.links}>
                  {current.obligations.map((o) => (
                    <li key={`o-${o.key}`}>
                      <span className={rq.linkKind}>Obligation</span>
                      <span>
                        {o.title}
                        {o.active ? '' : ' (inactive)'}
                      </span>
                    </li>
                  ))}
                  {current.controls.map((c) => (
                    <li key={`c-${c.number}`}>
                      <span className={rq.linkKind}>Control</span>
                      <span>
                        <span className={rq.num}>{c.number}</span>. {c.title}
                        {c.primary ? '' : ' (secondary)'}
                      </span>
                    </li>
                  ))}
                  {current.citations.map((c) => (
                    <li key={`r-${c.type}-${c.key}`}>
                      <span className={rq.linkKind}>{CITATION_TYPE_LABEL[c.type] || c.type}</span>
                      <span>{(c.type === 'diagnostic_flag' && DIAGNOSTIC_FLAG_LABEL[c.key]) || c.label || c.key}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={rq.section}>
              <h3 className={rq.sectionTitle}>Text of the law</h3>
              {current.captured_text ? (
                <>
                  <div className={rq.legal}>{current.captured_text}</div>
                  <p className={rq.quiet}>
                    Captured {formatDate(current.captured_at)} from{' '}
                    <a href={current.captured_url || current.source_url} target="_blank" rel="noreferrer">
                      {current.captured_url?.includes('legislation.gov.uk') ? 'legislation.gov.uk' : 'EUR-Lex'}
                    </a>
                    . Fingerprint <span className={rq.ident}>{current.captured_hash?.slice(0, 12)}</span>.
                  </p>
                </>
              ) : (
                <p className={rq.quiet}>
                  Link and summary only. {current.source_licence}.{' '}
                  <a href={current.official_url || current.source_url} target="_blank" rel="noreferrer">
                    Open the source
                  </a>
                </p>
              )}
            </section>

            <section className={rq.section}>
              <h3 className={rq.sectionTitle}>History</h3>
              {history.length === 0 ? (
                <p className={rq.quiet}>No reviews or edits since the registry was seeded on 6 Nov 2026.</p>
              ) : (
                <ul className={rq.history}>
                  {history.map((h, i) => (
                    <li key={`${h.created_at}-${i}`}>
                      <div className={rq.historyHead}>
                        <span>{ACTION_LABEL[h.action] || h.action}</span>
                        <span className={rq.quiet}>
                          {h.actor_name} · {formatDate(h.created_at)}
                        </span>
                      </div>
                      {h.action === 'edit'
                        ? Object.entries(h.changes).map(([field, change]) => (
                            <div key={field} className={rq.historyChange}>
                              {FIELD_LABEL[field] || field}: {formatChange(change.from)} to {formatChange(change.to)}
                            </div>
                          ))
                        : null}
                      {h.note ? <div className={rq.historyNote}>{h.note}</div> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}
      </Drawer>
    </PageFrame>
  )
}
