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
  StatusLabel,
} from '../ui'
import { BrandIcon } from '../icons/BrandIcon'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { invokeEdge } from '../lib/edge'
import { MEMBER_ROLE_LABELS, PLAN_LABELS } from '../lib/stripe'
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
  if (status === 'none' || !status) return 'Not subscribed'
  return status
}

function subStatusTone(status?: string | null): 'ok' | 'info' | 'warn' | 'neutral' {
  if (status === 'active') return 'ok'
  if (status === 'trialing') return 'info'
  if (status === 'past_due' || status === 'unpaid') return 'warn'
  return 'neutral'
}

function roleTone(role?: string | null): 'ok' | 'info' | 'neutral' {
  if (role === 'owner' || role === 'admin') return 'ok'
  if (role === 'editor') return 'info'
  return 'neutral'
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
  const orgTitle = org?.name || 'Organisation'

  if (loading) {
    return (
      <PageFrame>
        <PageHeader
          title={orgTitle}
          description="Workspace identity, subscription, provider admin keys, and members."
        />
        <BrandLoader fill label="Loading organisation" />
      </PageFrame>
    )
  }

  return (
    <PageFrame
      railItems={[
        { id: 'workspace', label: 'Workspace' },
        { id: 'subscription', label: 'Subscription' },
        { id: 'providers', label: 'Providers' },
        { id: 'members', label: 'Members' },
      ]}
    >
      <PageHeader
        title={orgTitle}
        description="Workspace identity, subscription, provider admin keys, and members."
      />

      <section id="workspace" className={styles.block} aria-labelledby="org-workspace-title">
        <div className={styles.blockCopy}>
          <h2 id="org-workspace-title" className={styles.blockTitle}>
            Workspace
          </h2>
          <p className={styles.blockDesc}>
            Organisation details used across RegAnchor for this workspace.
          </p>
        </div>
        <div className={styles.blockBody}>
          <div className={styles.metaGrid}>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Organisation name</span>
              <span className={styles.metaValue}>{org?.name || 'Not set'}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Sector</span>
              <span className={styles.metaValue}>{org?.sector || 'Not set'}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Organisation size</span>
              <span className={styles.metaValue}>{org?.org_size || 'Not set'}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Organisation ID</span>
              <span className={styles.metaId}>{org?.id || 'Not set'}</span>
            </div>
          </div>
        </div>
      </section>

      <section id="subscription" className={styles.block} aria-labelledby="org-subscription-title">
        <div className={styles.blockCopy}>
          <h2 id="org-subscription-title" className={styles.blockTitle}>
            Subscription
          </h2>
          <p className={styles.blockDesc}>
            Plan and billing status for this workspace. Manage invoices and upgrades from Billing or
            Plans.
          </p>
        </div>
        <div className={styles.blockBody}>
          <div className={styles.metaGrid}>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Plan</span>
              <span className={styles.metaValue}>{planLabel}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Status</span>
              <span className={styles.statusPair}>
                <StatusLabel tone={subStatusTone(org?.subscription_status)}>
                  {subStatusLabel(org?.subscription_status)}
                </StatusLabel>
              </span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>AI assets registered</span>
              <span className={styles.metaValue}>{systemCount}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Members</span>
              <span className={styles.metaValue}>{members.length}</span>
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
        </div>
      </section>

      <section id="providers" className={styles.block} aria-labelledby="org-providers-title">
        <div className={styles.blockCopy}>
          <h2 id="org-providers-title" className={styles.blockTitle}>
            Provider admin keys
          </h2>
          <p className={styles.blockDesc}>
            Connect a Governance Admin key once per AI provider. Assets then attach only a runtime
            key on their Connection tab.
          </p>
        </div>
        <div className={`${styles.blockBody} ${styles.blockBodyWide}`}>
          {!anthropic ? (
            <EmptyState title="No provider Admin connectors available yet." />
          ) : (
            <div className={styles.panel}>
              <div className={styles.panelHead}>
                <div className={styles.panelTitleRow}>
                  <BrandIcon slug="anthropic" size={18} />
                  <span className={styles.panelTitle}>{anthropic.name}</span>
                </div>
                <StatusLabel tone={hasAdmin ? 'ok' : 'info'}>
                  {hasAdmin ? 'Connected' : 'Not connected'}
                </StatusLabel>
              </div>
              <p className={styles.panelDesc}>
                Unlocks usage monitoring, cost reporting, and workspace visibility for every{' '}
                {anthropic.name} asset in this organisation.{' '}
                <a href={PROVIDER_ADMIN_DOCS_URL} target="_blank" rel="noreferrer">
                  Admin API docs
                </a>
              </p>
              {hasAdmin ? (
                <p className={styles.panelMeta}>
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
                <Notice tone="risk" title="Provider error">
                  {anthropicCred.last_error}
                </Notice>
              ) : null}

              <hr className={styles.panelDivider} />

              {canDeleteRegistry ? (
                <div className={styles.panelForm}>
                  <label className={styles.field}>
                    <span className={styles.label}>Admin API key</span>
                    <input
                      type="text"
                      className={styles.input}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="sk-ant-admin…"
                      value={adminKey}
                      onChange={(e) => setAdminKey(e.target.value)}
                    />
                  </label>
                  <div className={styles.formActions}>
                    <Button
                      size="sm"
                      pending={providerBusy === 'connect'}
                      onClick={() => void connectProvider(anthropic.slug)}
                    >
                      {hasAdmin ? 'Replace Admin key' : 'Connect Admin key'}
                    </Button>
                    {hasAdmin ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          pending={providerBusy === 'test'}
                          onClick={() => void testProvider(anthropic.slug)}
                        >
                          Verify
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          pending={providerBusy === 'revoke'}
                          onClick={() => void revokeProvider(anthropic.slug, anthropic.name)}
                        >
                          Revoke
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : !hasAdmin ? (
                <div className={styles.panelForm}>
                  <Notice>
                    Only workspace admins and admins can manage provider Admin keys.
                  </Notice>
                </div>
              ) : (
                <div className={styles.panelForm}>
                  <p className={styles.panelMeta}>Admin key is connected for this organisation.</p>
                </div>
              )}
              {providerError ? (
                <Notice tone="risk" title="Could not update provider">
                  {providerError}
                </Notice>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <section id="members" className={styles.block} aria-labelledby="org-members-title">
        <div className={styles.blockCopy}>
          <h2 id="org-members-title" className={styles.blockTitle}>
            Members
          </h2>
          <p className={styles.blockDesc}>
            People with workspace access. Invite, change roles, and manage seats from Users.
          </p>
        </div>
        <div className={`${styles.blockBody} ${styles.blockBodyWide}`}>
          {members.length === 0 ? (
            <EmptyState title="No members found" />
          ) : (
            <Ledger>
              {members.map((m) => {
                const p = profiles[m.user_id] || {}
                const name = p.full_name || 'Unknown'
                const email = p.email || 'Email not set'
                const roleKey = m.role || 'viewer'
                const sc = sysByUser[m.user_id] || 0
                return (
                  <LedgerRow
                    key={m.id}
                    title={name}
                    description={email}
                    meta={
                      <div className={styles.memberMeta}>
                        <span className={styles.sysCount}>
                          {sc} asset{sc !== 1 ? 's' : ''}
                        </span>
                        <StatusLabel tone={roleTone(roleKey)}>
                          {MEMBER_ROLE_LABELS[roleKey] || roleKey}
                        </StatusLabel>
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
                <Button size="sm" variant="ghost">
                  Manage users
                </Button>
              </Link>
            </div>
          ) : null}
        </div>
      </section>
    </PageFrame>
  )
}
