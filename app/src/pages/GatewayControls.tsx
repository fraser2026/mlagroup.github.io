import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Notice, SelectMenu, StatusLabel } from '../ui'
import { invokeEdge } from '../lib/edge'
import {
  fmtCount,
  loadModelControls,
  MODEL_CONTROL_DAYS,
  prettyModel,
  type AgentModelControl,
} from '../lib/gateway'
import styles from './GatewayControls.module.css'

type Props = {
  orgId: string
  mode: 'flag' | 'block'
  canManage: boolean
  accessToken?: string
  onModeChange: (mode: 'flag' | 'block') => void
}

const MODE_OPTIONS = [
  { value: 'flag', label: 'Flag and allow', description: 'Record the request as not approved and let it through.' },
  { value: 'block', label: 'Block', description: 'Refuse the request before it reaches the provider.' },
]

function unapprovedText(a: AgentModelControl, capped: boolean) {
  const count = `${fmtCount(a.unapproved_requests)}${capped ? '+' : ''}`
  const models = a.unapproved_models.map((m) => prettyModel('anthropic', m)).join(', ')
  const blocked = a.unapproved_blocked ? `, ${fmtCount(a.unapproved_blocked)} blocked` : ''
  return `${count} ${a.unapproved_requests === 1 ? 'request' : 'requests'}${blocked}: ${models}`
}

export function GatewayControls({ orgId, mode, canManage, accessToken, onModeChange }: Props) {
  const [data, setData] = useState<{ agents: AgentModelControl[]; capped: boolean } | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadModelControls(orgId)
      .then((r) => {
        if (!cancelled) setData(r)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load approved models.')
      })
    return () => {
      cancelled = true
    }
  }, [orgId])

  async function setMode(value: string) {
    if (!accessToken || (value !== 'flag' && value !== 'block') || value === mode) return
    if (
      value === 'block' &&
      !confirm('Block requests for models outside each agent\u2019s approved list? Agents calling those models will receive an error.')
    ) {
      return
    }
    setSaving(true)
    setError('')
    try {
      await invokeEdge('gateway-controls', { action: 'set_model_action', org_id: orgId, value }, accessToken)
      onModeChange(value)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the setting.')
    } finally {
      setSaving(false)
    }
  }

  const agents = data
    ? [...data.agents].sort((a, b) => Number(!a.approved.length) - Number(!b.approved.length) || a.name.localeCompare(b.name))
    : []

  return (
    <div className={styles.wrap}>
      <p className={styles.meta}>
        Limit each agent to the models it is approved to use. Approve models on the agent&apos;s Connection tab in the{' '}
        <Link to="/registry" className={styles.link}>
          registry
        </Link>
        . Agents with no approved models are not checked.
      </p>

      <div className={styles.setting}>
        <div className={styles.settingText}>
          <span className={styles.settingLabel}>Requests for models that are not approved</span>
          <span className={styles.settingHint}>
            Applies to every agent with approved models. The decision is recorded on each request.
          </span>
        </div>
        {canManage ? (
          <SelectMenu
            value={mode}
            options={MODE_OPTIONS}
            disabled={saving}
            aria-label="Requests for models that are not approved"
            onChange={(v) => void setMode(v)}
            className={styles.select}
          />
        ) : (
          <span className={styles.settingValue}>{mode === 'block' ? 'Block' : 'Flag and allow'}</span>
        )}
      </div>

      {error ? <Notice tone="risk">{error}</Notice> : null}

      {agents.length ? (
        <div className={styles.table} role="table" aria-label="Approved models by agent">
          <div className={styles.row} role="row">
            <span role="columnheader">Agent</span>
            <span role="columnheader">Approved models</span>
            <span role="columnheader">Not approved, last {MODEL_CONTROL_DAYS} days</span>
            <span role="columnheader">Status</span>
          </div>
          {agents.map((a) => {
            const checked = a.approved.length > 0
            return (
              <div key={a.asset_id} className={styles.row} role="row">
                <span role="cell" className={styles.ellipsis}>
                  <Link to={`/registry/${a.asset_id}?tab=connection`} className={styles.agent}>
                    {a.name}
                  </Link>
                </span>
                <span role="cell" className={checked ? styles.ellipsis : styles.quiet}>
                  {checked ? a.approved.map((m) => prettyModel('anthropic', m.model_id)).join(', ') : 'None set'}
                </span>
                <span
                  role="cell"
                  className={a.unapproved_requests ? styles.ellipsis : styles.quiet}
                  title={a.unapproved_requests ? unapprovedText(a, data?.capped ?? false) : undefined}
                >
                  {a.unapproved_requests ? unapprovedText(a, data?.capped ?? false) : checked ? 'None' : 'Not checked'}
                </span>
                <span role="cell">
                  {!checked ? (
                    <StatusLabel tone="neutral">Not checked</StatusLabel>
                  ) : a.unapproved_requests ? (
                    <StatusLabel tone="warn">Review</StatusLabel>
                  ) : (
                    <StatusLabel tone="ok">Within approved list</StatusLabel>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      ) : data ? (
        <p className={styles.empty}>No agents have approved models or recent requests yet.</p>
      ) : null}
    </div>
  )
}
