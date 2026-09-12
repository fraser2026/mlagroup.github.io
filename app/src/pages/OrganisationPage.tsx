import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BrandLoader,
  Button,
  EmptyState,
  Ledger,
  LedgerRow,
  Notice,
  PageFrame,
  PageHeader,
  Section,
  StatusLabel,
} from '../ui'
import { BrandIcon } from '../icons/BrandIcon'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { invokeEdge } from '../lib/edge'
import { PLAN_LABELS } from '../lib/stripe'
import { fmtDate } from '../lib/rpc'
import { sb } from '../lib/supabase'
import styles from './OrganisationPage.module.css'

const PROVIDER_ADMIN_DOCS_URL = 'https://platform.claude.com/docs/en/api/administration-api'

type Member = {
  id: string
  user_id: string
  role?: string | null
}

type Profile = {
  id: string
  full_name?: string | null
  email?: string | null
}

type AdminCred = {
  id: string
  provider_slug?: string | null
  status?: string | null
  admin_credential_secret_id?: string | null
  connected_at?: string | null
  last_verified_at?: string | null
  last_error?: string | null
}

type CatalogRow = {
  slug: string
  name: string
  connector_available?: boolean | null
}

function subStatusLabel(status?: string | null) {
  if (status === 'active') return 'Active'
  if (status === 'trialing') return 'Trial'
  if (status === 'none') return 'Not subscribed'
  return status || 'Not set'
}

