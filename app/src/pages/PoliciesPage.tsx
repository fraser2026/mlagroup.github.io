import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BrandLoader,
  Button,
  EmptyState,
  FilterBar,
  Ledger,
  LedgerRow,
  MetricStrip,
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
import { canDraftPolicies, canUsePolicyDrafting } from '../lib/org'
import { isPolicyUniqueViolation, lookupPolicyTitleVersionConflict } from '../lib/policyVersionGuard'
import { POLICY_CATS } from '../lib/policyMarkdown'
import { sb } from '../lib/supabase'
import styles from './PoliciesPage.module.css'

type Policy = {
  id: string
  title?: string | null
  description?: string | null
  version?: string | null
  category?: string | null
  is_active?: boolean | null
  requires_acknowledgment?: boolean | null
  published_at?: string | null
}

type Template = {
  id: string
  title: string
  description?: string | null
  content_template?: string | null
  category?: string | null
  linked_control_number?: string | null
  display_order?: number | null
}

type Ack = {
  policy_id: string
  version_acknowledged?: string | null
}

export function PoliciesPage() {
  const { session, org, profile, role } = useAuth()
  const navigate = useNavigate()
  const orgId = org?.id || null
  const userId = session?.user?.id
  const showDraftCta = canUsePolicyDrafting(org) && canDraftPolicies(role)
  const [rows, setRows] = useState<Policy[]>([])
  const [acks, setAcks] = useState<Ack[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [toasts, setToasts] = useState<ToastItem[]>([])

  usePageChrome({ title: 'Policies', breadcrumbs: [{ label: 'Policies' }] })

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

  async function refresh() {
    if (!userId || !orgId) return
    const [{ data: policies }, { data: acknowledgments }, { data: tpls }] = await Promise.all([
      sb
        .from('policy_documents')
        .select('id,title,description,version,category,is_active,requires_acknowledgment,published_at')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('created_at', { ascending: true }),
      sb
        .from('policy_acknowledgments')
        .select('policy_id,version_acknowledged')
        .eq('org_id', orgId)
        .eq('user_id', userId),
      sb.from('policy_templates').select('*').eq('is_active', true).order('display_order'),
    ])
    setRows((policies as Policy[]) || [])
    setAcks((acknowledgments as Ack[]) || [])
    setTemplates((tpls as Template[]) || [])
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!userId || !orgId) {
        if (!cancelled) {
          setRows([])
          setLoading(false)
        }
        return
      }
      setLoading(true)
      await refresh()
      if (!cancelled) setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, orgId])

  // published_at is the sole publish signal — never treat a published row as Unpublished.
  const published = rows.filter((p) => Boolean(p.published_at))
  const drafts = rows.filter((p) => !p.published_at)
  const pending = published.filter((p) => {
    if (!p.requires_acknowledgment) return false
    return !acks.some((a) => a.policy_id === p.id && a.version_acknowledged === p.version)
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return published
    return published.filter((r) => `${r.title || ''} ${r.category || ''}`.toLowerCase().includes(q))
  }, [published, search])

  const filteredDrafts = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return drafts
    return drafts.filter((r) => `${r.title || ''} ${r.category || ''}`.toLowerCase().includes(q))
  }, [drafts, search])

  const adoptedTitles = useMemo(() => {
    const set = new Set<string>()
    for (const p of rows) {
      if (p.title) set.add(p.title)
    }
    return set
  }, [rows])

  const availableTemplates = templates.filter((t) => !adoptedTitles.has(t.title))

  async function adoptTemplate(templateId: string) {
    if (!orgId || !userId) return
    const tpl = templates.find((t) => t.id === templateId)
    if (!tpl) return
    setBusyId(templateId)
    setError('')
    pushToast('')
    const adoptVersion = '1.0'
    const collision = await lookupPolicyTitleVersionConflict({
      orgId,
      title: tpl.title,
      version: adoptVersion,
    })
    if (collision.conflict) {
      setBusyId('')
      setError(
        `Cannot adopt "${tpl.title}" v${adoptVersion}: an active ${collision.conflict.published ? 'published' : 'draft'} policy already uses that title and version. Rename or bump the existing policy first.`,
      )
      return
    }
    const orgName = org?.name || 'Our Organisation'
    const content = (tpl.content_template || '').replace(/\{\{org_name\}\}/g, orgName)
    const { data, error: insertErr } = await sb
      .from('policy_documents')
      .insert({
        org_id: orgId,
        title: tpl.title,
        description: tpl.description,
        content,
        version: adoptVersion,
        category: tpl.category,
        requires_acknowledgment: true,
        acknowledgment_frequency: 'on_update',
        linked_control_id: null,
        published_at: new Date().toISOString(),
        created_by: userId,
      })
      .select()
      .single()
    if (insertErr) {
      setBusyId('')
      setError(
        isPolicyUniqueViolation(insertErr)
          ? `Cannot adopt "${tpl.title}" v${adoptVersion}: that title and version is already in use.`
          : `Error adopting template: ${insertErr.message}`,
      )
      return
    }
    if (tpl.linked_control_number) {
      const { data: ctrl } = await sb
        .from('governance_controls')
        .select('id')
        .eq('control_number', tpl.linked_control_number)
        .maybeSingle()
      if (ctrl?.id && data?.id) {
        await sb.from('policy_documents').update({ linked_control_id: ctrl.id }).eq('id', data.id)
      }
    }
    await writeAuditLog({
      orgId,
      userId,
      action: 'policy_adopted',
      entityType: 'policy',
      entityId: data?.id || null,
      changes: {
        _actor_name: actorName(profile?.full_name, session?.user?.email),
        policy: tpl.title,
      },
    })
    await refresh()
    setBusyId('')
    pushToast(`Adopted "${tpl.title}".`)
  }

  if (loading) {
    return (
      <PageFrame>
        <PageHeader
          title="Governance Policies"
          description="Organisation policies requiring acknowledgment. Review, adopt templates, and track compliance."
        />
        <BrandLoader fill label="Loading policies" />
      </PageFrame>
    )
  }

  return (
    <PageFrame
      railItems={[
        { id: 'library', label: 'Library' },
        { id: 'templates', label: 'Templates' },
      ]}
    >
      <PageHeader
        title="Governance Policies"
        description="Organisation policies requiring acknowledgment. Review, adopt templates, and track compliance."
        actions={
          showDraftCta ? (
            <Button onClick={() => navigate('/policies/draft')}>Draft a policy</Button>
          ) : undefined
        }
      />

      {error ? <Notice tone="risk" title="Error">{error}</Notice> : null}

      <Section id="library">
        <div className={styles.libraryTop}>
          <MetricStrip
            items={[
              { id: 'total', label: 'Published', value: published.length },
              {
                id: 'acked',
                label: 'Acknowledged',
                value: Math.max(0, published.length - pending.length),
                tone: 'ok',
              },
              { id: 'pending', label: 'Pending', value: pending.length, tone: pending.length ? 'warn' : 'ok' },
              { id: 'drafts', label: 'Drafts', value: drafts.length },
            ]}
          />
          <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search policies" />
        </div>
        {filtered.length === 0 ? (
          <EmptyState
            title="No policies published yet"
            body="Adopt a template below, or draft a policy, then publish when ready."
            action={
              showDraftCta ? (
                <Button variant="ghost" onClick={() => navigate('/policies/draft')}>
                  Draft a policy
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Ledger flush>
            {filtered.map((p) => {
              const acked = acks.some((a) => a.policy_id === p.id && a.version_acknowledged === p.version)
              const needsAck = !!p.requires_acknowledgment && !acked
              const cat = POLICY_CATS[p.category || ''] || p.category
              const metaLine = [cat, p.version ? `v${p.version}` : null].filter(Boolean).join(' ')
              return (
                <LedgerRow
                  key={p.id}
                  title={p.title || 'Policy'}
                  description={metaLine || undefined}
                  meta={
                    <StatusLabel tone={acked ? 'ok' : needsAck ? 'warn' : 'neutral'}>
                      {acked ? 'Acknowledged' : needsAck ? 'Pending' : 'Published'}
                    </StatusLabel>
                  }
                  onClick={() => navigate(`/policies/${p.id}`)}
                />
              )
            })}
          </Ledger>
        )}
        {filteredDrafts.length > 0 ? (
          <>
            <h2 className={styles.sectionLabelSpaced}>Drafts</h2>
            <Ledger flush>
              {filteredDrafts.map((p) => {
                const cat = POLICY_CATS[p.category || ''] || p.category
                const metaLine = [cat, p.version ? `v${p.version}` : null].filter(Boolean).join(' ')
                return (
                  <LedgerRow
                    key={p.id}
                    title={p.title || 'Untitled policy'}
                    description={metaLine || undefined}
                    meta={<StatusLabel tone="warn">Unpublished</StatusLabel>}
                    onClick={() =>
                      navigate(
                        showDraftCta ? `/policies/draft/${p.id}` : `/policies/${p.id}`,
                      )
                    }
                  />
                )
              })}
            </Ledger>
          </>
        ) : null}
      </Section>

      <Section id="templates">
        <h2 className={styles.sectionLabelSpaced}>Templates</h2>
        {availableTemplates.length === 0 ? (
          <EmptyState title="No templates left" body="All available templates have been adopted." />
        ) : (
          <div className={styles.panel}>
            {availableTemplates.map((t) => (
              <div key={t.id} className={styles.tplRow}>
                <div>
                  <div className={styles.tplTitle}>{t.title}</div>
                  {t.description ? <div className={styles.tplDesc}>{t.description}</div> : null}
                </div>
                <Button size="sm" variant="ghost" pending={busyId === t.id} onClick={() => void adoptTemplate(t.id)}>
                  Adopt
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <ToastStack items={toasts} onDismiss={dismissToast} />
    </PageFrame>
  )
}
