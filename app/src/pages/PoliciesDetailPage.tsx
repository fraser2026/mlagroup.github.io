import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  BrandLoader,
  Button,
  EmptyState,
  Notice,
  PageFrame,
  PageHeader,
  Section,
  StatusLabel,
  ToastStack,
} from '../ui'
import type { ToastItem } from '../ui'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { actorName, writeAuditLog } from '../lib/audit'
import { POLICY_CATS, renderPolicyMarkdown } from '../lib/policyMarkdown'
import { sb } from '../lib/supabase'
import styles from './PoliciesPage.module.css'

type Policy = {
  id: string
  title?: string | null
  description?: string | null
  content?: string | null
  version?: string | null
  category?: string | null
  requires_acknowledgment?: boolean | null
  published_at?: string | null
  updated_at?: string | null
  document_url?: string | null
  document_file_name?: string | null
}

type Ack = {
  id: string
  user_id: string
  version_acknowledged?: string | null
  acknowledgment_method?: string | null
  acknowledged_at?: string | null
}

export function PoliciesDetailPage() {
  const { id } = useParams()
  const { session, org, profile } = useAuth()
  const orgId = org?.id || null
  const userId = session?.user?.id
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [acks, setAcks] = useState<Ack[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [docUrl, setDocUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const title = policy?.title || 'Policy'

  function pushToast(text: string) {
    if (!text.trim()) return
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `t-${Date.now()}-${Math.random().toString(16).slice(2)}`
    setToasts((prev) => [...prev, { id, text }])
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  usePageChrome({
    title,
    breadcrumbs: [
      { label: 'Policies', to: '/policies' },
      { label: title },
    ],
  })

  async function refresh() {
    if (!id || !orgId || !userId) return
    setError('')
    const { data, error: loadErr } = await sb
      .from('policy_documents')
      .select(
        'id,title,description,content,version,category,requires_acknowledgment,published_at,updated_at,document_url,document_file_name',
      )
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle()

    if (loadErr || !data) {
      setPolicy(null)
      setError(loadErr?.message || 'Policy not found.')
      setLoading(false)
      return
    }

    const pol = data as Policy
    setPolicy(pol)

    if (!pol.content && pol.document_url) {
      const { data: signed } = await sb.storage
        .from('governance-reports')
        .createSignedUrl(pol.document_url, 3600)
      setDocUrl(signed?.signedUrl || '')
    } else {
      setDocUrl('')
    }

    const { data: hist } = await sb
      .from('policy_acknowledgments')
      .select('id,user_id,version_acknowledged,acknowledgment_method,acknowledged_at')
      .eq('policy_id', id)
      .eq('org_id', orgId)
      .order('acknowledged_at', { ascending: false })

    const list = (hist as Ack[]) || []
    setAcks(list)
    const ids = [...new Set(list.map((a) => a.user_id))]
    if (ids.length) {
      const { data: profiles } = await sb.from('profiles').select('id,full_name,email').in('id', ids)
      const map: Record<string, string> = {}
      for (const p of profiles || []) {
        map[p.id as string] = (p.full_name as string) || (p.email as string) || 'Unknown'
      }
      setNames(map)
    } else {
      setNames({})
    }
    setLoading(false)
  }

  useEffect(() => {
    let cancelled = false
    async function boot() {
      setLoading(true)
      if (!orgId || !userId) {
        if (!cancelled) setLoading(false)
        return
      }
      await refresh()
    }
    void boot()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, orgId, userId])

  const userAcked = acks.find(
    (a) => a.user_id === userId && a.version_acknowledged === policy?.version,
  )

  async function acknowledge() {
    if (!policy || !orgId || !userId) return
    setBusy(true)
    setError('')
    pushToast('')
    const { error: insertErr } = await sb.from('policy_acknowledgments').insert({
      policy_id: policy.id,
      user_id: userId,
      org_id: orgId,
      version_acknowledged: policy.version,
      ip_address: null,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      acknowledgment_method: 'click',
    })
    if (insertErr) {
      setBusy(false)
      if (insertErr.code === '23505') {
        setError('You have already acknowledged this version.')
      } else {
        setError(insertErr.message)
      }
      return
    }
    await writeAuditLog({
      orgId,
      userId,
      action: 'policy_acknowledged',
      entityType: 'policy',
      entityId: policy.id,
      changes: {
        _actor_name: actorName(profile?.full_name, session?.user?.email),
        policy: policy.title,
        version: policy.version,
        method: 'click',
      },
    })
    await refresh()
    setBusy(false)
    pushToast('Policy acknowledged.')
  }

  if (!orgId) {
    return (
      <PageFrame>
        <PageHeader title="Policy" description="Organisation context required." />
        <EmptyState title="No organisation" body="Join or create an organisation to manage policies." />
      </PageFrame>
    )
  }

  if (loading) {
    return (
      <PageFrame>
        <PageHeader title="Policy" description="Loading policy" />
        <BrandLoader fill label="Loading policy" />
      </PageFrame>
    )
  }

  if (!policy) {
    return (
      <PageFrame>
        <PageHeader
          title="Policy"
          description="Policy not found."
          actions={
            <Link to="/policies">
              <Button variant="ghost">Back to policies</Button>
            </Link>
          }
        />
        {error ? <Notice tone="risk" title="Error">{error}</Notice> : null}
        <EmptyState title="Policy not found" body="It may have been removed, or you may not have access." />
      </PageFrame>
    )
  }

  const metaLine = [POLICY_CATS[policy.category || ''] || policy.category, policy.version ? `v${policy.version}` : null]
    .filter(Boolean)
    .join(' ')

  return (
    <PageFrame
      railItems={[
        { id: 'ack', label: 'Acknowledgment' },
        { id: 'content', label: 'Content' },
        { id: 'history', label: 'History' },
      ]}
    >
      <PageHeader
        title={title}
        description={
          <div className={styles.pageMeta}>
            {userAcked ? (
              <StatusLabel badge tone="ok">
                Acknowledged
              </StatusLabel>
            ) : policy.requires_acknowledgment ? (
              <StatusLabel badge tone="warn">
                Pending
              </StatusLabel>
            ) : (
              <StatusLabel badge tone="neutral">
                Published
              </StatusLabel>
            )}
            {metaLine ? <span className={styles.pageMetaLine}>{metaLine}</span> : null}
          </div>
        }
        actions={
          <Link to="/policies">
            <Button variant="ghost">Back to policies</Button>
          </Link>
        }
      />

      {error ? <Notice tone="risk" title="Error">{error}</Notice> : null}

      <div className={styles.page}>
        <Section id="ack" className={styles.block}>
          <div className={styles.work}>
            <div className={styles.workHead}>
              <h2 className={styles.workTitle}>Acknowledgment</h2>
            </div>
            <div className={styles.lead}>
              {policy.description ? <p className={styles.bodyCopy}>{policy.description}</p> : null}
              <div className={styles.meta}>
                {policy.updated_at
                  ? `Updated ${new Date(policy.updated_at).toLocaleDateString()}`
                  : policy.published_at
                    ? `Published ${new Date(policy.published_at).toLocaleDateString()}`
                    : 'Draft / unpublished'}
              </div>

              {userAcked ? (
                <p className={styles.ackDone}>
                  You acknowledged this policy on{' '}
                  {userAcked.acknowledged_at
                    ? new Date(userAcked.acknowledged_at).toLocaleString()
                    : 'an earlier date'}
                  . Version {userAcked.version_acknowledged}.
                </p>
              ) : policy.requires_acknowledgment ? (
                <div className={styles.ackBlock}>
                  <p className={styles.ackCopy}>
                    Read this policy, then acknowledge it to create an auditable record of acceptance.
                  </p>
                  <div className={styles.actions}>
                    <Button pending={busy} onClick={() => void acknowledge()}>
                      I have read and accept
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </Section>

        <Section id="content" className={styles.block}>
          <div className={styles.work}>
            <div className={styles.workHead}>
              <h2 className={styles.workTitle}>Content</h2>
            </div>
            {policy.content ? (
              <div
                className={styles.doc}
                dangerouslySetInnerHTML={{
                  __html: renderPolicyMarkdown(policy.content, policy.title),
                }}
              />
            ) : policy.document_url ? (
              <div className={styles.lead}>
                {docUrl ? (
                  <a className={styles.fileLink} href={docUrl} target="_blank" rel="noreferrer">
                    View document
                  </a>
                ) : (
                  <p className={styles.empty}>Document link unavailable.</p>
                )}
                <div className={styles.meta}>{policy.document_file_name || 'Attached policy document'}</div>
              </div>
            ) : (
              <EmptyState title="No content available" />
            )}
          </div>
        </Section>

        <Section id="history" className={styles.block}>
          <div className={styles.work}>
            <div className={styles.workHead}>
              <h2 className={styles.workTitle}>Acknowledgments</h2>
              {acks.length > 0 ? (
                <span className={styles.workSub}>
                  {acks.length} record{acks.length === 1 ? '' : 's'}
                </span>
              ) : null}
            </div>
            {acks.length === 0 ? (
              <p className={styles.empty}>No acknowledgments yet.</p>
            ) : (
              <div className={styles.ackList}>
                {acks.map((a) => (
                  <div key={a.id} className={styles.ackRow}>
                    <div className={styles.ackName}>{names[a.user_id] || 'Unknown'}</div>
                    <div className={styles.meta}>
                      v{a.version_acknowledged}
                      {a.acknowledgment_method === 'e_signature' ? ' E-signature' : ' Click'}
                      {a.acknowledged_at ? ` ${new Date(a.acknowledged_at).toLocaleString()}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Section>
      </div>

      <ToastStack items={toasts} onDismiss={dismissToast} />
    </PageFrame>
  )
}
