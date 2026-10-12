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
import { fmtWhen, loadPeople, type Person } from '../lib/clientWork'
import styles from './ClientWork.module.css'

const APP_ORIGIN = 'https://app.reganchor.com'

type RequestRow = {
  id: string
  org_id: string
  requested_by: string | null
  requested_at: string | null
  created_at: string | null
  status: 'open' | 'responded' | 'closed'
  subject: string | null
  category: string | null
  client_message: string | null
  page_path: string | null
  page_title: string | null
  attachment_path: string | null
  attachment_name: string | null
  attachment_size: number | null
  mla_response: string | null
  responded_at: string | null
  control_id: string | null
  system_id: string | null
}

type Filter = 'open' | 'responded' | 'closed' | 'all'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'responded', label: 'Responded' },
  { id: 'closed', label: 'Closed' },
  { id: 'all', label: 'All' },
]

function statusTone(s: string) {
  if (s === 'open') return 'warn' as const
  if (s === 'responded') return 'ok' as const
  return 'neutral' as const
}

function statusLabel(s: string) {
  return s === 'open' ? 'Open' : s === 'responded' ? 'Responded' : 'Closed'
}

export function ClientRequestsPage() {
  usePageChrome({ title: 'Client requests', breadcrumbs: [{ label: 'Clients' }, { label: 'Requests' }] })
  const { user } = useMlaAuth()

  const [rows, setRows] = useState<RequestRow[]>([])
  const [orgs, setOrgs] = useState<Map<string, string>>(new Map())
  const [people, setPeople] = useState<Map<string, Person>>(new Map())
  const [context, setContext] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [filter, setFilter] = useState<Filter>('open')
  const [openId, setOpenId] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: qErr } = await sb
        .from('support_requests')
        .select(
          'id,org_id,requested_by,requested_at,created_at,status,subject,category,client_message,page_path,page_title,attachment_path,attachment_name,attachment_size,mla_response,responded_at,control_id,system_id',
        )
        .order('created_at', { ascending: false })
        .limit(300)
      if (qErr) throw qErr
      const list = (data as RequestRow[]) || []
      setRows(list)

      const orgIds = [...new Set(list.map((r) => r.org_id))]
      const ctrlIds = [...new Set(list.map((r) => r.control_id).filter(Boolean))] as string[]
      const sysIds = [...new Set(list.map((r) => r.system_id).filter(Boolean))] as string[]
      const [orgRes, peopleMap, ctrlRes, sysRes] = await Promise.all([
        orgIds.length ? sb.from('organisations').select('id,name').in('id', orgIds) : Promise.resolve({ data: [] }),
        loadPeople(list.map((r) => r.requested_by)),
        ctrlIds.length
          ? sb.from('governance_controls').select('id,control_number,reference,title').in('id', ctrlIds)
          : Promise.resolve({ data: [] }),
        sysIds.length ? sb.from('ai_systems').select('id,name').in('id', sysIds) : Promise.resolve({ data: [] }),
      ])
      setOrgs(new Map(((orgRes.data as { id: string; name: string }[]) || []).map((o) => [o.id, o.name])))
      setPeople(peopleMap)
      const ctx = new Map<string, string>()
      for (const c of (ctrlRes.data as { id: string; control_number: number | null; reference: string | null; title: string }[]) || []) {
        ctx.set(c.id, c.control_number != null ? `C${c.control_number} ${c.title}` : c.reference ? `${c.reference} ${c.title}` : c.title)
      }
      for (const s of (sysRes.data as { id: string; name: string }[]) || []) ctx.set(s.id, s.name)
      setContext(ctx)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load client requests.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { open: 0, responded: 0, closed: 0, all: rows.length }
    for (const r of rows) c[r.status] += 1
    return c
  }, [rows])

  const shown = filter === 'all' ? rows : rows.filter((r) => r.status === filter)
  const current = openId ? rows.find((r) => r.id === openId) || null : null
  const requester = current?.requested_by ? people.get(current.requested_by) : undefined

  function openRow(id: string) {
    setOpenId(id)
    setReply('')
    setNotice('')
  }

  async function openAttachment(path: string) {
    const { data, error: urlErr } = await sb.storage.from('governance-reports').createSignedUrl(path, 3600)
    if (urlErr || !data?.signedUrl) {
      setError(urlErr?.message || 'Could not open attachment.')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function sendReply() {
    if (!current || !user) return
    const text = reply.trim()
    if (!text) return
    setBusy('reply')
    setError('')
    try {
      const { error: upErr } = await sb
        .from('support_requests')
        .update({
          mla_response: text,
          responded_by: user.id,
          responded_at: new Date().toISOString(),
          status: 'responded',
        })
        .eq('id', current.id)
      if (upErr) throw upErr
      if (requester?.email) {
        const { error: mailErr } = await sb.functions.invoke('send-mail', {
          body: {
            kind: 'admin-reply',
            to_email: requester.email,
            to_name: requester.name,
            subject: `Re: ${current.subject || 'Your RegAnchor request'}`,
            message: text,
          },
        })
        if (mailErr) throw new Error(`Reply saved, but the email failed: ${mailErr.message}`)
      }
      setNotice(requester?.email ? `Reply sent to ${requester.email}.` : 'Reply saved.')
      setReply('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send reply.')
    } finally {
      setBusy('')
    }
  }

  async function setStatus(status: RequestRow['status']) {
    if (!current) return
    setBusy(status)
    setError('')
    const { error: upErr } = await sb.from('support_requests').update({ status }).eq('id', current.id)
    setBusy('')
    if (upErr) {
      setError(upErr.message)
      return
    }
    setNotice(status === 'closed' ? 'Request closed.' : 'Request reopened.')
    await load()
  }

  return (
    <PageFrame>
      <PageHeader
        title="Client requests"
        description="Help requests sent from any page in the RegAnchor app, including the page the client was on."
      />
      {error ? <Notice tone="risk">{error}</Notice> : null}
      {notice && !error ? <Notice tone="quiet">{notice}</Notice> : null}

      <div className={styles.filters} role="tablist" aria-label="Filter requests">
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
        <BrandLoader fill label="Loading requests" />
      ) : shown.length === 0 ? (
        <EmptyState
          title={filter === 'open' ? 'No open requests' : 'Nothing here'}
          body="New help requests from clients appear here and are emailed to info@reganchor.com."
        />
      ) : (
        <Ledger>
          {shown.map((r) => {
            const who = r.requested_by ? people.get(r.requested_by) : undefined
            return (
              <LedgerRow
                key={r.id}
                onClick={() => openRow(r.id)}
                title={r.subject || r.client_message?.slice(0, 80) || 'Help request'}
                description={[
                  orgs.get(r.org_id) || 'Unknown organisation',
                  who?.name,
                  r.page_title || (r.control_id ? context.get(r.control_id) : null),
                ]
                  .filter(Boolean)
                  .join(' · ')}
                meta={
                  <div className={styles.rowMeta}>
                    <span className={styles.when}>{fmtWhen(r.created_at || r.requested_at)}</span>
                    <StatusLabel tone={statusTone(r.status)}>{statusLabel(r.status)}</StatusLabel>
                  </div>
                }
              />
            )
          })}
        </Ledger>
      )}

      <Drawer
        open={!!current}
        title={current?.subject || 'Help request'}
        headerMeta={
          current ? <StatusLabel tone={statusTone(current.status)}>{statusLabel(current.status)}</StatusLabel> : null
        }
        onClose={() => setOpenId(null)}
        footer={
          current ? (
            <>
              {current.status === 'closed' ? (
                <Button variant="ghost" size="sm" pending={busy === 'open'} onClick={() => void setStatus('open')}>
                  Reopen
                </Button>
              ) : (
                <Button variant="ghost" size="sm" pending={busy === 'closed'} onClick={() => void setStatus('closed')}>
                  Close request
                </Button>
              )}
              <Button size="sm" pending={busy === 'reply'} disabled={!reply.trim()} onClick={() => void sendReply()}>
                Send reply
              </Button>
            </>
          ) : null
        }
      >
        {current ? (
          <div className={styles.detail}>
            <dl className={styles.facts}>
              <div>
                <dt>Organisation</dt>
                <dd>{orgs.get(current.org_id) || 'Unknown organisation'}</dd>
              </div>
              <div>
                <dt>From</dt>
                <dd>
                  {requester?.name || 'Unknown user'}
                  {requester?.email ? <span className={styles.sub}>{requester.email}</span> : null}
                </dd>
              </div>
              <div>
                <dt>Sent</dt>
                <dd>{fmtWhen(current.created_at || current.requested_at)}</dd>
              </div>
              {current.category ? (
                <div>
                  <dt>Topic</dt>
                  <dd>{current.category}</dd>
                </div>
              ) : null}
              {current.page_path ? (
                <div>
                  <dt>Page</dt>
                  <dd>
                    {current.page_title || current.page_path}
                    <a
                      className={styles.link}
                      href={`${APP_ORIGIN}${current.page_path}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {current.page_path}
                    </a>
                  </dd>
                </div>
              ) : null}
              {current.control_id ? (
                <div>
                  <dt>Control</dt>
                  <dd>{context.get(current.control_id) || 'Control'}</dd>
                </div>
              ) : null}
              {current.system_id ? (
                <div>
                  <dt>AI asset</dt>
                  <dd>{context.get(current.system_id) || 'AI asset'}</dd>
                </div>
              ) : null}
            </dl>

            <section>
              <h3 className={styles.h3}>Message</h3>
              <p className={styles.message}>{current.client_message || 'No message.'}</p>
            </section>

            {current.attachment_path ? (
              <section>
                <h3 className={styles.h3}>Attachment</h3>
                <div className={styles.fileRow}>
                  <span className={styles.fileName}>{current.attachment_name || 'Attachment'}</span>
                  <Button size="sm" variant="ghost" onClick={() => void openAttachment(current.attachment_path!)}>
                    Open
                  </Button>
                </div>
              </section>
            ) : null}

            {current.mla_response ? (
              <section>
                <h3 className={styles.h3}>Last reply · {fmtWhen(current.responded_at)}</h3>
                <p className={styles.message}>{current.mla_response}</p>
              </section>
            ) : null}

            <section>
              <h3 className={styles.h3}>{current.mla_response ? 'Send another reply' : 'Reply'}</h3>
              <textarea
                className={styles.textarea}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={
                  requester?.email
                    ? `Your reply is emailed to ${requester.email}.`
                    : 'Your reply is saved on the request.'
                }
              />
            </section>
          </div>
        ) : null}
      </Drawer>
    </PageFrame>
  )
}
