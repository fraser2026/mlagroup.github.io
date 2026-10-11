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
import { useMlaAuth } from '../auth/MlaAuthProvider'
import { fmtBytes, fmtWhen, loadPeople, type Person } from '../lib/clientWork'
import styles from './ClientWork.module.css'

type Review = 'submitted' | 'accepted' | 'changes_requested'

type EvidenceRow = {
  id: string
  org_id: string
  control_assignment_id: string | null
  system_id: string | null
  file_name: string
  file_path: string
  file_type: string | null
  file_size: number | null
  description: string | null
  uploaded_by: string | null
  uploaded_at: string | null
  review_status: Review
  review_note: string | null
  reviewed_at: string | null
}

type Filter = Review | 'all'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'submitted', label: 'To review' },
  { id: 'changes_requested', label: 'Changes requested' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'all', label: 'All' },
]

const REVIEW_LABEL: Record<Review, string> = {
  submitted: 'To review',
  accepted: 'Accepted',
  changes_requested: 'Changes requested',
}

function reviewTone(s: Review) {
  if (s === 'accepted') return 'ok' as const
  if (s === 'changes_requested') return 'warn' as const
  return 'neutral' as const
}

export function EvidenceReviewPage() {
  usePageChrome({ title: 'Evidence review', breadcrumbs: [{ label: 'Clients' }, { label: 'Evidence review' }] })
  const { user } = useMlaAuth()

  const [rows, setRows] = useState<EvidenceRow[]>([])
  const [orgs, setOrgs] = useState<Map<string, string>>(new Map())
  const [people, setPeople] = useState<Map<string, Person>>(new Map())
  const [controls, setControls] = useState<Map<string, string>>(new Map())
  const [assets, setAssets] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [filter, setFilter] = useState<Filter>('submitted')
  const [openId, setOpenId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: qErr } = await sb
        .from('evidence_uploads')
        .select(
          'id,org_id,control_assignment_id,system_id,file_name,file_path,file_type,file_size,description,uploaded_by,uploaded_at,review_status,review_note,reviewed_at',
        )
        .order('uploaded_at', { ascending: false })
        .limit(400)
      if (qErr) throw qErr
      const list = (data as EvidenceRow[]) || []
      setRows(list)

      const orgIds = [...new Set(list.map((r) => r.org_id))]
      const assignIds = [...new Set(list.map((r) => r.control_assignment_id).filter(Boolean))] as string[]
      const sysIds = [...new Set(list.map((r) => r.system_id).filter(Boolean))] as string[]
      const [orgRes, peopleMap, assignRes, sysRes] = await Promise.all([
        orgIds.length ? sb.from('organisations').select('id,name').in('id', orgIds) : Promise.resolve({ data: [] }),
        loadPeople(list.map((r) => r.uploaded_by)),
        assignIds.length
          ? sb.from('control_assignments').select('id,control_id').in('id', assignIds)
          : Promise.resolve({ data: [] }),
        sysIds.length ? sb.from('ai_systems').select('id,name').in('id', sysIds) : Promise.resolve({ data: [] }),
      ])
      setOrgs(new Map(((orgRes.data as { id: string; name: string }[]) || []).map((o) => [o.id, o.name])))
      setPeople(peopleMap)
      setAssets(new Map(((sysRes.data as { id: string; name: string }[]) || []).map((s) => [s.id, s.name])))

      const assigns = (assignRes.data as { id: string; control_id: string }[]) || []
      const ctrlIds = [...new Set(assigns.map((a) => a.control_id).filter(Boolean))]
      const { data: ctrls } = ctrlIds.length
        ? await sb.from('governance_controls').select('id,control_number,title').in('id', ctrlIds)
        : { data: [] }
      const ctrlById = new Map(
        ((ctrls as { id: string; control_number: number; title: string }[]) || []).map((c) => [
          c.id,
          `C${c.control_number} ${c.title}`,
        ]),
      )
      setControls(new Map(assigns.map((a) => [a.id, ctrlById.get(a.control_id) || 'Control'])))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load evidence.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { submitted: 0, accepted: 0, changes_requested: 0, all: rows.length }
    for (const r of rows) c[r.review_status] += 1
    return c
  }, [rows])

  const shown = filter === 'all' ? rows : rows.filter((r) => r.review_status === filter)
  const current = openId ? rows.find((r) => r.id === openId) || null : null
  const uploader = current?.uploaded_by ? people.get(current.uploaded_by) : undefined
  const controlLabel = current?.control_assignment_id ? controls.get(current.control_assignment_id) : undefined

  function openRow(id: string) {
    const row = rows.find((r) => r.id === id)
    setOpenId(id)
    setNote(row?.review_note || '')
    setNotice('')
  }

  async function openFile(path: string) {
    const { data, error: urlErr } = await sb.storage.from('governance-reports').createSignedUrl(path, 3600)
    if (urlErr || !data?.signedUrl) {
      setError(urlErr?.message || 'Could not open file.')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function review(status: Review) {
    if (!current || !user) return
    const text = note.trim()
    if (status === 'changes_requested' && !text) {
      setError('Add a note explaining what the client needs to change.')
      return
    }
    setBusy(status)
    setError('')
    try {
      const { error: upErr } = await sb
        .from('evidence_uploads')
        .update({
          review_status: status,
          review_note: text || null,
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', current.id)
      if (upErr) throw upErr
      const accepted = status === 'accepted'
      const { error: alertErr } = await sb.from('governance_alerts').insert({
        org_id: current.org_id,
        system_id: current.system_id,
        alert_type: 'evidence_review',
        severity: accepted ? 'info' : 'warning',
        title: accepted
          ? `Evidence accepted: ${current.file_name}`
          : `Changes requested: ${current.file_name}`,
        body: [controlLabel, text].filter(Boolean).join('. ') || null,
        ref_id: current.control_assignment_id,
        ref_type: 'control_assignment',
      })
      if (alertErr) throw new Error(`Review saved, but the client notification failed: ${alertErr.message}`)
      setNotice(
        accepted
          ? 'Evidence accepted. The client has been notified in RegAnchor.'
          : 'Changes requested. The client has been notified in RegAnchor.',
      )
      setOpenId(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save review.')
    } finally {
      setBusy('')
    }
  }

  return (
    <PageFrame>
      <PageHeader
        title="Evidence review"
        description="Files clients upload against controls. Accept them, or request a change with a note. The client sees the outcome on the control and in their notifications."
      />
      {error ? <Notice tone="risk">{error}</Notice> : null}
      {notice && !error ? <Notice tone="quiet">{notice}</Notice> : null}

      <div className={styles.filters} role="tablist" aria-label="Filter evidence">
        {FILTERS.map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant="ghost"
            selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            role="tab"
            aria-selected={filter === f.id}
          >
            {f.label}
            <span className={styles.count}>{counts[f.id]}</span>
          </Button>
        ))}
      </div>

      {loading ? (
        <BrandLoader fill label="Loading evidence" />
      ) : shown.length === 0 ? (
        <EmptyState
          title={filter === 'submitted' ? 'Nothing to review' : 'Nothing here'}
          body="Evidence uploaded by clients on their controls appears here."
        />
      ) : (
        <Ledger>
          {shown.map((r) => (
            <LedgerRow
              key={r.id}
              onClick={() => openRow(r.id)}
              title={r.file_name}
              description={[
                orgs.get(r.org_id) || 'Unknown organisation',
                r.control_assignment_id ? controls.get(r.control_assignment_id) : null,
                r.system_id ? assets.get(r.system_id) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              meta={
                <div className={styles.rowMeta}>
                  <span className={styles.when}>{fmtWhen(r.uploaded_at)}</span>
                  <StatusLabel tone={reviewTone(r.review_status)}>{REVIEW_LABEL[r.review_status]}</StatusLabel>
                </div>
              }
            />
          ))}
        </Ledger>
      )}

      <Drawer
        open={!!current}
        title={current?.file_name || 'Evidence'}
        headerMeta={
          current ? (
            <StatusLabel tone={reviewTone(current.review_status)}>{REVIEW_LABEL[current.review_status]}</StatusLabel>
          ) : null
        }
        onClose={() => setOpenId(null)}
        footer={
          current ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                pending={busy === 'changes_requested'}
                onClick={() => void review('changes_requested')}
              >
                Request changes
              </Button>
              <Button size="sm" pending={busy === 'accepted'} onClick={() => void review('accepted')}>
                Accept
              </Button>
            </>
          ) : null
        }
      >
        {current ? (
          <div className={styles.detail}>
            <div className={styles.fileRow}>
              <span className={styles.fileName}>{current.file_name}</span>
              <span className={styles.fileSize}>{fmtBytes(current.file_size)}</span>
              <Button size="sm" variant="ghost" onClick={() => void openFile(current.file_path)}>
                Open
              </Button>
            </div>

            <dl className={styles.facts}>
              <div>
                <dt>Organisation</dt>
                <dd>{orgs.get(current.org_id) || 'Unknown organisation'}</dd>
              </div>
              <div>
                <dt>Uploaded by</dt>
                <dd>
                  {uploader?.name || 'Unknown user'}
                  {uploader?.email ? <span className={styles.sub}>{uploader.email}</span> : null}
                </dd>
              </div>
              <div>
                <dt>Uploaded</dt>
                <dd>{fmtWhen(current.uploaded_at)}</dd>
              </div>
              {controlLabel ? (
                <div>
                  <dt>Control</dt>
                  <dd>{controlLabel}</dd>
                </div>
              ) : null}
              {current.system_id ? (
                <div>
                  <dt>AI asset</dt>
                  <dd>{assets.get(current.system_id) || 'AI asset'}</dd>
                </div>
              ) : null}
              {current.reviewed_at ? (
                <div>
                  <dt>Last reviewed</dt>
                  <dd>{fmtWhen(current.reviewed_at)}</dd>
                </div>
              ) : null}
            </dl>

            {current.description ? (
              <section>
                <h3 className={styles.h3}>Client note</h3>
                <p className={styles.message}>{current.description}</p>
              </section>
            ) : null}

            <section>
              <h3 className={styles.h3}>Review note</h3>
              <textarea
                className={styles.textarea}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Required when requesting changes. Shown to the client on the control."
              />
            </section>
          </div>
        ) : null}
      </Drawer>
    </PageFrame>
  )
}
