import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { BrandLoader, Notice, StatusLabel } from '../ui'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../lib/config'
import { fmtDate } from '../lib/rpc'
import styles from './AuditorPortalPage.module.css'

type Snapshot = {
  organisation?: { name?: string }
  engagement?: {
    name?: string
    firm_name?: string | null
    window_start?: string
    window_end?: string
    scopes?: Record<string, boolean>
  }
  access?: { kind?: string; expires_at?: string }
  assets?: Array<Record<string, unknown>>
  assessments?: Array<Record<string, unknown>>
  policies?: Array<Record<string, unknown>>
  control_assignments?: Array<Record<string, unknown>>
  frameworks?: Array<Record<string, unknown>>
  evidence?: Array<Record<string, unknown>>
  scores?: Array<Record<string, unknown>>
  activity?: Array<Record<string, unknown>>
}

export function AuditorPortalPage() {
  const { token: tokenParam } = useParams()
  const token = decodeURIComponent(tokenParam || '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!token) {
        setError('Missing access token.')
        setLoading(false)
        return
      }
      setLoading(true)
      setError('')
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/auditor-portal`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ token }),
        })
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          error?: string
          snapshot?: Snapshot
        }
        if (!res.ok || data.error) throw new Error(data.error || 'Could not open auditor view.')
        if (!cancelled) setSnapshot(data.snapshot || null)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not open auditor view.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [token])

  if (loading) {
    return (
      <div className={styles.shell}>
        <BrandLoader fill label="Loading auditor view" />
      </div>
    )
  }

  if (error || !snapshot) {
    return (
      <div className={styles.shell}>
        <div className={styles.card}>
          <h1 className={styles.title}>Access unavailable</h1>
          <Notice tone="risk">{error || 'This auditor link is invalid or has expired.'}</Notice>
        </div>
      </div>
    )
  }

  const eng = snapshot.engagement
  const sections: { key: string; title: string; rows: Array<Record<string, unknown>> | undefined; cols: string[] }[] =
    [
      { key: 'assets', title: 'AI assets', rows: snapshot.assets, cols: ['name', 'provider_slug', 'lifecycle', 'risk_tier'] },
      {
        key: 'assessments',
        title: 'Assessments',
        rows: snapshot.assessments,
        cols: ['status', 'risk_band', 'overall_score', 'requested_at'],
      },
      { key: 'policies', title: 'Policies', rows: snapshot.policies, cols: ['title', 'version', 'is_active'] },
      {
        key: 'controls',
        title: 'Controls',
        rows: snapshot.control_assignments,
        cols: ['status', 'due_date', 'updated_at'],
      },
      { key: 'frameworks', title: 'Frameworks', rows: snapshot.frameworks, cols: ['name', 'is_active', 'source'] },
      { key: 'evidence', title: 'Evidence', rows: snapshot.evidence, cols: ['file_name', 'uploaded_at'] },
      { key: 'scores', title: 'Governance scores', rows: snapshot.scores, cols: ['composite_score', 'snapshot_at'] },
      { key: 'activity', title: 'Activity', rows: snapshot.activity, cols: ['action', 'entity_type', 'created_at'] },
    ]

  return (
    <div className={styles.shell}>
      <header className={styles.top}>
        <div>
          <div className={styles.brand}>RegAnchor</div>
          <p className={styles.sub}>Read-only auditor view</p>
        </div>
        <StatusLabel tone="ok">Read only</StatusLabel>
      </header>

      <div className={styles.card}>
        <h1 className={styles.title}>{eng?.name || 'Auditor engagement'}</h1>
        <p className={styles.meta}>
          {snapshot.organisation?.name || 'Organisation'}
          {eng?.firm_name ? ` · ${eng.firm_name}` : ''}
          {eng?.window_end ? ` · Access until ${fmtDate(eng.window_end)}` : ''}
        </p>
        <p className={styles.note}>
          This view is scoped by the organisation. You cannot change records, invite users, or access billing,
          Connect, or credentials.
        </p>
      </div>

      {sections.map((section) => {
        if (!section.rows) return null
        return (
          <section key={section.key} className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>{section.title}</h2>
              <span className={styles.count}>{section.rows.length}</span>
            </div>
            {!section.rows.length ? (
              <p className={styles.empty}>No records in scope.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {section.cols.map((c) => (
                        <th key={c}>{c.replace(/_/g, ' ')}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.slice(0, 80).map((row, i) => (
                      <tr key={String(row.id || i)}>
                        {section.cols.map((c) => (
                          <td key={c}>{formatCell(row[c])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function formatCell(value: unknown): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return fmtDate(value)
  return String(value)
}
