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
      const withCounts: CustomFramework[] = []
      for (const fw of frameworks) {
        const { data: ctrls } = await sb
          .from('org_framework_controls')
          .select('status')
          .eq('framework_id', fw.id)
        const list = ctrls || []
        const done = list.filter((c) => c.status === 'implemented' || c.status === 'verified').length
        withCounts.push({
          id: fw.id,
          name: fw.name,
          description: fw.description || '',
          controlCount: list.length,
          done,
        })
      }
      setCustom(withCounts)
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
          description="Built-in obligation packs, plus frameworks you write yourself."
        />
        <BrandLoader fill label="Loading frameworks" />
      </PageFrame>
    )
  }

  return (
    <PageFrame
      railItems={[
        { id: 'library', label: 'Library' },
        { id: 'custom', label: 'Custom' },
      ]}
    >
      <PageHeader
        title="Frameworks"
        description="Built-in obligation packs, plus frameworks you write yourself."
        actions={
          <Button onClick={() => setCreateOpen(true)} disabled={!orgId}>
            Create framework
          </Button>
        }
      />

      <Notice title="How frameworks work here">
        Built-in packs (EU AI Act, UK GDPR, FCA) score from live asset compliance. Custom frameworks stay in your
        organisation. Add controls and track status here.
      </Notice>

      <Section id="library" title="Framework library" description="Search and open a pack to review coverage.">
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
            <EmptyState title="No built-in packs" body="Obligation reference data is not loaded for this environment." />
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
            title="No custom frameworks yet"
            body="Create a framework for an internal standard, customer questionnaire, or board-approved control set."
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
                <p className={styles.cardBody}>{f.description || 'No description.'}</p>
                <div className={styles.cardMeta}>{f.controlCount} controls</div>
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

      <Section id="custom" title="Custom frameworks" description="For internal standards or customer questionnaires.">
        <p className={styles.hint}>
          Use a custom framework when a customer questionnaire or internal standard does not match EU AI Act, UK GDPR, or
          FCA packs.
        </p>
      </Section>

      <Drawer
        open={createOpen}
        title="Create framework"
        onClose={() => setCreateOpen(false)}
        actions={
          <Button onClick={() => void createFramework()} pending={busy}>
            Create
          </Button>
        }
      >
        <div className={styles.form}>
          {error ? <StatusLabel tone="risk">{error}</StatusLabel> : null}
          <label className={styles.field}>
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Customer AI questionnaire" />
          </label>
          <label className={styles.field}>
            <span>Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Who this framework is for and what good looks like."
              rows={4}
            />
          </label>
        </div>
      </Drawer>
    </PageFrame>
  )
}
