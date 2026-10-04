import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BrandLoader,
  EmptyState,
  FilterBar,
  Ledger,
  LedgerRow,
  PageFrame,
  PageHeader,
  Section,
  StatusLabel,
  Tabs,
} from '../ui'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import {
  controlCode,
  dueUrgency,
  formatDueDateLabel,
  labelCtrlRenewalOrStatus,
  toneForCtrlRenewalOrStatus,
} from '../lib/registry'
import { sb } from '../lib/supabase'
import styles from './MyWorkPage.module.css'

type Assignment = {
  id: string
  status?: string | null
  due_date?: string | null
  priority?: string | null
  control_id?: string | null
  system_id?: string | null
  governance_controls?: {
    title?: string | null
    control_number?: string | number | null
    control_type?: string | null
  } | null
  ai_systems?: { name?: string | null } | null
}

type WorkBucket = 'overdue' | 'due' | 'no_date' | 'done'

type WorkGroup = {
  key: WorkBucket
  title: string
  items: Assignment[]
}

function isDone(status?: string | null) {
  return status === 'implemented' || status === 'verified'
}

function bucketFor(row: Assignment): WorkBucket {
  if (isDone(row.status)) return 'done'
  const urgency = dueUrgency(row.due_date, row.status)
  if (urgency === 'overdue') return 'overdue'
  if (row.due_date) return 'due'
  return 'no_date'
}

function sortWork(list: Assignment[]) {
  return [...list].sort((a, b) => {
    const ad = a.due_date || '9999-99-99'
    const bd = b.due_date || '9999-99-99'
    if (ad !== bd) return ad.localeCompare(bd)
    const an = a.governance_controls?.control_number
    const bn = b.governance_controls?.control_number
    const ac = an == null ? 9999 : Number(an)
    const bc = bn == null ? 9999 : Number(bn)
    if (ac !== bc) return ac - bc
    return (a.governance_controls?.title || '').localeCompare(b.governance_controls?.title || '')
  })
}

function groupWork(list: Assignment[]): WorkGroup[] {
  const buckets: Record<WorkBucket, Assignment[]> = {
    overdue: [],
    due: [],
    no_date: [],
    done: [],
  }
  for (const row of list) {
    buckets[bucketFor(row)].push(row)
  }
  const order: { key: WorkBucket; title: string }[] = [
    { key: 'overdue', title: 'Overdue' },
    { key: 'due', title: 'Due' },
    { key: 'no_date', title: 'No date' },
    { key: 'done', title: 'Complete' },
  ]
  return order
    .map(({ key, title }) => ({
      key,
      title,
      items: sortWork(buckets[key]),
    }))
    .filter((g) => g.items.length > 0)
}

function rowDescription(row: Assignment) {
  const parts: string[] = []
  const asset = row.ai_systems?.name?.trim()
  if (asset) parts.push(asset)
  const due = formatDueDateLabel(row.due_date)
  if (due) parts.push(due)
  else if (!isDone(row.status)) parts.push('No due date')
  return parts.join(' · ')
}

export function MyWorkPage() {
  const { session, org } = useAuth()
  const navigate = useNavigate()
  const orgId = org?.id || null
  const userId = session?.user?.id || null
  const [rows, setRows] = useState<Assignment[]>([])
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('open')
  const [loading, setLoading] = useState(true)

  usePageChrome({
    title: 'My work',
    breadcrumbs: [{ label: 'My work' }],
  })

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!session?.user || !orgId || !userId) {
        if (!cancelled) {
          setRows([])
          setLoading(false)
        }
        return
      }
      setLoading(true)
      const { data } = await sb
        .from('control_assignments')
        .select(
          'id,status,due_date,priority,control_id,system_id,governance_controls(title,control_number,control_type),ai_systems(name)',
        )
        .eq('org_id', orgId)
        .eq('assigned_to', userId)
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(250)
      if (!cancelled) {
        setRows((data as Assignment[]) || [])
        setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [session, orgId, userId])

  const open = rows.filter((r) => !isDone(r.status))
  const done = rows.filter((r) => isDone(r.status))
  const view = tab === 'done' ? done : tab === 'all' ? rows : open

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return view
    return view.filter((r) => {
      const title = r.governance_controls?.title || ''
      const code = controlCode(r.governance_controls?.control_number) || ''
      const sys = r.ai_systems?.name || ''
      return `${code} ${title} ${sys} ${r.status || ''} ${r.due_date || ''}`.toLowerCase().includes(q)
    })
  }, [view, search])

  const groups = useMemo(() => groupWork(filtered), [filtered])

  if (loading) {
    return (
      <PageFrame>
        <PageHeader
          title="My work"
          description="Controls assigned to you, with due dates and open items."
        />
        <BrandLoader fill label="Loading my work" />
      </PageFrame>
    )
  }

  return (
    <PageFrame>
      <PageHeader
        title="My work"
        description="Controls assigned to you, with due dates and open items."
      />

      <Section id="my-work">
        <Tabs
          items={[
            { id: 'open', label: 'Open', count: open.length },
            { id: 'all', label: 'All', count: rows.length },
            { id: 'done', label: 'Complete', count: done.length },
          ]}
          value={tab}
          onChange={setTab}
        />
        <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search assigned controls" />

        {groups.length === 0 ? (
          <EmptyState
            title="Nothing assigned to you"
            body="When someone assigns you a control, it shows up here."
          />
        ) : (
          <div className={styles.stack}>
            {groups.map((g) => (
              <div key={g.key} className={styles.group}>
                <div className={styles.groupHead}>
                  <h3 className={styles.groupTitle}>{g.title}</h3>
                  <span className={styles.groupCount}>
                    {g.items.length} control{g.items.length === 1 ? '' : 's'}
                  </span>
                </div>
                <Ledger flush>
                  {g.items.map((c) => {
                    const title = c.governance_controls?.title || 'Control'
                    const code = controlCode(c.governance_controls?.control_number)
                    return (
                      <LedgerRow
                        key={c.id}
                        title={code ? `${code} ${title}` : title}
                        description={rowDescription(c)}
                        meta={
                          <StatusLabel tone={toneForCtrlRenewalOrStatus(c.status, c.due_date)}>
                            {labelCtrlRenewalOrStatus(c.status, c.due_date)}
                          </StatusLabel>
                        }
                        onClick={() => navigate(`/controls/${c.id}`, { state: { from: 'my-work' } })}
                      />
                    )
                  })}
                </Ledger>
              </div>
            ))}
          </div>
        )}
      </Section>
    </PageFrame>
  )
}
