import { useCallback, useEffect, useState } from 'react'
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
import styles from './Catalogue.module.css'

type WeightRow = {
  section_key: string
  label: string
  weight: number
  display_order: number | null
  is_active: boolean | null
}

type SectorRow = {
  sector: string
  multiplier: number
  display_order: number | null
  is_active: boolean | null
}

type Draft =
  | { kind: 'weight'; row: WeightRow }
  | { kind: 'sector'; row: SectorRow }

export function DiagnosticScoringPage() {
  usePageChrome({
    title: 'Diagnostic scoring',
    breadcrumbs: [{ label: 'Engines' }, { label: 'Diagnostic scoring' }],
  })

  const [weights, setWeights] = useState<WeightRow[]>([])
  const [sectors, setSectors] = useState<SectorRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [publishing, setPublishing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [wRes, sRes] = await Promise.all([
        sb
          .from('diagnostic_section_weights')
          .select('section_key,label,weight,display_order,is_active')
          .order('display_order', { ascending: true }),
        sb
          .from('diagnostic_sector_multipliers')
          .select('sector,multiplier,display_order,is_active')
          .order('display_order', { ascending: true }),
      ])
      if (wRes.error) throw wRes.error
      if (sRes.error) throw sRes.error
      setWeights((wRes.data as WeightRow[]) || [])
      setSectors((sRes.data as SectorRow[]) || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load diagnostic scoring.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const weightSum = weights.reduce((acc, w) => acc + (w.is_active === false ? 0 : Number(w.weight) || 0), 0)

  function openWeight(row: WeightRow) {
    setDraft({ kind: 'weight', row: { ...row } })
    setDirty(false)
    setNotice('')
    setError('')
    setOpen(true)
  }

  function openSector(row: SectorRow) {
    setDraft({ kind: 'sector', row: { ...row } })
    setDirty(false)
    setNotice('')
    setError('')
    setOpen(true)
  }

  function patchWeight(partial: Partial<WeightRow>) {
    setDraft((prev) =>
      prev?.kind === 'weight' ? { kind: 'weight', row: { ...prev.row, ...partial } } : prev,
    )
    setDirty(true)
  }

  function patchSector(partial: Partial<SectorRow>) {
    setDraft((prev) =>
      prev?.kind === 'sector' ? { kind: 'sector', row: { ...prev.row, ...partial } } : prev,
    )
    setDirty(true)
  }

  async function saveAndPublish() {
    if (!draft) return
    if (
      !window.confirm(
        'Publish these scoring changes? New diagnostics will use them immediately. Past reports are unchanged.',
      )
    ) {
      return
    }
    setPublishing(true)
    setError('')
    setNotice('')
    try {
      if (draft.kind === 'weight') {
        const weight = Number(draft.row.weight)
        if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
          throw new Error('Weight must be a number between 0 and 1.')
        }
        const { data, error: uErr } = await sb
          .from('diagnostic_section_weights')
          .update({
            label: draft.row.label,
            weight,
            display_order: Number(draft.row.display_order) || 0,
            is_active: draft.row.is_active !== false,
            updated_at: new Date().toISOString(),
          })
          .eq('section_key', draft.row.section_key)
          .select('section_key')
          .maybeSingle()
        if (uErr) throw uErr
        if (!data) throw new Error('Publish blocked — no row updated.')
      } else {
        const multiplier = Number(draft.row.multiplier)
        if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 2) {
          throw new Error('Multiplier must be greater than 0 and at most 2.')
        }
        const { data, error: uErr } = await sb
          .from('diagnostic_sector_multipliers')
          .update({
            multiplier,
            display_order: Number(draft.row.display_order) || 0,
            is_active: draft.row.is_active !== false,
            updated_at: new Date().toISOString(),
          })
          .eq('sector', draft.row.sector)
          .select('sector')
          .maybeSingle()
        if (uErr) throw uErr
        if (!data) throw new Error('Publish blocked — no row updated.')
      }
      setDirty(false)
      setNotice('Published to live diagnostic engine.')
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
        <PageHeader title="Diagnostic scoring" description="Section weights and sector multipliers." />
        <BrandLoader fill label="Loading scoring" />
      </PageFrame>
    )
  }

  return (
    <PageFrame>
      <PageHeader
        title="Diagnostic scoring"
        description="Engine config for the public risk diagnostic only — not the methodology catalogue (controls, frameworks, maps)."
      />
      {error && !open ? <Notice tone="risk">{error}</Notice> : null}
      {notice && !open ? <Notice tone="quiet">{notice}</Notice> : null}

      <div style={{ marginBottom: 8, color: 'var(--ra-text-2)', fontSize: 13 }}>
        Active section weight sum:{' '}
        <span style={{ color: 'var(--ra-ink)' }}>{weightSum.toFixed(2)}</span>
        {Math.abs(weightSum - 1) > 0.01 ? ' (should be near 1.00)' : ' · balanced'}
      </div>

      <h2
        style={{
          margin: '18px 0 8px',
          fontSize: 13,
          fontWeight: 'var(--ra-fw-medium)' as never,
          color: 'var(--ra-text-2)',
        }}
      >
        Section weights
      </h2>
      {weights.length === 0 ? (
        <EmptyState title="No section weights" body="diagnostic_section_weights is empty." />
      ) : (
        <Ledger>
          {weights.map((row) => (
            <LedgerRow
              key={row.section_key}
              title={`${row.section_key} · ${row.label}`}
              description={`${(Number(row.weight) * 100).toFixed(0)}% · ${
                row.is_active === false ? 'Inactive' : 'Active'
              }`}
              meta={
                <Button size="sm" variant="ghost" onClick={() => openWeight(row)}>
                  Edit
                </Button>
              }
            />
          ))}
        </Ledger>
      )}

      <h2
        style={{
          margin: '22px 0 8px',
          fontSize: 13,
          fontWeight: 'var(--ra-fw-medium)' as never,
          color: 'var(--ra-text-2)',
        }}
      >
        Sector multipliers
      </h2>
      {sectors.length === 0 ? (
        <EmptyState title="No sector multipliers" body="diagnostic_sector_multipliers is empty." />
      ) : (
        <Ledger>
          {sectors.map((row) => (
            <LedgerRow
              key={row.sector}
              title={row.sector}
              description={`×${Number(row.multiplier).toFixed(2)} · ${
                row.is_active === false ? 'Inactive' : 'Active'
              }`}
              meta={
                <Button size="sm" variant="ghost" onClick={() => openSector(row)}>
                  Edit
                </Button>
              }
            />
          ))}
        </Ledger>
      )}

      <Drawer
        open={open}
        onClose={() => {
          if (dirty && !window.confirm('Discard unpublished changes?')) return
          setOpen(false)
        }}
        title={
          draft?.kind === 'weight'
            ? `Weight · ${draft.row.section_key}`
            : draft?.kind === 'sector'
              ? `Sector · ${draft.row.sector}`
              : 'Edit'
        }
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
        {draft?.kind === 'weight' ? (
          <div className={styles.form}>
            <label className={styles.label}>
              Label
              <input
                className={styles.input}
                value={draft.row.label}
                onChange={(e) => patchWeight({ label: e.target.value })}
              />
            </label>
            <label className={styles.label}>
              Weight (0–1)
              <input
                className={styles.input}
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={draft.row.weight}
                onChange={(e) => patchWeight({ weight: Number(e.target.value) })}
              />
            </label>
            <label className={styles.label}>
              Display order
              <input
                className={styles.input}
                type="number"
                value={draft.row.display_order ?? 0}
                onChange={(e) => patchWeight({ display_order: Number(e.target.value) })}
              />
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={draft.row.is_active !== false}
                onChange={(e) => patchWeight({ is_active: e.target.checked })}
              />
              Active
            </label>
          </div>
        ) : null}
        {draft?.kind === 'sector' ? (
          <div className={styles.form}>
            <label className={styles.label}>
              Multiplier
              <input
                className={styles.input}
                type="number"
                step="0.01"
                min="0.01"
                max="2"
                value={draft.row.multiplier}
                onChange={(e) => patchSector({ multiplier: Number(e.target.value) })}
              />
            </label>
            <label className={styles.label}>
              Display order
              <input
                className={styles.input}
                type="number"
                value={draft.row.display_order ?? 0}
                onChange={(e) => patchSector({ display_order: Number(e.target.value) })}
              />
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={draft.row.is_active !== false}
                onChange={(e) => patchSector({ is_active: e.target.checked })}
              />
              Active
            </label>
          </div>
        ) : null}
      </Drawer>
    </PageFrame>
  )
}
