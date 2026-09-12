import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BrandLoader, Button, Checklist, EmptyState, PageFrame, PageHeader, ProgressMeter, Section } from '../ui'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { loadWorkspace } from '../lib/workspace'
import { loadSetupSnapshot, type SetupSnapshot } from '../lib/setup'

export function SetupPage() {
  const { session } = useAuth()
  const [snap, setSnap] = useState<SetupSnapshot | null>(null)
  const [loading, setLoading] = useState(true)

  usePageChrome({
    title: 'Getting started',
    breadcrumbs: [{ label: 'Getting started' }],
  })

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!session?.user) return
      setLoading(true)
      const ws = await loadWorkspace(session.user.id)
      const setup = await loadSetupSnapshot(ws, session.access_token)
      if (cancelled) return
      setSnap(setup)
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [session])

  const pct = snap ? Math.round((snap.completed / snap.total) * 100) : 0

  if (loading) {
    return (
      <PageFrame>
        <PageHeader
          title="Getting started"
          description="Move an empty workspace from first asset registration through connection and governed operations."
        />
        <BrandLoader fill label="Loading setup" />
      </PageFrame>
    )
  }

  return (
    <PageFrame
      railItems={[
        { id: 'progress', label: 'Progress' },
        { id: 'checklist', label: 'Checklist' },
      ]}
    >
      <PageHeader
        title="Getting started"
        description="Move an empty workspace from first asset registration through connection and governed operations."
      />

      <Section id="progress" title="Progress" description="Completion is computed from live registry, connect, and governance state.">
        <ProgressMeter value={pct} label={`${snap?.completed} of ${snap?.total} steps`} />
      </Section>

      <Section id="checklist" title="Checklist" description="Each step deep-links into the surface that owns the work.">
        {snap && snap.completed === snap.total ? (
          <EmptyState
            title="You're set up"
            body="Keep Monitoring open for alerts and usage. Add frameworks as you expand into new obligations."
            action={
              <Link to="/">
                <Button>Back to home</Button>
              </Link>
            }
          />
        ) : (
          <Checklist
            items={(snap?.steps || []).map((s) => ({
              id: s.id,
              title: s.title,
              body: s.body,
              done: s.done,
              required: s.required,
              action: s.done ? undefined : (
                <Link to={s.to}>
                  <Button variant="ghost" size="sm">
                    Open
                  </Button>
                </Link>
              ),
            }))}
          />
        )}
      </Section>
    </PageFrame>
  )
}
