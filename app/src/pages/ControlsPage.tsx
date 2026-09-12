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
import { controlCode, labelCtrlStatus, maturityLabel } from '../lib/registry'
import { pct } from '../lib/workspace'
import { sb } from '../lib/supabase'
import styles from './ControlsPage.module.css'

type Assignment = {
  id: string
  status?: string | null
  notes?: string | null
  due_date?: string | null
  control_id?: string | null
  system_id?: string | null
  governance_controls?: {
    title?: string | null
    control_number?: string | number | null
    control_type?: string | null
    pillar?: string | null
    description?: string | null
  } | null
  ai_systems?: { name?: string | null } | null
}

type ControlGroup = {
  key: string
  title: string
  items: Assignment[]
  /** First section for a rail entry (Organisation or asset). Click / scroll-spy target. */
  railId?: string
  railLabel?: string
}

type LayerKey = 'organisation' | 'system' | 'assurance'

const LAYER_ORDER: { key: LayerKey; label: string }[] = [
  { key: 'organisation', label: 'Organisation' },
  { key: 'system', label: 'System' },
  { key: 'assurance', label: 'Assurance' },
]

function toneFor(status?: string | null) {
  if (status === 'implemented' || status === 'verified') return 'ok' as const
  if (status === 'overdue') return 'risk' as const
  if (status === 'in_progress') return 'warn' as const
  return 'neutral' as const
}

function isDone(status?: string | null) {
  return status === 'implemented' || status === 'verified'
}

function urgency(status?: string | null) {
  if (status === 'overdue') return 0
  if (!status || status === 'not_started') return 1
  if (status === 'in_progress') return 2
  return 3
}

function sortAssignments(list: Assignment[]) {
  return [...list].sort((a, b) => {
    const u = urgency(a.status) - urgency(b.status)
    if (u !== 0) return u
    const an = a.governance_controls?.control_number
    const bn = b.governance_controls?.control_number
    const ac = an == null ? 9999 : Number(an)
    const bc = bn == null ? 9999 : Number(bn)
    if (ac !== bc) return ac - bc
    return (a.governance_controls?.title || '').localeCompare(b.governance_controls?.title || '')
  })
}

function isOrgLevel(r: Assignment) {
  const t = (r.governance_controls?.control_type || '').toLowerCase()
  return !r.system_id || t === 'organisation' || t === 'organization'
}

function isAssurance(r: Assignment) {
  return (r.governance_controls?.control_type || '').toLowerCase() === 'assurance'
}

function layerKey(r: Assignment): LayerKey {
  if (isAssurance(r)) return 'assurance'
  if (isOrgLevel(r)) return 'organisation'
  return 'system'
}

/** Portal-style buckets: Organisation, then each asset, then that asset's assurance. */
function groupByAsset(list: Assignment[]): ControlGroup[] {
  const org: Assignment[] = []
  const byAsset = new Map<string, { name: string; system: Assignment[]; assurance: Assignment[] }>()

  for (const r of list) {
    if (isOrgLevel(r) && !r.system_id) {
      org.push(r)
      continue
    }
    const id = r.system_id || 'unknown'
    const name = r.ai_systems?.name?.trim() || 'Unknown asset'
    let bucket = byAsset.get(id)
    if (!bucket) {
      bucket = { name, system: [], assurance: [] }
      byAsset.set(id, bucket)
    }
    if (isAssurance(r)) bucket.assurance.push(r)
    else if (isOrgLevel(r)) org.push(r)
    else bucket.system.push(r)
  }

  const groups: ControlGroup[] = []
  if (org.length) {
    groups.push({
      key: 'org',
      title: 'Organisation',
      items: sortAssignments(org),
      railId: 'controls-org',
      railLabel: 'Organisation',
    })
  }

  const assets = [...byAsset.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))
  for (const [id, bucket] of assets) {
    const railId = `controls-asset-${id}`
    let railPlaced = false
    if (bucket.system.length) {
      groups.push({
        key: `${id}-system`,
        title: bucket.name,
        items: sortAssignments(bucket.system),
        ...(railPlaced
          ? {}
          : { railId, railLabel: bucket.name }),
      })
      railPlaced = true
    }
    if (bucket.assurance.length) {
      groups.push({
        key: `${id}-assurance`,
        title: `${bucket.name} assurance`,
        items: sortAssignments(bucket.assurance),
        ...(railPlaced
          ? {}
          : { railId, railLabel: bucket.name }),
      })
    }
  }
  return groups
}

