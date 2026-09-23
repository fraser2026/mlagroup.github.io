import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Copy, Eye, KeyRound, Link2, Shield } from 'lucide-react'
import {
  BrandLoader,
  Button,
  Drawer,
  EmptyState,
  Icon,
  Notice,
  PageFrame,
  PageHeader,
  SelectMenu,
  StatusLabel,
  ToastStack,
} from '../ui'
import type { ToastItem } from '../ui'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { invokeEdge } from '../lib/edge'
import { canUseAuditorAccess } from '../lib/org'
import {
  DEFAULT_AUDITOR_SCOPES,
  auditorShareUrl,
  type AuditorEngagement,
  type AuditorScopeCatalogItem,
  type AuditorScopes,
} from '../lib/auditor'
import { fmtDate } from '../lib/rpc'
import styles from './AuditorAccessPage.module.css'

const WINDOW_OPTIONS = [
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
]

export function AuditorAccessPage() {
  const { org, session, canManageMembers } = useAuth()
  const navigate = useNavigate()
  const canManage = Boolean(canManageMembers)
  const entitled = canUseAuditorAccess(org)
  const [engagements, setEngagements] = useState<AuditorEngagement[]>([])
  const [catalog, setCatalog] = useState<AuditorScopeCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [firm, setFirm] = useState('')
  const [email, setEmail] = useState('')
  const [days, setDays] = useState(30)
  const [scopes, setScopes] = useState<AuditorScopes>({ ...DEFAULT_AUDITOR_SCOPES })
  const [revealed, setRevealed] = useState<{ kind: 'share' | 'api'; value: string; engagementId: string } | null>(
    null,
  )
  const [copied, setCopied] = useState(false)
  const [scopeEditId, setScopeEditId] = useState<string | null>(null)

  usePageChrome({ title: 'Auditor access', breadcrumbs: [{ label: 'Auditor access' }] })

  function pushToast(text: string) {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `t-${Date.now()}`
    setToasts((prev) => [...prev, { id, text }])
  }

  const load = useCallback(async () => {
    if (!org?.id || !session?.access_token || !entitled) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await invokeEdge<{
        engagements?: AuditorEngagement[]
        scopes_catalog?: AuditorScopeCatalogItem[]
        error?: string
      }>('auditor-access', { action: 'list', org_id: org.id }, session.access_token)
      setEngagements(Array.isArray(res.engagements) ? res.engagements : [])
      setCatalog(Array.isArray(res.scopes_catalog) ? res.scopes_catalog : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load auditor access.')
    } finally {
      setLoading(false)
    }
  }, [org?.id, session?.access_token, entitled])

  useEffect(() => {
    void load()
  }, [load])

  function openCreate() {
    setName('')
    setFirm('')
    setEmail('')
    setDays(30)
    setScopes({ ...DEFAULT_AUDITOR_SCOPES })
    setRevealed(null)
    setDrawerOpen(true)
  }

  async function createEngagement() {
    if (!org?.id || !session?.access_token) return
    if (!name.trim()) {
      setError('Engagement name is required.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await invokeEdge<{
        share_token?: string
        engagement?: AuditorEngagement
        error?: string
      }>(
        'auditor-access',
        {
          action: 'create',
          org_id: org.id,
          name: name.trim(),
          firm_name: firm.trim() || undefined,
          contact_email: email.trim() || undefined,
          duration_days: days,
          scopes,
        },
        session.access_token,
      )
      setDrawerOpen(false)
      if (res.share_token && res.engagement) {
        setRevealed({ kind: 'share', value: res.share_token, engagementId: res.engagement.id })
      }
      pushToast('Engagement created. Copy the share link now — it is shown once.')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create engagement.')
    } finally {
      setBusy(false)
    }
  }

  async function mintApiKey(engagementId: string) {
    if (!org?.id || !session?.access_token) return
    setBusy(true)
    try {
      const res = await invokeEdge<{ token?: string }>('auditor-access', {
        action: 'mint_token',
        org_id: org.id,
        engagement_id: engagementId,
        kind: 'api',
        label: 'Auditor API key',
      }, session.access_token)
      if (res.token) setRevealed({ kind: 'api', value: res.token, engagementId })
      pushToast('API key minted. Copy it now — it is shown once.')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not mint API key.')
    } finally {
      setBusy(false)
    }
  }

  async function mintShare(engagementId: string) {
    if (!org?.id || !session?.access_token) return
    setBusy(true)
    try {
      const res = await invokeEdge<{ token?: string }>('auditor-access', {
        action: 'mint_token',
        org_id: org.id,
        engagement_id: engagementId,
        kind: 'share',
        label: 'Share link',
      }, session.access_token)
      if (res.token) setRevealed({ kind: 'share', value: res.token, engagementId })
      pushToast('Share link minted. Copy it now — it is shown once.')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not mint share link.')
    } finally {
      setBusy(false)
    }
  }

  async function revokeToken(tokenId: string) {
    if (!org?.id || !session?.access_token) return
    if (!window.confirm('Revoke this auditor credential? Access ends immediately.')) return
    setBusy(true)
    try {
      await invokeEdge('auditor-access', { action: 'revoke_token', org_id: org.id, token_id: tokenId }, session.access_token)
      pushToast('Credential revoked.')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke.')
    } finally {
      setBusy(false)
    }
  }

  async function endEngagement(engagementId: string, mode: 'complete' | 'revoke_engagement') {
    if (!org?.id || !session?.access_token) return
    const msg =
      mode === 'complete'
        ? 'Mark this engagement complete? All share links and API keys will stop working.'
        : 'Revoke this engagement? All access ends immediately.'
    if (!window.confirm(msg)) return
    setBusy(true)
    try {
      await invokeEdge('auditor-access', { action: mode, org_id: org.id, engagement_id: engagementId }, session.access_token)
      pushToast(mode === 'complete' ? 'Engagement completed.' : 'Engagement revoked.')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update engagement.')
    } finally {
      setBusy(false)
    }
  }

  async function saveScopes(engagementId: string, next: AuditorScopes) {
    if (!org?.id || !session?.access_token) return
    setBusy(true)
    try {
      await invokeEdge(
        'auditor-access',
        { action: 'update_scopes', org_id: org.id, engagement_id: engagementId, scopes: next },
        session.access_token,
      )
      setScopeEditId(null)
      pushToast('Visibility updated.')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update visibility.')
    } finally {
      setBusy(false)
    }
  }

  async function copyValue(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
      pushToast('Copied.')
    } catch {
      pushToast('Could not copy.')
    }
  }

  if (loading && entitled) {
    return (
      <PageFrame>
        <PageHeader
          title="Auditor access"
          description="Time-boxed, read-only access for external auditors. You control what they can see."
        />
        <BrandLoader fill label="Loading auditor access" />
      </PageFrame>
    )
  }

  if (!entitled) {
    return (
      <PageFrame>
        <PageHeader
          title="Auditor access"
          description="Time-boxed, read-only access for external auditors. You control what they can see."
        />
        <EmptyState
          title="Professional feature"
          body="Auditor access is included with Professional and Enterprise. Create engagements, choose visibility, and share a link or API key without granting a full workspace seat."
          action={
            <Button size="sm" onClick={() => navigate('/plans')}>
              View plans
            </Button>
          }
        />
      </PageFrame>
    )
  }

  if (!canManage) {
    return (
      <PageFrame>
        <PageHeader title="Auditor access" description="Owners and admins manage auditor engagements." />
        <Notice tone="quiet">View only. Ask an organisation owner or admin to create auditor access.</Notice>
      </PageFrame>
    )
  }

  const editing = scopeEditId ? engagements.find((e) => e.id === scopeEditId) : null

  return (
    <PageFrame
      railItems={[
        { id: 'overview', label: 'Overview' },
        { id: 'engagements', label: 'Engagements' },
      ]}
    >
      <PageHeader
        title="Auditor access"
        description="Time-boxed, read-only access for external auditors. You control what they can see."
        actions={
          <Button size="sm" onClick={openCreate} pending={busy}>
            New engagement
          </Button>
        }
      />

      {error ? <Notice tone="risk">{error}</Notice> : null}

      {revealed ? (
        <section className={styles.reveal} aria-live="polite">
          <div className={styles.revealHead}>
            <div>
              <div className={styles.revealTitle}>
                {revealed.kind === 'share' ? 'Share link' : 'API key'} — copy now
              </div>
              <p className={styles.revealHint}>
                Shown once. Store it in a password manager. Revoke anytime from the engagement.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setRevealed(null)}>
              Dismiss
            </Button>
          </div>
          <code className={styles.revealValue}>
            {revealed.kind === 'share' ? auditorShareUrl(revealed.value) : revealed.value}
          </code>
          <div className={styles.revealActions}>
            <Button
              size="sm"
              onClick={() =>
                void copyValue(
                  revealed.kind === 'share' ? auditorShareUrl(revealed.value) : revealed.value,
                )
              }
            >
              <Icon icon={copied ? Check : Copy} size="sm" />
              {copied ? 'Copied' : 'Copy'}
            </Button>
            {revealed.kind === 'share' ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.open(auditorShareUrl(revealed.value), '_blank', 'noopener,noreferrer')}
              >
                <Icon icon={Eye} size="sm" />
                Preview
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      <section id="overview" className={styles.overview}>
        <div className={styles.overviewCard}>
          <Icon icon={Shield} size="sm" />
          <div>
            <div className={styles.overviewTitle}>Client-controlled</div>
            <p className={styles.overviewBody}>
              Choose exactly which governance surfaces an auditor can read. No workspace seat, no write
              access, no billing or Connect.
            </p>
          </div>
        </div>
        <div className={styles.overviewCard}>
          <Icon icon={Link2} size="sm" />
          <div>
            <div className={styles.overviewTitle}>Share link</div>
            <p className={styles.overviewBody}>
              Time-boxed portal for human review. Expires with the engagement window or when you revoke.
            </p>
          </div>
        </div>
        <div className={styles.overviewCard}>
          <Icon icon={KeyRound} size="sm" />
          <div>
            <div className={styles.overviewTitle}>API key</div>
            <p className={styles.overviewBody}>
              Optional read credential for auditor tooling. Same scopes as the share link. Shown once at
              mint.
            </p>
          </div>
        </div>
      </section>

      <section id="engagements" className={styles.listSection}>
        <h2 className={styles.listTitle}>Engagements</h2>
        {!engagements.length ? (
          <EmptyState
            title="No auditor engagements yet"
            body="Create an engagement when you are ready for an external review. You will get a share link immediately."
            action={
              <Button size="sm" onClick={openCreate}>
                New engagement
              </Button>
            }
          />
        ) : (
          <div className={styles.list}>
            {engagements.map((eng) => {
              const activeTokens = (eng.tokens || []).filter((t) => !t.revoked_at)
              const statusTone =
                eng.status === 'active' ? 'ok' : eng.status === 'completed' ? 'info' : 'warn'
              return (
                <article key={eng.id} className={styles.card}>
                  <header className={styles.cardHead}>
                    <div>
                      <div className={styles.cardTitle}>{eng.name}</div>
                      <div className={styles.cardMeta}>
                        {eng.firm_name ? `${eng.firm_name} · ` : ''}
                        Window {fmtDate(eng.window_start)} – {fmtDate(eng.window_end)}
                      </div>
                    </div>
                    <StatusLabel tone={statusTone}>{eng.status}</StatusLabel>
                  </header>

                  <div className={styles.scopeStrip}>
                    {Object.entries(eng.scopes || {})
                      .filter(([, on]) => on)
                      .map(([key]) => (
                        <span key={key} className={styles.scopeChip}>
                          {catalog.find((c) => c.key === key)?.label || key}
                        </span>
                      ))}
                    {!Object.values(eng.scopes || {}).some(Boolean) ? (
                      <span className={styles.scopeEmpty}>No surfaces shared</span>
                    ) : null}
                  </div>

                  {activeTokens.length ? (
                    <ul className={styles.tokenList}>
                      {activeTokens.map((t) => (
                        <li key={t.id} className={styles.tokenRow}>
                          <span className={styles.tokenKind}>{t.kind === 'api' ? 'API' : 'Share'}</span>
                          <code className={styles.tokenPrefix}>{t.token_prefix}…</code>
                          <span className={styles.tokenExpiry}>Expires {fmtDate(t.expires_at)}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy || eng.status !== 'active'}
                            onClick={() => void revokeToken(t.id)}
                          >
                            Revoke
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.noTokens}>No active credentials.</p>
                  )}

                  <footer className={styles.cardFoot}>
                    {eng.status === 'active' ? (
                      <>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setScopeEditId(eng.id)}>
                          Edit visibility
                        </Button>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mintShare(eng.id)}>
                          New share link
                        </Button>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mintApiKey(eng.id)}>
                          Mint API key
                        </Button>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void endEngagement(eng.id, 'complete')}>
                          Complete
                        </Button>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void endEngagement(eng.id, 'revoke_engagement')}>
                          Revoke all
                        </Button>
                      </>
                    ) : null}
                  </footer>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <Drawer
        open={drawerOpen}
        title="New auditor engagement"
        description="Set the window and choose what the auditor can read. A share link is created automatically."
        onClose={() => setDrawerOpen(false)}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDrawerOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" pending={busy} onClick={() => void createEngagement()}>
              Create and mint link
            </Button>
          </>
        }
      >
        <div className={styles.form}>
          <label className={styles.field}>
            Engagement name
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. FY26 ISO 42001 review"
            />
          </label>
          <label className={styles.field}>
            Audit firm
            <input
              className={styles.input}
              value={firm}
              onChange={(e) => setFirm(e.target.value)}
              placeholder="Optional"
            />
          </label>
          <label className={styles.field}>
            Firm contact email
            <input
              className={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Optional"
            />
          </label>
          <label className={styles.field}>
            Access window
            <SelectMenu
              value={String(days)}
              options={WINDOW_OPTIONS}
              aria-label="Access window"
              onChange={(v) => setDays(Number(v))}
            />
          </label>
          <fieldset className={styles.scopeFieldset}>
            <legend className={styles.legend}>What the auditor can see</legend>
            <p className={styles.legendHint}>Everything else stays private. You can change this later.</p>
            <div className={styles.scopeGrid}>
              {(catalog.length
                ? catalog
                : Object.keys(DEFAULT_AUDITOR_SCOPES).map((key) => ({
                    key,
                    label: key,
                    description: '',
                  }))
              ).map((item) => (
                <label key={item.key} className={styles.scopeCheck}>
                  <input
                    type="checkbox"
                    checked={Boolean(scopes[item.key as keyof AuditorScopes])}
                    onChange={() =>
                      setScopes((prev) => ({
                        ...prev,
                        [item.key]: !prev[item.key as keyof AuditorScopes],
                      }))
                    }
                  />
                  <span>
                    <span className={styles.scopeLabel}>{item.label}</span>
                    {item.description ? <span className={styles.scopeDesc}>{item.description}</span> : null}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </Drawer>

      <Drawer
        open={Boolean(editing)}
        title="Edit visibility"
        description={editing ? editing.name : ''}
        onClose={() => setScopeEditId(null)}
        footer={
          editing ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setScopeEditId(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                pending={busy}
                onClick={() => {
                  const next = { ...DEFAULT_AUDITOR_SCOPES, ...(editing.scopes as AuditorScopes) }
                  void saveScopes(editing.id, next)
                }}
              >
                Save visibility
              </Button>
            </>
          ) : null
        }
      >
        {editing ? (
          <div className={styles.scopeGrid}>
            {(catalog.length ? catalog : []).map((item) => {
              const on = Boolean(
                (editing.scopes as Record<string, boolean>)?.[item.key] ??
                  DEFAULT_AUDITOR_SCOPES[item.key as keyof AuditorScopes],
              )
              return (
                <label key={item.key} className={styles.scopeCheck}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      setEngagements((prev) =>
                        prev.map((e) =>
                          e.id === editing.id
                            ? {
                                ...e,
                                scopes: {
                                  ...e.scopes,
                                  [item.key]: !on,
                                },
                              }
                            : e,
                        ),
                      )
                    }}
                  />
                  <span>
                    <span className={styles.scopeLabel}>{item.label}</span>
                    {item.description ? <span className={styles.scopeDesc}>{item.description}</span> : null}
                  </span>
                </label>
              )
            })}
          </div>
        ) : null}
      </Drawer>

      <ToastStack items={toasts} onDismiss={(id) => setToasts((p) => p.filter((t) => t.id !== id))} />
    </PageFrame>
  )
}
