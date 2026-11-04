import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BrandLoader, Notice, PageFrame, PageHeader, Section, StatusLabel, Tabs } from '../ui'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { loadGatewaySettings, type EventFilter, type GatewaySettings } from '../lib/gateway'
import { GatewayActivity } from './GatewayActivity'
import { GatewayBudgets } from './GatewayBudgets'
import { GatewayGuardrails } from './GatewayGuardrails'
import { GatewayInventory } from './GatewayInventory'
import { GatewayPricing } from './GatewayPricing'
import { GatewayReconciliation } from './GatewayReconciliation'
import styles from './GatewayPage.module.css'

const TABS = [
  { id: 'activity', label: 'Activity' },
  { id: 'guardrails', label: 'Guardrails' },
  { id: 'spend', label: 'Spend' },
  { id: 'models', label: 'Models and tools' },
]

function parseTab(value: string | null) {
  return TABS.some((t) => t.id === value) ? (value as string) : 'activity'
}

export function GatewayPage() {
  const { org, session, canDeleteRegistry } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [settings, setSettings] = useState<GatewaySettings | null>(null)
  const [ready, setReady] = useState(false)
  const [tab, setTab] = useState(() => parseTab(searchParams.get('tab')))
  const [filter, setFilter] = useState<EventFilter>('all')
  const [guardrail, setGuardrail] = useState<string | null>(null)

  usePageChrome({ title: 'Monitoring', breadcrumbs: [{ label: 'Monitoring' }] })

  useEffect(() => {
    if (!org?.id) return
    let cancelled = false
    void loadGatewaySettings(org.id).then((s) => {
      if (cancelled) return
      setSettings(s)
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [org?.id])

  function changeTab(next: string) {
    setTab(next)
    const params = new URLSearchParams(searchParams)
    if (next === 'activity') params.delete('tab')
    else params.set('tab', next)
    setSearchParams(params, { replace: true })
  }

  function openActivity(opts: { guardrail?: string | null; checks?: boolean }) {
    setFilter(opts.checks ? 'checks' : 'guardrails')
    setGuardrail(opts.checks ? null : opts.guardrail || null)
    changeTab('activity')
  }

  const description =
    'Requests from your AI agents through the RegAnchor gateway: activity, guardrails, spend, and the models and tools in use.'

  if (!org?.id || !ready) {
    return (
      <PageFrame>
        <PageHeader title="Monitoring" description={description} />
        <BrandLoader fill label="Loading monitoring" />
      </PageFrame>
    )
  }

  const routed = !!settings?.route_via_ai_gateway

  return (
    <PageFrame>
      <PageHeader title="Monitoring" description={description} />

      <dl className={styles.posture}>
        <div>
          <dt>Route</dt>
          <dd>
            <StatusLabel tone={routed ? 'ok' : 'warn'}>
              {routed ? 'Cloudflare AI Gateway' : 'Direct to provider'}
            </StatusLabel>
          </dd>
        </div>
        <div>
          <dt>If the gateway is unavailable</dt>
          <dd>{settings?.fail_mode === 'closed' ? 'Block requests' : 'Send direct, recorded'}</dd>
        </div>
        <div>
          <dt>Prompt capture</dt>
          <dd>
            {settings?.capture_content ? `On, kept ${settings.content_retention_days} days` : 'Off, metadata only'}
          </dd>
        </div>
        <div>
          <dt>Request records</dt>
          <dd>Kept {settings?.event_retention_days ?? 400} days</dd>
        </div>
      </dl>

      <Tabs items={TABS} value={tab} onChange={changeTab} className={styles.tabs} />

      {tab === 'activity' ? (
        <>
          {!routed ? (
            <Notice tone="warn">
              Requests are metered and priced. Cloudflare guardrails such as data loss prevention apply once one is
              switched on in Guardrails.
            </Notice>
          ) : null}
          <GatewayActivity
            orgId={org.id}
            settings={settings}
            canViewContent={canDeleteRegistry}
            accessToken={session?.access_token}
            filter={filter}
            guardrail={guardrail}
            onFilterChange={(next) => {
              setFilter(next)
              setGuardrail(null)
            }}
          />
        </>
      ) : null}

      {tab === 'guardrails' ? (
        <GatewayGuardrails
          orgId={org.id}
          accessToken={session?.access_token}
          settings={settings}
          onOpenActivity={openActivity}
          onOpenSpend={() => changeTab('spend')}
        />
      ) : null}

      {tab === 'spend' ? (
        <>
          <Section id="budgets" title="Budgets">
            <GatewayBudgets orgId={org.id} canManage={canDeleteRegistry} accessToken={session?.access_token} />
          </Section>
          <Section id="pricing" title="Pricing">
            <GatewayPricing orgId={org.id} canManage={canDeleteRegistry} accessToken={session?.access_token} />
          </Section>
          <Section id="reconciliation" title="Reconciliation">
            <GatewayReconciliation orgId={org.id} canRun={canDeleteRegistry} accessToken={session?.access_token} />
          </Section>
        </>
      ) : null}

      {tab === 'models' ? <GatewayInventory orgId={org.id} /> : null}

      <p className={styles.foot}>
        Tokens are issued per asset from the asset&apos;s Connection tab in the{' '}
        <Link to="/registry" className={styles.link}>
          registry
        </Link>
        .
      </p>
    </PageFrame>
  )
}
