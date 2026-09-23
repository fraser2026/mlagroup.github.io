import { useCallback, useEffect, useState } from 'react'
import {
  BrandLoader,
  Button,
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

type VersionRow = {
  id: string
  version_label: string
  note: string | null
  catalogue_hash: string
  is_current: boolean
  published_at: string
}

function defaultLabel() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}.${m}.${day}`
}

export function MethodologyVersionsPage() {
  usePageChrome({
    title: 'Methodology versions',
    breadcrumbs: [{ label: 'Methodology' }, { label: 'Versions' }],
  })

  const [rows, setRows] = useState<VersionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [label, setLabel] = useState(defaultLabel)
  const [note, setNote] = useState('')
  const [publishing, setPublishing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: qErr } = await sb
        .from('methodology_versions')
        .select('id,version_label,note,catalogue_hash,is_current,published_at')
        .order('published_at', { ascending: false })
      if (qErr) throw qErr
      setRows((data as VersionRow[]) || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load methodology versions.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function publish() {
    const trimmed = label.trim()
    if (!trimmed) {
      setError('Version label is required.')
      return
    }
    if (
      !window.confirm(
        `Publish methodology version “${trimmed}”? This freezes the current controls, frameworks, and mappings. New dossiers will cite this version until the next publish.`,
      )
    ) {
      return
    }
    setPublishing(true)
    setError('')
    setNotice('')
    try {
      const { data, error: rpcErr } = await sb.rpc('publish_methodology_version', {
        p_version_label: trimmed,
        p_note: note.trim() || null,
      })
      if (rpcErr) throw rpcErr
      const row = (Array.isArray(data) ? data[0] : data) as VersionRow | null
      setNotice(
        row
          ? `Published ${row.version_label} · catalogue ${row.catalogue_hash}`
          : 'Published methodology version.',
      )
      setNote('')
      setLabel(defaultLabel())
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
          title="Methodology versions"
          description="Publish freezes controls, frameworks, and mappings for dossier provenance."
        />
        <BrandLoader fill label="Loading versions" />
      </PageFrame>
    )
  }

  return (
    <PageFrame>
      <PageHeader
        title="Methodology versions"
        description="Working copy stays editable in Controls / Frameworks / Mappings. Publish creates a named snapshot dossiers can cite."
      />
      {error ? <Notice tone="risk">{error}</Notice> : null}
      {notice ? <Notice tone="quiet">{notice}</Notice> : null}

      <div className={styles.form} style={{ marginBottom: 20, maxWidth: 520 }}>
        <label className={styles.label}>
          Version label
          <input className={styles.input} value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className={styles.label}>
          Note (optional)
          <textarea className={styles.textarea} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className={styles.footer}>
          <Button pending={publishing} onClick={() => void publish()}>
            Publish current catalogue
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No published versions yet"
          body="Publish once after your methodology edits so dossiers can cite a version id."
        />
      ) : (
        <Ledger>
          {rows.map((row) => (
            <LedgerRow
              key={row.id}
              title={row.version_label}
              description={[
                `Catalogue ${row.catalogue_hash}`,
                row.note || null,
                new Date(row.published_at).toLocaleString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              ]
                .filter(Boolean)
                .join(' · ')}
              meta={row.is_current ? <StatusLabel tone="ok">Current</StatusLabel> : <StatusLabel tone="neutral">Superseded</StatusLabel>}
            />
          ))}
        </Ledger>
      )}
    </PageFrame>
  )
}