export function OrganisationPage() {
  const { org, session, canDeleteRegistry, canManageMembers } = useAuth()
  const [members, setMembers] = useState<Member[]>([])
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})
  const [systemCount, setSystemCount] = useState(0)
  const [sysByUser, setSysByUser] = useState<Record<string, number>>({})
  const [creds, setCreds] = useState<AdminCred[]>([])
  const [catalog, setCatalog] = useState<CatalogRow[]>([])
  const [adminKey, setAdminKey] = useState('')
  const [providerBusy, setProviderBusy] = useState('')
  const [providerError, setProviderError] = useState('')
  const [loading, setLoading] = useState(true)

  usePageChrome({
    title: 'Organisation',
    breadcrumbs: [{ label: 'Organisation' }],
  })

  const load = useCallback(async () => {
    if (!org?.id) return
    setLoading(true)
    try {
      const [m, k, cat, sys] = await Promise.all([
        sb.from('org_members').select('id,user_id,role').eq('org_id', org.id).order('created_at', {
          ascending: true,
        }),
        sb
          .from('org_provider_credentials')
          .select(
            'id,provider_slug,status,admin_credential_secret_id,connected_at,last_verified_at,last_error',
          )
          .eq('org_id', org.id)
          .neq('status', 'revoked'),
        sb
          .from('provider_catalog')
          .select('slug,name,connector_available')
          .eq('is_active', true)
          .eq('slug', 'anthropic'),
        sb
          .from('ai_systems')
          .select('id,created_by')
          .eq('org_id', org.id)
          .is('deleted_at', null),
      ])
      const mems = (m.data as Member[]) || []
      const ids = mems.map((row) => row.user_id)
      const profMap: Record<string, Profile> = {}
      if (ids.length) {
        const { data: memberProfiles } = await sb
          .from('profiles')
          .select('id,full_name,email')
          .in('id', ids)
        ;(memberProfiles || []).forEach((p) => {
          profMap[p.id] = p as Profile
        })
      }
      const byUser: Record<string, number> = {}
      ;(sys.data || []).forEach((s: { created_by?: string }) => {
        if (s.created_by) byUser[s.created_by] = (byUser[s.created_by] || 0) + 1
      })
      setMembers(mems)
      setProfiles(profMap)
      setCreds((k.data as AdminCred[]) || [])
      setCatalog(((cat.data as CatalogRow[]) || []).filter((p) => p.connector_available))
      setSystemCount((sys.data || []).length)
      setSysByUser(byUser)
    } finally {
      setLoading(false)
    }
  }, [org?.id])

  useEffect(() => {
    void load()
  }, [load])

  async function connectProvider(slug: string) {
    if (!org?.id || !session?.access_token) return
    const key = adminKey.trim()
    if (!key) {
      setProviderError('Admin API key is required.')
      return
    }
    setProviderError('')
    setProviderBusy('connect')
    try {
      await invokeEdge(
        'org-provider-connect',
        { org_id: org.id, provider_slug: slug, api_key: key },
        session.access_token,
      )
      setAdminKey('')
      await load()
    } catch (e) {
      setProviderError(e instanceof Error ? e.message : 'Could not connect Admin key.')
    } finally {
      setProviderBusy('')
    }
  }

  async function testProvider(slug: string) {
    if (!org?.id || !session?.access_token) return
    setProviderError('')
    setProviderBusy('test')
    try {
      await invokeEdge(
        'org-provider-test',
        { org_id: org.id, provider_slug: slug },
        session.access_token,
      )
      await load()
    } catch (e) {
      setProviderError(e instanceof Error ? e.message : 'Verification failed.')
    } finally {
      setProviderBusy('')
    }
  }

  async function revokeProvider(slug: string, name: string) {
    if (!org?.id || !session?.access_token) return
    if (
      !window.confirm(
        `Revoke the organisation Governance Admin key for ${name}? Usage monitoring for all ${name} assets will pause until a new Admin key is connected.`,
      )
    ) {
      return
    }
    setProviderError('')
    setProviderBusy('revoke')
    try {
      await invokeEdge(
        'org-provider-revoke',
        { org_id: org.id, provider_slug: slug },
        session.access_token,
      )
      await load()
    } catch (e) {
      setProviderError(e instanceof Error ? e.message : 'Could not revoke.')
    } finally {
      setProviderBusy('')
    }
  }

  const planLabel = PLAN_LABELS[org?.plan || 'free'] || org?.plan || 'Free'
  const anthropic = catalog.find((p) => p.slug === 'anthropic')
  const anthropicCred = creds.find((c) => c.provider_slug === 'anthropic')
  const hasAdmin = !!(anthropicCred && anthropicCred.admin_credential_secret_id)

  if (loading) {
    return (
      <PageFrame>
        <PageHeader
          title={org?.name || 'Organisation'}
          description="Workspace identity, membership, subscription, and organisation-scoped provider admin credentials."
        />
        <BrandLoader fill label="Loading organisation" />
      </PageFrame>
    )
  }

  return (
    <PageFrame
      railItems={[
        { id: 'profile', label: 'Profile' },
        { id: 'subscription', label: 'Subscription' },
        { id: 'providers', label: 'Providers' },
        { id: 'members', label: 'Members' },
      ]}
    >
      <PageHeader
        title={org?.name || 'Organisation'}
        description="Workspace identity, membership, subscription, and organisation-scoped provider admin credentials."
      />

      <Section id="profile" title="Profile">
        <div className={styles.metaGrid}>
          <div className={styles.metaItem}>
            <label>Organisation name</label>
            <span>{org?.name || 'â€”'}</span>
          </div>
          <div className={styles.metaItem}>
            <label>Sector</label>
            <span>{org?.sector || 'Not set'}</span>
          </div>
          <div className={styles.metaItem}>
            <label>Organisation size</label>
            <span>{org?.org_size || 'Not set'}</span>
          </div>
          <div className={styles.metaItem}>
            <label>Organisation ID</label>
            <span className={styles.metaId}>{org?.id || 'â€”'}</span>
          </div>
        </div>
      </Section>

      <Section id="subscription" title="Subscription">
        <div className={styles.metaGrid}>
          <div className={styles.metaItem}>
            <label>Registry phase</label>
            <span>Phase 1</span>
          </div>
          <div className={styles.metaItem}>
            <label>Membership tier</label>
            <span>{planLabel}</span>
          </div>
          <div className={styles.metaItem}>
            <label>Subscription status</label>
            <span>{subStatusLabel(org?.subscription_status)}</span>
          </div>
          <div className={styles.metaItem}>
            <label>AI assets registered</label>
            <span>{systemCount}</span>
          </div>
        </div>
        <div className={styles.actions}>
          <Link to="/billing">
            <Button variant="ghost" size="sm">
              Billing
            </Button>
          </Link>
          <Link to="/plans">
            <Button variant="ghost" size="sm">
              Plans
            </Button>
          </Link>
        </div>
      </Section>

      <Section
        id="providers"
        title="Provider admin keys"
        description="Connect a Governance Admin key once per AI provider. AI assets then attach only a runtime key on their Connection tab."
      >
        {!anthropic ? (
          <EmptyState title="No provider Admin connectors available yet." />
        ) : (
          <div className={styles.providerSlot}>
            <div className={styles.providerHead}>
              <span className={styles.keyTitle}>
                <BrandIcon slug="anthropic" size={18} />
                {anthropic.name}
              </span>
              <StatusLabel tone={hasAdmin ? 'ok' : 'info'}>
                {hasAdmin ? 'Connected' : 'Recommended'}
              </StatusLabel>
            </div>
            <p className={styles.providerCopy}>
              Unlocks usage monitoring, cost reporting, and workspace visibility for every{' '}
              {anthropic.name} asset in this organisation.
            </p>
            <p className={styles.providerCopy}>
              <a href={PROVIDER_ADMIN_DOCS_URL} target="_blank" rel="noreferrer">
                Admin API docs
              </a>
            </p>
            {hasAdmin ? (
              <p className={styles.providerCopy}>
                {anthropicCred?.last_verified_at
                  ? `Last verified ${fmtDate(anthropicCred.last_verified_at)}. `
                  : ''}
                {anthropicCred?.connected_at
                  ? `Connected ${fmtDate(anthropicCred.connected_at)}. `
                  : ''}
                Stored key is never shown.
              </p>
            ) : null}
            {anthropicCred?.last_error ? (
              <Notice tone="risk">{anthropicCred.last_error}</Notice>
            ) : null}
            {canDeleteRegistry ? (
              <>
                <label className={styles.field}>
                  Admin API key (sk-ant-admin...)
                  <input
                    type="text"
                    className={styles.secret}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Paste governance admin key"
                    value={adminKey}
                    onChange={(e) => setAdminKey(e.target.value)}
                  />
                </label>
                <div className={styles.actions}>
                  <Button
                    pending={providerBusy === 'connect'}
                    onClick={() => void connectProvider(anthropic.slug)}
                  >
                    {hasAdmin ? 'Replace Admin key' : 'Connect Admin key'}
                  </Button>
                  {hasAdmin ? (
                    <>
                      <Button
                        variant="ghost"
                        pending={providerBusy === 'test'}
                        onClick={() => void testProvider(anthropic.slug)}
                      >
                        Verify
                      </Button>
                      <Button
                        variant="ghost"
                        pending={providerBusy === 'revoke'}
                        onClick={() => void revokeProvider(anthropic.slug, anthropic.name)}
                      >
                        Revoke
                      </Button>
                    </>
                  ) : null}
                </div>
              </>
            ) : !hasAdmin ? (
              <Notice>Only organisation owners and admins can manage provider Admin keys.</Notice>
            ) : null}
            {providerError ? <Notice tone="risk">{providerError}</Notice> : null}
          </div>
        )}
      </Section>

      <Section
        id="members"
        title="Members"
        description={`${members.length} member${members.length !== 1 ? 's' : ''}`}
      >
        {members.length === 0 ? (
          <EmptyState title="No members found" />
        ) : (
          <Ledger>
            {members.map((m) => {
              const p = profiles[m.user_id] || {}
              const name = p.full_name || 'Unknown'
              const email = p.email || 'Not set'
              const sc = sysByUser[m.user_id] || 0
              return (
                <LedgerRow
                  key={m.id}
                  title={name}
                  description={email}
                  meta={
                    <div className={styles.memberMeta}>
                      <span className={styles.sysCount}>
                        {sc} system{sc !== 1 ? 's' : ''}
                      </span>
                      <StatusLabel tone="info">{m.role || 'viewer'}</StatusLabel>
                    </div>
                  }
                />
              )
            })}
          </Ledger>
        )}
        {canManageMembers ? (
          <div className={styles.actions}>
            <Link to="/users">
              <Button>Manage access</Button>
            </Link>
          </div>
        ) : null}
      </Section>
    </PageFrame>
  )
}
