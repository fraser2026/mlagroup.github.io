import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BrandLoader, Notice, PageFrame, PageHeader, Section, StatusLabel } from '../ui'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { loadGatewaySettings, type GatewaySettings } from '../lib/gateway'
import { GatewayActivity } from './GatewayActivity'
import { GatewayBudgets } from './GatewayBudgets'
import { GatewayInventory } from './GatewayInventory'
import { GatewayPricing } from './GatewayPricing'
import { GatewayReconciliation } from './GatewayReconciliation'
import styles from './GatewayPage.module.css'

export function GatewayPage() {
  const { org, session, canDeleteRegistry } = useAuth()
  const [settings, setSettings] = useState<GatewaySettings | null>(null)
  const [ready, setReady] = useState(false)

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

  const description =
    'Requests from your AI agents through the RegAnchor gateway: spend, models and tools, data loss prevention and outcomes.'

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
          <dt>Policy enforcement</dt>
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

      {!routed ? (
        <Notice tone="warn">
          Requests are metered and priced, but data loss prevention policies only apply once routing through Cloudflare
          AI Gateway is enabled for this organisation.
        </Notice>
      ) : null}

      <Section id="budgets" title="Budgets">
        <GatewayBudgets orgId={org.id} canManage={canDeleteRegistry} accessToken={session?.access_token} />
      </Section>

      <Section id="pricing" title="Pricing">
        <GatewayPricing orgId={org.id} canManage={canDeleteRegistry} accessToken={session?.access_token} />
      </Section>

      <Section id="reconciliation" title="Reconciliation">
        <GatewayReconciliation orgId={org.id} canRun={canDeleteRegistry} accessToken={session?.access_token} />
      </Section>

      <Section id="inventory" title="Models and tools">
        <GatewayInventory orgId={org.id} />
      </Section>

      <Section id="activity" title="Activity">
        <GatewayActivity
          orgId={org.id}
          settings={settings}
          canViewContent={canDeleteRegistry}
          accessToken={session?.access_token}
        />
      </Section>

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