export function ControlsPage() {
  const { session, org } = useAuth()
  const navigate = useNavigate()
  const orgId = org?.id || null
  const [rows, setRows] = useState<Assignment[]>([])
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('all')
  const [loading, setLoading] = useState(true)

  usePageChrome({
    title: 'Controls',
    breadcrumbs: [{ label: 'Controls' }],
  })

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!session?.user || !orgId) {
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
          'id,status,notes,due_date,control_id,system_id,governance_controls(title,control_number,control_type,pillar,description),ai_systems(name)',
        )
        .eq('org_id', orgId)
        .order('updated_at', { ascending: false })
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
  }, [session, orgId])

  const open = rows.filter((r) => !isDone(r.status))
  const done = rows.filter((r) => isDone(r.status))
  const coverage = pct(done.length, rows.length)
  const view = tab === 'done' ? done : tab === 'open' ? open : rows

  const layers = useMemo(() => {
    const buckets: Record<LayerKey, { done: number; total: number }> = {
      organisation: { done: 0, total: 0 },
      system: { done: 0, total: 0 },
      assurance: { done: 0, total: 0 },
    }
    for (const r of rows) {
      const key = layerKey(r)
      buckets[key].total += 1
      if (isDone(r.status)) buckets[key].done += 1
    }
    return LAYER_ORDER.map(({ key, label }) => {
      const { done: d, total: t } = buckets[key]
      return {
        key,
        label,
        done: d,
        total: t,
        pct: pct(d, t),
      }
    }).filter((l) => l.total > 0)
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return view
    return view.filter((r) => {
      const title = r.governance_controls?.title || ''
      const code = controlCode(r.governance_controls?.control_number) || ''
      const sys = r.ai_systems?.name || ''
      const type = r.governance_controls?.control_type || ''
      return `${code} ${title} ${sys} ${type} ${r.status || ''}`.toLowerCase().includes(q)
    })
  }, [view, search])

  const groups = useMemo(() => groupByAsset(filtered), [filtered])
  const railItems = useMemo(
    () =>
      groups
        .filter((g): g is ControlGroup & { railId: string; railLabel: string } =>
          Boolean(g.railId && g.railLabel),
        )
        .map((g) => ({ id: g.railId, label: g.railLabel })),
    [groups],
  )

  if (loading) {
    return (
      <PageFrame>
        <PageHeader
          title="Governance Controls"
          description="Foundational controls assigned across your organisation, systems, and assurance layers."
        />
        <BrandLoader fill label="Loading controls" />
      </PageFrame>
    )
  }

  return (
    <PageFrame railItems={railItems}>
      <PageHeader
        title="Governance Controls"
        description="Foundational controls assigned across your organisation, systems, and assurance layers."
      />

      <Section id="controls">
        {rows.length === 0 ? (
          <p className={styles.postureEmpty}>
            Assignments appear when assets trigger controls or admins assign them.
          </p>
        ) : (
          <div className={styles.posture}>
            <div className={styles.postureHero}>
              <span className={styles.posturePct}>{coverage}%</span>
              <div className={styles.postureHeroCopy}>
                <p className={styles.postureTitle}>Control coverage</p>
                <p className={styles.postureLevel}>{maturityLabel(coverage)}</p>
              </div>
            </div>
            {layers.length > 0 ? (
              <div className={styles.layers} role="list" aria-label="Coverage by layer">
                {layers.map((l) => (
                  <div key={l.key} className={styles.layer} role="listitem">
                    <div className={styles.layerHead}>
                      <span className={styles.layerLabel}>{l.label}</span>
                      <span className={styles.layerPct}>{l.pct}%</span>
                    </div>
                    <div
                      className={styles.layerTrack}
                      role="progressbar"
                      aria-valuenow={l.pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${l.label} ${l.pct}%`}
                    >
                      <span className={styles.layerFill} style={{ width: `${l.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}

        <Tabs
          items={[
            { id: 'all', label: 'All', count: rows.length },
            { id: 'open', label: 'Open', count: open.length },
            { id: 'done', label: 'Complete', count: done.length },
          ]}
          value={tab}
          onChange={setTab}
        />
        <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search controls or assets" />

        {groups.length === 0 ? (
          <EmptyState
            title="No assignments"
            body="Assignments appear when assets trigger controls or admins assign them."
          />
        ) : (
          <div className={styles.stack}>
            {groups.map((g) => (
              <div key={g.key} id={g.railId} className={styles.group}>
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
                        meta={
                          <StatusLabel tone={toneFor(c.status)}>{labelCtrlStatus(c.status)}</StatusLabel>
                        }
                        onClick={() => navigate(`/controls/${c.id}`, { state: { from: 'controls' } })}
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
