import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  BrandLoader,
  Button,
  Drawer,
  EmptyState,
  FilterBar,
  Notice,
  PageFrame,
  PageHeader,
  ProgressMeter,
  Section,
  StatusLabel,
  Tabs,
} from '../ui'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { loadWorkspace, pct } from '../lib/workspace'
import { sb } from '../lib/supabase'
import styles from './FrameworksPage.module.css'

type BuiltinFramework = {
  id: string
  name: string
  description: string
  obligationCount: number
  covered: number
  total: number
}

type CustomFramework = {
  id: string
  name: string
  description: string
  controlCount: number
  done: number
}

const BUILTIN_META: Record<string, { name: string; description: string }> = {
  eu_ai_act: {
    name: 'EU AI Act',
    description: 'Risk-tiered obligations for AI systems placed on the market or put into service in the Union.',
  },
  uk_gdpr: {
    name: 'UK GDPR',
    description: 'Data protection obligations that apply when AI systems process personal data.',
  },
  fca: {
    name: 'FCA expectations',
    description: 'Conduct and operational resilience expectations for AI in regulated financial services.',
  },
}

export function FrameworksPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState('library')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [builtin, setBuiltin] = useState<BuiltinFramework[]>([])
  const [custom, setCustom] = useState<CustomFramework[]>([])
  const [orgId, setOrgId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  usePageChrome({
    title: 'Frameworks',
    breadcrumbs: [{ label: 'Frameworks' }],
  })

  async function refresh(userId: string) {
    const ws = await loadWorkspace(userId)
    setOrgId(ws.orgId)

    const { data: obligations } = await sb
      .from('compliance_frameworks')
      .select('id,framework')
      .eq('is_active', true)

    const byFw = new Map<string, string[]>()
    for (const row of obligations || []) {
      const list = byFw.get(row.framework) || []
      list.push(row.id)
      byFw.set(row.framework, list)
    }

    let coveredMap = new Map<string, { covered: number; total: number }>()
    if (ws.orgId) {
      const { data: systems } = await sb
        .from('ai_systems')
        .select('id')
        .eq('org_id', ws.orgId)
        .is('deleted_at', null)
      const systemIds = (systems || []).map((s) => s.id)
      if (systemIds.length) {
        const { data: sc } = await sb
          .from('system_compliance')
          .select('obligation_id,status')
          .in('system_id', systemIds)
        const obToFw = new Map<string, string>()
        for (const [fw, ids] of byFw) ids.forEach((id) => obToFw.set(id, fw))
        const agg = new Map<string, { covered: number; total: number }>()
        for (const row of sc || []) {
          const fw = obToFw.get(row.obligation_id)
          if (!fw) continue
          const cur = agg.get(fw) || { covered: 0, total: 0 }
          cur.total += 1
          if (row.status === 'compliant' || row.status === 'complete' || row.status === 'met') cur.covered += 1
          agg.set(fw, cur)
        }
        coveredMap = agg
      }
    }

    setBuiltin(
      [...byFw.entries()].map(([id, ids]) => {
        const meta = BUILTIN_META[id] || { name: id.replace(/_/g, ' '), description: 'Regulatory obligation set.' }
        const cov = coveredMap.get(id) || { covered: 0, total: 0 }
        return {
          id,
          name: meta.name,
          description: meta.description,
          obligationCount: ids.length,
          covered: cov.covered,
          total: cov.total,
        }
      }),
    )

    if (ws.orgId) {
      const { data: fws } = await sb
        .from('org_frameworks')
        .select('id,name,description')
        .eq('org_id', ws.orgId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
      const frameworks = fws || []
      const { data: ctrls } = frameworks.length
        ? await sb
            .from('org_framework_controls')
            .select('framework_id,mapped_control_id')
            .in(
              'framework_id',
              frameworks.map((f) => f.id),
            )
        : { data: [] }
      const mapped = (ctrls || []).map((c) => c.mapped_control_id).filter(Boolean) as string[]
      const { data: asg } = mapped.length
        ? await sb.from('control_assignments').select('control_id,status').in('control_id', mapped)
        : { data: [] }
      const byControl = new Map<string, string[]>()
      for (const a of asg || []) byControl.set(a.control_id, [...(byControl.get(a.control_id) || []), a.status])
      setCustom(
        frameworks.map((fw) => {
          const list = (ctrls || []).filter((c) => c.framework_id === fw.id)
          const done = list.filter((c) => {
            const st = c.mapped_control_id ? byControl.get(c.mapped_control_id) || [] : []
            return st.length > 0 && st.every((s) => s === 'implemented' || s === 'verified')
          }).length
          return {
            id: fw.id,
            name: fw.name,
            description: fw.description || '',
            controlCount: list.length,
            done,
          }
        }),
      )
    } else {
      setCustom([])
    }
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!session?.user) return
      setLoading(true)
      await refresh(session.user.id)
      if (!cancelled) setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [session])

  const filteredBuiltin = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return builtin
    return builtin.filter((f) => `${f.name} ${f.description}`.toLowerCase().includes(q))
  }, [builtin, search])

  const filteredCustom = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return custom
    return custom.filter((f) => `${f.name} ${f.description}`.toLowerCase().includes(q))
  }, [custom, search])

  async function createFramework() {
    if (!session?.user || !orgId) return
    setBusy(true)
    setError('')
    const trimmed = name.trim()
    if (trimmed.length < 2) {
      setError('Name must be at least 2 characters.')
      setBusy(false)
      return
    }
    const { data, error: err } = await sb
      .from('org_frameworks')
      .insert({
        org_id: orgId,
        name: trimmed,
        description: description.trim(),
        created_by: session.user.id,
      })
      .select('id')
      .single()
    setBusy(false)
    if (err || !data) {
      setError(err?.message || 'Could not create framework.')
      return
    }
    setCreateOpen(false)
    setName('')
    setDescription('')
    navigate(`/frameworks/${data.id}`)
  }

  if (loading) {
    return (
      <PageFrame>
        <PageHeader
          title="Frameworks"
          description="Regulatory packs and your own control frameworks."
        />
        <BrandLoader fill label="Loading frameworks" />
      </PageFrame>
    )
  }

  return (
    <PageFrame>
      <PageHeader
        title="Frameworks"
        description="Regulatory packs and your own control frameworks."
        actions={
          <Button onClick={() => setCreateOpen(true)} disabled={!orgId}>
            Create framework
          </Button>
        }
      />

      <Section id="library" title="Framework library">
        <Tabs
          items={[
            { id: 'library', label: 'Built-in', count: builtin.length },
            { id: 'custom', label: 'Your frameworks', count: custom.length },
          ]}
          value={tab}
          onChange={setTab}
        />
        <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search frameworks" />

        {tab === 'library' ? (
          filteredBuiltin.length === 0 ? (
            <EmptyState title="No regulatory packs found" body="Try a different search." />
          ) : (
            <div className={styles.grid}>
              {filteredBuiltin.map((f) => (
                <Link key={f.id} to={`/frameworks/builtin/${f.id}`} className={styles.card}>
                  <div className={styles.cardTop}>
                    <div className={styles.cardTitle}>{f.name}</div>
                    <StatusLabel tone="info">Built-in</StatusLabel>
                  </div>
                  <p className={styles.cardBody}>{f.description}</p>
                  <div className={styles.cardMeta}>{f.obligationCount} obligations</div>
                  <ProgressMeter
                    size="sm"
                    value={pct(f.covered, f.total || f.obligationCount)}
                    label={f.total ? `${f.covered}/${f.total} tracked` : 'Awaiting assets'}
                  />
                </Link>
              ))}
            </div>
          )
        ) : filteredCustom.length === 0 ? (
          <EmptyState
            title="No frameworks yet"
            body="Build your own control set for an internal standard or client requirement."
            action={
              <Button onClick={() => setCreateOpen(true)} disabled={!orgId}>
                Create framework
              </Button>
            }
          />
        ) : (
          <div className={styles.grid}>
            {filteredCustom.map((f) => (
              <Link key={f.id} to={`/frameworks/${f.id}`} className={styles.card}>
                <div className={styles.cardTop}>
                  <div className={styles.cardTitle}>{f.name}</div>
                  <StatusLabel tone="ok">Custom</StatusLabel>
                </div>
                {f.description ? <p className={styles.cardBody}>{f.description}</p> : null}
                <div className={styles.cardMeta}>
                  {f.controlCount} {f.controlCount === 1 ? 'control' : 'controls'}
                </div>
                <ProgressMeter
                  size="sm"
                  value={pct(f.done, f.controlCount)}
                  label={`${f.done}/${f.controlCount} implemented`}
                />
              </Link>
            ))}
          </div>
        )}
      </Section>

      <Drawer
        open={createOpen}
        title="Create framework"
        onClose={() => setCreateOpen(false)}
        footer={
          <div className={styles.footer}>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void createFramework()} pending={busy}>
              Create framework
            </Button>
          </div>
        }
      >
        <div className={styles.form}>
          {error ? (
            <Notice tone="risk" title="Check this framework">
              {error}
            </Notice>
          ) : null}
          <label className={styles.field}>
            <span>Name</span>
            <input
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. ISO/IEC 42001"
            />
          </label>
          <label className={styles.field}>
            <span>Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              rows={3}
            />
          </label>
        </div>
      </Drawer>
    </PageFrame>
  )
}
