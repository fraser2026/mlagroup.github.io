import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  BrandLoader,
  Button,
  ConnectorRow,
  EmptyState,
  FilterBar,
  Notice,
  PageFrame,
  PageHeader,
  Section,
  StatusLabel,
  ToastStack,
} from '../ui'
import type { ToastItem } from '../ui'
import { BrandIcon } from '../icons/BrandIcon'
import { usePageChrome } from '../ui/shellChrome'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../lib/config'
import { useAuth } from '../auth/AuthProvider'
import { loadWorkspace } from '../lib/workspace'
import { labelProvider } from '../lib/registry'
import { sb } from '../lib/supabase'
import styles from './IntegrationsPage.module.css'

type SessionRow = {
  id: string
  label?: string | null
  client_name?: string | null
  revoked_at?: string | null
  created_at?: string
}

type CatalogRow = {
  slug: string
  name: string
  connector_available?: boolean | null
  docs_url?: string | null
}

type ConnRow = {
  id: string
  provider_slug?: string | null
  status?: string | null
  asset_id?: string | null
}

const CODE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/

/** Normalize typed/pasted device codes toward ABCD-EFGH. */
function formatDeviceCode(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8)
  if (cleaned.length <= 4) return cleaned
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`
}

function codeFromSearch(params: URLSearchParams): string {
  return formatDeviceCode(params.get('code') || params.get('mcp_code') || '')
}

/**
 * Org Connect: hosts (MCP clients) → model providers → gateway pointer.
 * Not infrastructure (Azure/AWS/GCP), not future data sources.
 */
export function IntegrationsPage() {
  const { session, org } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [hostSearch, setHostSearch] = useState('')
  const [providerSearch, setProviderSearch] = useState('')
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [catalog, setCatalog] = useState<CatalogRow[]>([])
  const [connections, setConnections] = useState<ConnRow[]>([])
  const [snippet, setSnippet] = useState('')
  const [error, setError] = useState('')
  const [deviceCode, setDeviceCode] = useState(() => codeFromSearch(searchParams))
  const [deviceError, setDeviceError] = useState('')
  const [deviceOk, setDeviceOk] = useState(false)
  const [deviceBusy, setDeviceBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [toasts, setToasts] = useState<ToastItem[]>([])

  usePageChrome({ title: 'Connect', breadcrumbs: [{ label: 'Connect' }] })

  function pushToast(text: string) {
    if (!text.trim()) return
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `t-${Date.now()}-${Math.random().toString(16).slice(2)}`
    setToasts((prev) => [...prev, { id, text }])
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  async function mcpAuth(body: Record<string, unknown>) {
    if (!session) throw new Error('Sign in required.')
    const res = await fetch(`${SUPABASE_URL}/functions/v1/mcp-auth`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || data.error_description || 'Request failed.')
    return data
  }

  async function refreshSessions() {
    const data = await mcpAuth({ action: 'sessions_list' })
    setSessions(Array.isArray(data.sessions) ? data.sessions : [])
  }

  useEffect(() => {
    const fromUrl = codeFromSearch(searchParams)
    if (fromUrl) setDeviceCode(fromUrl)
  }, [searchParams])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!session?.user) return
      setLoading(true)
      setError('')
      try {
        const ws = await loadWorkspace(session.user.id)
        const [{ data: cat }, connRes] = await Promise.all([
          sb.from('provider_catalog').select('slug,name,connector_available,docs_url').eq('is_active', true).order('display_order'),
          ws.orgId
            ? sb
                .from('provider_connections')
                .select('id,provider_slug,status,asset_id')
                .eq('org_id', ws.orgId)
                .neq('status', 'revoked')
            : Promise.resolve({ data: [] as ConnRow[] }),
        ])
        if (cancelled) return
        setCatalog(
          ((cat as CatalogRow[]) || []).map((p) => ({
            ...p,
            name: labelProvider(p.slug, p.name),
          })),
        )
        setConnections((connRes.data as ConnRow[]) || [])
        await refreshSessions()
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load Connect.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [session])

  async function connectCursor() {
    setBusy(true)
    setError('')
    try {
      const data = await mcpAuth({
        action: 'portal_issue',
        client: 'cursor',
        label: 'App connect (Cursor)',
      })
      const access = data.access_token as string
      const cfg = {
        mcpServers: {
          reganchor: {
            url: `${SUPABASE_URL}/functions/v1/mcp`,
            headers: {
              Authorization: `Bearer ${access}`,
              apikey: SUPABASE_ANON_KEY,
            },
          },
          'reganchor-oauth': {
            url: 'https://mcp.reganchor.com/mcp',
            auth: { CLIENT_ID: 'ra_mcp_cid_cursor', scopes: ['mcp:tools'] },
          },
        },
      }
      setSnippet(JSON.stringify(cfg, null, 2))
      await refreshSessions()
      pushToast('Cursor token issued. Copy the snippet once.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connect failed.')
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    setError('')
    try {
      await mcpAuth({ action: 'revoke_session', session_id: id })
      await refreshSessions()
      pushToast('MCP session revoked.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Revoke failed.')
    }
  }

  async function approveDevice() {
    const userCode = formatDeviceCode(deviceCode)
    setDeviceCode(userCode)
    setDeviceError('')
    setDeviceOk(false)
    if (!CODE_RE.test(userCode)) {
      setDeviceError('Enter the code in the form ABCD-EFGH.')
      return
    }
    setDeviceBusy(true)
    try {
      await mcpAuth({
        action: 'device_approve',
        user_code: userCode,
        org_id: org?.id || undefined,
      })
      setDeviceOk(true)
      setDeviceCode('')
      if (searchParams.has('code') || searchParams.has('mcp_code')) {
        const next = new URLSearchParams(searchParams)
        next.delete('code')
        next.delete('mcp_code')
        setSearchParams(next, { replace: true })
      }
      await refreshSessions()
      pushToast('Device login approved.')
    } catch (e) {
      setDeviceError(e instanceof Error ? e.message : 'Could not approve device login.')
    } finally {
      setDeviceBusy(false)
    }
  }

  const active = sessions.filter((s) => !s.revoked_at)
  const hq = hostSearch.trim().toLowerCase()
  const pq = providerSearch.trim().toLowerCase()

  const filteredSessions = useMemo(() => {
    if (!hq) return active
    return active.filter((s) => `${s.label || ''} ${s.client_name || ''}`.toLowerCase().includes(hq))
  }, [active, hq])

  const filteredCatalog = useMemo(() => {
    if (!pq) return catalog
    return catalog.filter((c) => `${labelProvider(c.slug, c.name)} ${c.slug}`.toLowerCase().includes(pq))
  }, [catalog, pq])

  const filteredConnections = useMemo(() => {
    if (!pq) return connections
    return connections.filter((c) =>
      `${labelProvider(c.provider_slug)} ${c.status || ''}`.toLowerCase().includes(pq),
    )
  }, [connections, pq])

  if (loading) {
    return (
      <PageFrame>
        <PageHeader
          title="Connect"
          description="Hosts, model providers, and where gateway traffic is managed."
        />
        <BrandLoader fill label="Loading connect" />
      </PageFrame>
    )
  }

  return (
    <PageFrame
      railItems={[
        { id: 'hosts', label: 'Hosts' },
        { id: 'providers', label: 'Providers' },
        { id: 'gateway', label: 'Gateway' },
      ]}
    >
      <PageHeader
        title="Connect"
        description="Hosts, model providers, and where gateway traffic is managed."
        actions={
          <Button size="sm" onClick={() => void connectCursor()} pending={busy}>
            Connect Cursor
          </Button>
        }
      />

      {error ? (
        <Notice tone="risk" title="Connect error">
          {error}
        </Notice>
      ) : null}

      <Section
        id="hosts"
        title="Hosts"
        description="MCP clients such as Cursor. Approving a host grants governance tools under your permissions. It is not a model provider and does not mint a gateway token."
      >
        <div className={styles.deviceCard}>
          <label className={styles.field}>
            Device code
            <input
              className={styles.deviceInput}
              value={deviceCode}
              onChange={(e) => {
                setDeviceOk(false)
                setDeviceError('')
                setDeviceCode(formatDeviceCode(e.target.value))
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void approveDevice()
                }
              }}
              maxLength={9}
              placeholder="ABCD-EFGH"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={deviceError ? true : undefined}
            />
          </label>
          <p className={styles.deviceHint}>
            From your MCP client, Cursor Authenticate, or <code>node mcp/login.mjs</code>. Prefer OAuth via{' '}
            <code>mcp.reganchor.com</code> when available.
          </p>
          <div className={styles.deviceActions}>
            <Button size="sm" onClick={() => void approveDevice()} pending={deviceBusy}>
              Approve
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void connectCursor()} pending={busy}>
              Connect Cursor
            </Button>
          </div>
          {deviceError ? (
            <Notice tone="risk" title="Could not approve">
              {deviceError}
            </Notice>
          ) : null}
          {deviceOk ? (
            <Notice title="Approved">
              Return to the terminal or MCP client. It will finish login automatically.
            </Notice>
          ) : null}
        </div>

        <div className={styles.hostsTools}>
          <FilterBar
            search={hostSearch}
            onSearchChange={setHostSearch}
            searchPlaceholder="Search hosts"
          />
        </div>

        <div className={styles.list}>
          {filteredSessions.length === 0 ? (
            <EmptyState
              title="No active MCP sessions"
              body="Approve a device code, Connect Cursor for a one-time token, or Authenticate against mcp.reganchor.com."
              action={
                <Button size="sm" onClick={() => void connectCursor()} pending={busy}>
                  Connect Cursor
                </Button>
              }
            />
          ) : (
            filteredSessions.map((s) => (
              <ConnectorRow
                key={s.id}
                icon={<BrandIcon slug="cursor" />}
                name={s.label || s.client_name || 'MCP session'}
                status="Connected"
                statusTone="ok"
                tags={['MCP', 'Host']}
                actions={
                  <Button variant="ghost" size="sm" onClick={() => void revoke(s.id)}>
                    Revoke
                  </Button>
                }
              />
            ))
          )}
        </div>

        {snippet ? (
          <div className={styles.snippet}>
            <div className={styles.snippetLabel}>Cursor mcp.json snippet (access token shown once)</div>
            <pre>{snippet}</pre>
          </div>
        ) : null}
      </Section>

      <Section
        id="providers"
        title="Providers"
        description="Model providers (also AI providers): Anthropic, OpenAI, Google, AWS Bedrock, Microsoft Foundry, and peers. Attach runtime keys on each asset Connection tab. Org Admin keys live under Organisation."
      >
        <FilterBar
          search={providerSearch}
          onSearchChange={setProviderSearch}
          searchPlaceholder="Search providers"
        />

        {filteredConnections.length > 0 ? (
          <div className={styles.linkedBlock}>
            <div className={styles.blockLabel}>Linked connections</div>
            <div className={styles.list}>
              {filteredConnections.map((c) => (
                <ConnectorRow
                  key={c.id}
                  icon={<BrandIcon slug={c.provider_slug || 'generic'} />}
                  name={labelProvider(c.provider_slug, 'Provider')}
                  status={c.status || 'unknown'}
                  statusTone={c.status === 'connected' ? 'ok' : c.status === 'error' ? 'risk' : 'neutral'}
                  tags={['Runtime']}
                  actions={
                    c.asset_id ? (
                      <Link to={`/registry/${c.asset_id}?tab=connection`}>
                        <Button variant="ghost" size="sm">
                          Connection
                        </Button>
                      </Link>
                    ) : (
                      <Link to="/organisation">
                        <Button variant="ghost" size="sm">
                          Organisation
                        </Button>
                      </Link>
                    )
                  }
                />
              ))}
            </div>
          </div>
        ) : null}

        {filteredCatalog.length === 0 ? (
          <EmptyState title="No providers" body="Provider catalog is empty for this environment." />
        ) : (
          <div className={styles.market}>
            {filteredCatalog.map((c) => (
              <div key={c.slug} className={styles.marketCard}>
                <div className={styles.marketTop}>
                  <BrandIcon slug={c.slug} size={28} title={labelProvider(c.slug, c.name)} />
                  <StatusLabel tone={c.connector_available ? 'ok' : 'neutral'}>
                    {c.connector_available ? 'Ready' : 'Catalog'}
                  </StatusLabel>
                </div>
                <div className={styles.marketName}>{labelProvider(c.slug, c.name)}</div>
                {c.docs_url ? (
                  <a className={styles.marketMeta} href={c.docs_url} target="_blank" rel="noreferrer">
                    Docs
                  </a>
                ) : (
                  <div className={styles.marketMeta}>Model provider</div>
                )}
                <Link to="/registry" className={styles.marketAction}>
                  <Button variant="ghost" size="sm">
                    Attach via registry
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        id="gateway"
        title="Gateway"
        description="Gateway tokens (ra_gw_…) move model traffic for one registry asset. Mint and revoke them on that asset’s Connection tab, not here."
      >
        <Notice title="Per-asset surface">
          Org Connect lists hosts and model providers. Gateway metering and tokens stay on the asset Connection tab so traffic stays scoped to that AI asset.
        </Notice>
        <div className={styles.deviceActions}>
          <Link to="/registry">
            <Button variant="ghost" size="sm">
              Open registry
            </Button>
          </Link>
        </div>
      </Section>

      <ToastStack items={toasts} onDismiss={dismissToast} />
    </PageFrame>
  )
}
