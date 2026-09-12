import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  BrandLoader,
  Button,
  Drawer,
  EmptyState,
  FilterBar,
  Ledger,
  LedgerRow,
  PageFrame,
  PageHeader,
  ProgressMeter,
  Section,
  StatusLabel,
} from '../ui'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { loadWorkspace, pct } from '../lib/workspace'
import { sb } from '../lib/supabase'
import styles from './FrameworkDetailPage.module.css'

type ControlRow = {
  id: string
  title: string
  description: string
  category: string
  status: string
}

function tone(status: string) {
  if (status === 'implemented' || status === 'verified') return 'ok' as const
  if (status === 'in_progress') return 'warn' as const
  if (status === 'not_applicable') return 'neutral' as const
  return 'neutral' as const
}

export function FrameworkDetailPage() {
  const { id } = useParams()
  const { session } = useAuth()
  const [name, setName] = useState('Framework')
  const [description, setDescription] = useState('')
  const [rows, setRows] = useState<ControlRow[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState('general')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<ControlRow | null>(null)

  usePageChrome({
    title: name,
    breadcrumbs: [
      { label: 'Frameworks', to: '/frameworks' },
      { label: name },
    ],
  })

  async function refresh() {
    if (!id || !session?.user) return
    const ws = await loadWorkspace(session.user.id)
    setOrgId(ws.orgId)
    const { data: fw } = await sb.from('org_frameworks').select('name,description').eq('id', id).maybeSingle()
    if (fw) {
      setName(fw.name)
      setDescription(fw.description || '')
    }
    const { data } = await sb
      .from('org_framework_controls')
      .select('id,title,description,category,status')
      .eq('framework_id', id)
      .order('display_order')
    setRows((data as ControlRow[]) || [])
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      await refresh()
      if (!cancelled) setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [id, session])

  const filtered = rows.filter((r) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return `${r.title} ${r.description} ${r.category}`.toLowerCase().includes(q)
  })
  const done = rows.filter((r) => r.status === 'implemented' || r.status === 'verified').length

  async function addControl() {
    if (!id || !orgId) return
    setBusy(true)
    const trimmed = title.trim()
    if (trimmed.length < 2) {
      setBusy(false)
      return
    }
    await sb.from('org_framework_controls').insert({
      framework_id: id,
      org_id: orgId,
      title: trimmed,
      description: body.trim(),
      category: category.trim() || 'general',
      display_order: rows.length,
    })
    setBusy(false)
    setAddOpen(false)
    setTitle('')
    setBody('')
    setCategory('general')
    await refresh()
  }

  async function setStatus(controlId: string, status: string) {
    await sb.from('org_framework_controls').update({ status, updated_at: new Date().toISOString() }).eq('id', controlId)
    setSelected(null)
    await refresh()
  }

  if (loading) {
    return (
      <PageFrame>
        <PageHeader
          title={name}
          description={description || 'Custom control set for your organisation.'}
        />
        <BrandLoader fill label="Loading framework" />
      </PageFrame>
    )
  }

  return (
    <PageFrame
      railItems={[
        { id: 'overview', label: 'Overview' },
        { id: 'controls', label: 'Controls' },
      ]}
    >
      <PageHeader
        title={name}
        description={description || 'Custom control set for your organisation.'}
        actions={
          <Button onClick={() => setAddOpen(true)} disabled={!orgId}>
            Add control
          </Button>
        }
      />

      <Section id="overview" title="Overview">
        <ProgressMeter value={pct(done, rows.length)} label={`${done} of ${rows.length} implemented`} />
      </Section>

      <Section id="controls" title="Controls" description="Track status here. Evidence write-back to assignments is an open seam.">
        <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search controls" />
        {filtered.length === 0 ? (
          <EmptyState
            title="No controls yet"
            body="Add the questions and controls your auditors or customers expect."
            action={
              <Button onClick={() => setAddOpen(true)} disabled={!orgId}>
                Add control
              </Button>
            }
          />
        ) : (
          <Ledger>
            {filtered.map((c) => (
              <LedgerRow
                key={c.id}
                title={c.title}
                description={c.description || c.category}
                meta={<StatusLabel tone={tone(c.status)}>{c.status.replace(/_/g, ' ')}</StatusLabel>}
                onClick={() => setSelected(c)}
              />
            ))}
          </Ledger>
        )}
      </Section>

      <Drawer
        open={addOpen}
        title="Add control"
        onClose={() => setAddOpen(false)}
        actions={
          <Button onClick={() => void addControl()} pending={busy}>
            Add
          </Button>
        }
      >
        <div className={styles.form}>
          <label className={styles.field}>
            <span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Control title" />
          </label>
          <label className={styles.field}>
            <span>Category</span>
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. governance" />
          </label>
          <label className={styles.field}>
            <span>Description</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
          </label>
        </div>
      </Drawer>

      <Drawer open={!!selected} title={selected?.title || 'Control'} onClose={() => setSelected(null)}>
        {selected ? (
          <div className={styles.form}>
            <p className={styles.copy}>{selected.description || 'No description.'}</p>
            <div className={styles.statusRow}>
              {['not_started', 'in_progress', 'implemented', 'verified', 'not_applicable'].map((s) => (
                <Button key={s} variant="ghost" size="sm" selected={selected.status === s} onClick={() => void setStatus(selected.id, s)}>
                  {s.replace(/_/g, ' ')}
                </Button>
              ))}
            </div>
            <Link to="/controls" className={styles.link}>
              Open RegAnchor controls →
            </Link>
          </div>
        ) : null}
      </Drawer>
    </PageFrame>
  )
}
