import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Copy, ExternalLink, Eye, Lock, Trash2 } from 'lucide-react'
import {
  BrandLoader,
  Button,
  Drawer,
  Icon,
  Notice,
  PageFrame,
  PageHeader,
  ToastStack,
} from '../ui'
import type { ToastItem } from '../ui'
import { usePageChrome } from '../ui/shellChrome'
import { useAuth } from '../auth/AuthProvider'
import { invokeEdge } from '../lib/edge'
import { PRESET_API_KEYS, type OrgEnvVariable } from '../lib/orgEnv'
import styles from './ApiKeysPage.module.css'

type DraftKind = 'secret' | 'plain'

export function ApiKeysPage() {
  const { org, session, canManageMembers } = useAuth()
  const canManage = Boolean(canManageMembers)
  const [vars, setVars] = useState<OrgEnvVariable[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [presetDrafts, setPresetDrafts] = useState<Record<string, string>>({})
  const [presetBusy, setPresetBusy] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [draftKind, setDraftKind] = useState<DraftKind>('secret')
  const [draftName, setDraftName] = useState('VARIABLE_NAME')
  const [draftValue, setDraftValue] = useState('')
  const [saveBusy, setSaveBusy] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState('')
  const [toasts, setToasts] = useState<ToastItem[]>([])

  usePageChrome({
    title: 'API keys',
    breadcrumbs: [{ label: 'API keys' }],
  })

  function pushToast(text: string) {
    if (!text.trim()) return
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `t-${Date.now()}-${Math.random().toString(16).slice(2)}`
    setToasts((prev) => [...prev, { id, text }])
  }

  const load = useCallback(async () => {
    if (!org?.id || !session?.access_token) return
    setLoading(true)
    setError('')
    try {
      const res = await invokeEdge<{ variables?: OrgEnvVariable[] }>(
        'org-env',
        { action: 'list', org_id: org.id },
        session.access_token,
      )
      setVars(Array.isArray(res.variables) ? res.variables : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load API keys.')
    } finally {
      setLoading(false)
    }
  }, [org?.id, session?.access_token])

  useEffect(() => {
    void load()
  }, [load])

  const byPreset = useMemo(() => {
    const map = new Map<string, OrgEnvVariable>()
    for (const v of vars) {
      if (v.kind === 'preset' && v.preset_key) map.set(v.preset_key, v)
    }
    return map
  }, [vars])

  const secrets = useMemo(() => vars.filter((v) => v.kind === 'secret'), [vars])
  const plains = useMemo(() => vars.filter((v) => v.kind === 'plain'), [vars])

  function openDrawer(kind: DraftKind) {
    setDraftKind(kind)
    setDraftName('VARIABLE_NAME')
    setDraftValue('')
    setDrawerOpen(true)
  }

  async function savePreset(name: string) {
    if (!org?.id || !session?.access_token || !canManage) return
    const value = (presetDrafts[name] || '').trim()
    if (!value) {
      pushToast('Enter a value before saving.')
      return
    }
    setPresetBusy(name)
    setError('')
    try {
      await invokeEdge(
        'org-env',
        { action: 'upsert_preset', org_id: org.id, name, value },
        session.access_token,
      )
      setPresetDrafts((prev) => ({ ...prev, [name]: '' }))
      await load()
      pushToast(`${name} saved.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save key.')
    } finally {
      setPresetBusy('')
    }
  }

  async function clearPreset(name: string) {
    if (!org?.id || !session?.access_token || !canManage) return
    if (!window.confirm(`Remove ${name}? This cannot be undone.`)) return
    setPresetBusy(name)
    try {
      await invokeEdge(
        'org-env',
        { action: 'clear_preset', org_id: org.id, name },
        session.access_token,
      )
      await load()
      pushToast(`${name} cleared.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clear key.')
    } finally {
      setPresetBusy('')
    }
  }

  async function saveVariable() {
    if (!org?.id || !session?.access_token || !canManage) return
    const name = draftName.trim().toUpperCase()
    const value = draftValue
    if (!name || name === 'VARIABLE_NAME') {
      pushToast('Enter a variable name.')
      return
    }
    if (!value.trim()) {
      pushToast('Enter a value.')
      return
    }
    setSaveBusy(true)
    setError('')
    try {
      await invokeEdge(
        'org-env',
        {
          action: 'upsert_variable',
          org_id: org.id,
          kind: draftKind,
          name,
          value,
        },
        session.access_token,
      )
      setDrawerOpen(false)
      await load()
      pushToast(`${name} saved.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save variable.')
    } finally {
      setSaveBusy(false)
    }
  }

  async function deleteVariable(v: OrgEnvVariable) {
    if (!org?.id || !session?.access_token || !canManage) return
    if (!window.confirm(`Delete ${v.name}?`)) return
    setDeleteBusy(v.id)
    try {
      await invokeEdge(
        'org-env',
        { action: 'delete', org_id: org.id, variable_id: v.id },
        session.access_token,
      )
      await load()
      pushToast(`${v.name} deleted.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete.')
    } finally {
      setDeleteBusy('')
    }
  }

  async function copyPlain(v: OrgEnvVariable) {
    const text = v.value || ''
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      pushToast('Copied.')
    } catch {
      pushToast('Could not copy.')
    }
  }

  if (loading) {
    return (
      <PageFrame>
        <PageHeader
          title="API keys"
          description="Store provider keys and organisation variables securely."
        />
        <BrandLoader fill label="Loading API keys" />
      </PageFrame>
    )
  }

  return (
    <PageFrame
      railItems={[
        { id: 'presets', label: 'API keys' },
        { id: 'secrets', label: 'Secret variables' },
        { id: 'plain', label: 'Plain variables' },
      ]}
    >
      <PageHeader
        title="API keys"
        description="Store provider keys and organisation variables securely."
      />

      {error ? (
        <Notice tone="risk" title="Could not update">
          {error}
        </Notice>
      ) : null}

      {!canManage ? (
        <Notice title="View only">
          Only organisation owners and admins can add or change API keys and variables.
        </Notice>
      ) : null}

      <section id="presets" className={styles.block}>
        <div className={styles.blockCopy}>
          <h2 className={styles.blockTitle}>Pre-defined variables</h2>
          <p className={styles.blockDesc}>
            Environment variables allow you to securely store API keys for this organisation. Values are
            encrypted at rest and never shown again after save.
          </p>
        </div>
        <div className={styles.blockBody}>
          <div className={styles.presetList}>
            {PRESET_API_KEYS.map((slot) => {
              const stored = byPreset.get(slot.name)
              const has = Boolean(stored?.has_value)
              const draft = presetDrafts[slot.name] ?? ''
              return (
                <div key={slot.name} className={styles.presetRow}>
                  <div className={styles.presetHead}>
                    <span className={styles.presetName}>{slot.name}</span>
                    <a
                      className={styles.docsLink}
                      href={slot.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {slot.docsLabel}
                      <Icon icon={ExternalLink} size="sm" />
                    </a>
                  </div>
                  <div className={styles.presetFieldWrap}>
                    <input
                      className={styles.presetInput}
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      disabled={!canManage || presetBusy === slot.name}
                      placeholder={has && !draft ? '••••••••••••••••' : slot.placeholder}
                      value={draft}
                      onChange={(e) =>
                        setPresetDrafts((prev) => ({ ...prev, [slot.name]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void savePreset(slot.name)
                        }
                      }}
                      aria-label={slot.name}
                    />
                    {has && !draft ? (
                      <span className={styles.presetCheck} aria-hidden>
                        <Icon icon={Check} size="sm" />
                      </span>
                    ) : null}
                  </div>
                  {slot.hint ? <p className={styles.presetHint}>{slot.hint}</p> : null}
                  {canManage ? (
                    <div className={styles.presetActions}>
                      <Button
                        size="sm"
                        pending={presetBusy === slot.name}
                        disabled={!draft.trim()}
                        onClick={() => void savePreset(slot.name)}
                      >
                        {has ? 'Replace' : 'Save'}
                      </Button>
                      {has ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          pending={presetBusy === slot.name}
                          onClick={() => void clearPreset(slot.name)}
                        >
                          Clear
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section id="secrets" className={styles.block}>
        <div className={styles.blockCopy}>
          <h2 className={styles.blockTitle}>Secret variables</h2>
          <p className={styles.blockDesc}>
            Store sensitive values. Encrypted at rest, masked in the UI.
          </p>
        </div>
        <div className={styles.blockBody}>
          <div className={styles.panel}>
            {secrets.length === 0 ? (
              <div className={styles.emptyPanel}>
                <div className={styles.emptyCopy}>
                  <span className={styles.emptyTitle}>Add your first secret variable</span>
                  <span className={styles.emptyBody}>
                    Use secret variables to store sensitive values like API keys, passwords, and other
                    confidential information.
                  </span>
                </div>
                {canManage ? (
                  <Button size="sm" onClick={() => openDrawer('secret')}>
                    Add variable
                  </Button>
                ) : null}
              </div>
            ) : (
              <>
                <ul className={styles.varList}>
                  {secrets.map((v) => (
                    <li key={v.id} className={styles.varItem}>
                      <div className={styles.varMeta}>
                        <span className={styles.varNameMuted}>{v.name}</span>
                        {canManage ? (
                          <button
                            type="button"
                            className={styles.iconBtn}
                            aria-label={`Delete ${v.name}`}
                            disabled={deleteBusy === v.id}
                            onClick={() => void deleteVariable(v)}
                          >
                            <Icon icon={Trash2} size="sm" />
                          </button>
                        ) : null}
                      </div>
                      <div className={styles.maskedValue}>••••••••••••••••</div>
                    </li>
                  ))}
                </ul>
                {canManage ? (
                  <div className={styles.panelFoot}>
                    <Button size="sm" onClick={() => openDrawer('secret')}>
                      Add variable
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </section>

      <section id="plain" className={styles.block}>
        <div className={styles.blockCopy}>
          <h2 className={styles.blockTitle}>Plain variables</h2>
          <p className={styles.blockDesc}>
            Store non-sensitive variables. Values are visible to project members.
          </p>
        </div>
        <div className={styles.blockBody}>
          <div className={styles.panel}>
            {plains.length === 0 ? (
              <div className={styles.emptyPanel}>
                <div className={styles.emptyCopy}>
                  <span className={styles.emptyTitle}>Add your first plain variable</span>
                  <span className={styles.emptyBody}>
                    Use plain variables for non-sensitive values like client IDs, regions, and other
                    configuration values.
                  </span>
                </div>
                {canManage ? (
                  <Button size="sm" onClick={() => openDrawer('plain')}>
                    Add variable
                  </Button>
                ) : null}
              </div>
            ) : (
              <>
                <ul className={styles.varList}>
                  {plains.map((v) => (
                    <li key={v.id} className={styles.varItem}>
                      <div className={styles.varMeta}>
                        <span className={styles.varName}>{v.name}</span>
                        <div className={styles.varActions}>
                          <button
                            type="button"
                            className={styles.iconBtn}
                            aria-label={`Copy ${v.name}`}
                            onClick={() => void copyPlain(v)}
                          >
                            <Icon icon={Copy} size="sm" />
                          </button>
                          {canManage ? (
                            <button
                              type="button"
                              className={styles.iconBtn}
                              aria-label={`Delete ${v.name}`}
                              disabled={deleteBusy === v.id}
                              onClick={() => void deleteVariable(v)}
                            >
                              <Icon icon={Trash2} size="sm" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <div className={styles.plainValue}>{v.value || ''}</div>
                    </li>
                  ))}
                </ul>
                {canManage ? (
                  <div className={styles.panelFoot}>
                    <Button size="sm" onClick={() => openDrawer('plain')}>
                      Add variable
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </section>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={draftKind === 'secret' ? 'Add secret variable' : 'Add plain variable'}
        description={
          draftKind === 'secret'
            ? 'Store a sensitive value. It will be encrypted and masked after save.'
            : 'Store a non-sensitive value. It will stay visible to organisation members.'
        }
        footer={
          <div className={styles.drawerActions}>
            <Button variant="ghost" size="sm" onClick={() => setDrawerOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" pending={saveBusy} onClick={() => void saveVariable()}>
              Save variable
            </Button>
          </div>
        }
      >
        <div className={styles.kindToggle}>
          <button
            type="button"
            className={draftKind === 'secret' ? styles.kindActive : styles.kindBtn}
            onClick={() => setDraftKind('secret')}
          >
            <Icon icon={Lock} size="sm" />
            Secret
          </button>
          <button
            type="button"
            className={draftKind === 'plain' ? styles.kindActive : styles.kindBtn}
            onClick={() => setDraftKind('plain')}
          >
            <Icon icon={Eye} size="sm" />
            Plain
          </button>
        </div>

        <label className={styles.field}>
          Name
          <input
            className={styles.input}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value.toUpperCase())}
            placeholder="VARIABLE_NAME"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className={styles.field}>
          Value
          <input
            className={styles.input}
            type={draftKind === 'secret' ? 'password' : 'text'}
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            placeholder={draftKind === 'secret' ? 'Enter secret value' : 'Enter plain value'}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </Drawer>

      <ToastStack items={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </PageFrame>
  )
}
