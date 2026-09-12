import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  BrandLoader,
  EmptyState,
  FilterBar,
  Ledger,
  LedgerRow,
  Notice,
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

const NAMES: Record<string, string> = {
  eu_ai_act: 'EU AI Act',
  uk_gdpr: 'UK GDPR',
  fca: 'FCA expectations',
}

type Obligation = {
  id: string
  obligation_title: string
  obligation_description?: string | null
  article_reference?: string | null
  status?: string
}

export function BuiltinFrameworkPage() {
  const { slug } = useParams()
  const { session } = useAuth()
  const [rows, setRows] = useState<Obligation[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const title = NAMES[slug || ''] || (slug || 'Framework').replace(/_/g, ' ')

  usePageChrome({
    title,
    breadcrumbs: [
      { label: 'Frameworks', to: '/frameworks' },
      { label: title },
    ],
  })

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!session?.user || !slug) return
      setLoading(true)
      const ws = await loadWorkspace(session.user.id)
      const { data: obligations } = await sb
        .from('compliance_frameworks')
        .select('id,obligation_title,obligation_description,article_reference,display_order')
        .eq('framework', slug)
        .eq('is_active', true)
        .order('display_order')

      const base = (obligations || []) as Obligation[]
      const statusByOb = new Map<string, string>()

      if (ws.orgId) {
        const { data: systems } = await sb
          .from('ai_systems')
          .select('id')
          .eq('org_id', ws.orgId)
          .is('deleted_at', null)
        const ids = (systems || []).map((s) => s.id)
        if (ids.length && base.length) {
          const { data: sc } = await sb
            .from('system_compliance')
            .select('obligation_id,status')
            .in('system_id', ids)
            .in(
              'obligation_id',
              base.map((b) => b.id),
            )
          for (const row of sc || []) {
            const prev = statusByOb.get(row.obligation_id)
            if (!prev || row.status === 'compliant' || row.status === 'met') statusByOb.set(row.obligation_id, row.status)
            else if (!statusByOb.has(row.obligation_id)) statusByOb.set(row.obligation_id, row.status)
          }
        }
      }

      if (!cancelled) {
        setRows(
          base.map((o) => ({
            ...o,
            status: statusByOb.get(o.id) || 'not_started',
          })),
        )
        setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [session, slug])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => `${r.obligation_title} ${r.article_reference || ''}`.toLowerCase().includes(q))
  }, [rows, search])

  const covered = rows.filter((r) => r.status === 'compliant' || r.status === 'met' || r.status === 'complete').length

  if (loading) {
    return (
      <PageFrame>
        <PageHeader
          title={title}
          description="Live coverage from registry assets. Evidence updates still run through assessments and controls."
        />
        <BrandLoader fill label="Loading framework" />
      </PageFrame>
    )
  }

  return (
    <PageFrame
      railItems={[
        { id: 'coverage', label: 'Coverage' },
        { id: 'obligations', label: 'Obligations' },
      ]}
    >
      <PageHeader
        title={title}
        description="Live coverage from registry assets. Evidence updates still run through assessments and controls."
      />

      <Section id="coverage" title="Coverage">
        <ProgressMeter value={pct(covered, rows.length)} label={`${covered} of ${rows.length} obligations met`} />
        <Notice title="Open seam">
          Changing obligation status from this page is deferred. Use <Link to="/registry">Registry</Link> assessments and{' '}
          <Link to="/controls">Controls</Link> to move evidence forward.
        </Notice>
      </Section>

      <Section id="obligations" title="Obligations">
        <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search obligations" />
        {filtered.length === 0 ? (
          <EmptyState title="No obligations" body="This framework has no active obligation rows." />
        ) : (
          <Ledger>
            {filtered.map((o) => (
              <LedgerRow
                key={o.id}
                title={o.obligation_title}
                description={o.article_reference || o.obligation_description || undefined}
                meta={
                  <StatusLabel
                    tone={
                      o.status === 'compliant' || o.status === 'met' || o.status === 'complete'
                        ? 'ok'
                        : o.status === 'in_progress'
                          ? 'warn'
                          : 'neutral'
                    }
                  >
                    {(o.status || 'not_started').replace(/_/g, ' ')}
                  </StatusLabel>
                }
              />
            ))}
          </Ledger>
        )}
      </Section>
    </PageFrame>
  )
}
