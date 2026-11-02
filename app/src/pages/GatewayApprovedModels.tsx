import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Notice, StatusLabel } from '../ui'
import { invokeEdge } from '../lib/edge'
import { gatewayModelKey, loadApprovedModels, prettyModel, type ApprovedModel } from '../lib/gateway'
import page from './RegistryDetailPage.module.css'

type Props = {
  orgId: string
  assetId: string
  provider: string
  /** Model declared on the asset record. */
  assetModel?: string | null
  /** Models this agent has called through the gateway in the current window. */
  seenModels: string[]
  mode: 'flag' | 'block'
  canManage: boolean
  accessToken?: string
  onToast: (text: string) => void
}

const MAX_SUGGESTIONS = 4

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function GatewayApprovedModels({
  orgId,
  assetId,
  provider,
  assetModel,
  seenModels,
  mode,
  canManage,
  accessToken,
  onToast,
}: Props) {
  const [approved, setApproved] = useState<ApprovedModel[] | null>(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    loadApprovedModels(assetId)
      .then((rows) => {
        if (!cancelled) setApproved(rows)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load approved models.')
      })
    return () => {
      cancelled = true
    }
  }, [assetId])

  const approvedKeys = useMemo(() => new Set((approved || []).map((a) => a.model_key)), [approved])

  const suggestions = useMemo(() => {
    const out: string[] = []
    const keys = new Set<string>()
    for (const m of [assetModel, ...seenModels]) {
      if (!m) continue
      const key = gatewayModelKey(m)
      if (!key || approvedKeys.has(key) || keys.has(key)) continue
      keys.add(key)
      out.push(m)
    }
    return out.slice(0, MAX_SUGGESTIONS)
  }, [assetModel, seenModels, approvedKeys])

  const unapprovedSeen = useMemo(
    () => (approved?.length ? seenModels.filter((m) => !approvedKeys.has(gatewayModelKey(m))) : []),
    [approved, seenModels, approvedKeys],
  )

  async function approve(model: string) {
    const value = model.trim()
    if (!value || !accessToken) return
    setBusy(`approve-${value}`)
    setError('')
    try {
      const data = await invokeEdge<{ approved?: ApprovedModel }>(
        'gateway-controls',
        { action: 'approve_model', org_id: orgId, asset_id: assetId, model: value },
        accessToken,
      )
      if (data.approved) setApproved((rows) => [...(rows || []), data.approved as ApprovedModel])
      if (value === typed.trim()) setTyped('')
      onToast(`${prettyModel(provider, value)} approved for this agent.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not approve the model.')
    } finally {
      setBusy('')
    }
  }

  async function remove(row: ApprovedModel) {
    if (!accessToken) return
    const last = (approved || []).length === 1
    if (
      last &&
      !confirm('Remove the last approved model? Requests from this agent will no longer be checked against an approved list.')
    ) {
      return
    }
    setBusy(`remove-${row.id}`)
    setError('')
    try {
      await invokeEdge(
        'gateway-controls',
        { action: 'remove_model', org_id: orgId, asset_id: assetId, approval_id: row.id },
        accessToken,
      )
      setApproved((rows) => (rows || []).filter((r) => r.id !== row.id))
      onToast(`${prettyModel(provider, row.model_id)} removed from approved models.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the model.')
    } finally {
      setBusy('')
    }
  }

  if (approved === null && !error) return null

  const list = approved || []
  const outcome = mode === 'block' ? 'blocked' : 'flagged and allowed'

  return (
    <div className={page.cardSection}>
      <div className={page.connBlockHead}>
        <span className={page.sectionLabel}>Approved models</span>
        {list.length ? (
          <StatusLabel tone={mode === 'block' ? 'ok' : 'neutral'}>
            {mode === 'block' ? 'Others blocked' : 'Others flagged'}
          </StatusLabel>
        ) : null}
      </div>
      <p className={page.connHint}>
        {list.length ? (
          <>
            Requests for any other model are {outcome}.{' '}
            {canManage ? (
              <Link to="/gateway#controls" className={page.cardLink}>
                Change for the organisation
              </Link>
            ) : null}
          </>
        ) : (
          'No approved models set, so requests are not checked. Approve the models this agent should use, and RegAnchor flags or blocks the rest.'
        )}
      </p>

      {list.length ? (
        <ul className={page.tokenList}>
          {list.map((row) => (
            <li key={row.id} className={page.tokenRow}>
              <div className={page.tokenMain}>
                <span className={page.tokenLabel} title={row.model_id}>
                  {prettyModel(provider, row.model_id)}
                </span>
                <span className={page.connDate}>
                  Any version or region of {row.model_key} · Approved {fmtDay(row.created_at)}
                </span>
              </div>
              {canManage ? (
                <div className={page.tokenActions}>
                  <Button
                    variant="ghost"
                    size="sm"
                    pending={busy === `remove-${row.id}`}
                    onClick={() => void remove(row)}
                  >
                    Remove
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {unapprovedSeen.length ? (
        <p className={page.connHint}>
          Used recently without approval: {unapprovedSeen.map((m) => prettyModel(provider, m)).join(', ')}.
        </p>
      ) : null}

      {canManage ? (
        <>
          {suggestions.length ? (
            <div className={page.mintRow}>
              {suggestions.map((m) => (
                <Button
                  key={m}
                  variant="ghost"
                  size="sm"
                  pending={busy === `approve-${m}`}
                  disabled={!!busy}
                  onClick={() => void approve(m)}
                >
                  Approve {prettyModel(provider, m)}
                </Button>
              ))}
            </div>
          ) : null}
          <div className={page.mintRow}>
            <input
              className={page.input}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void approve(typed)
              }}
              placeholder="Model ID, for example claude-haiku-4-5"
              maxLength={200}
              aria-label="Model ID to approve"
            />
            <Button
              size="sm"
              disabled={!typed.trim() || !!busy}
              pending={busy === `approve-${typed.trim()}`}
              onClick={() => void approve(typed)}
            >
              Approve model
            </Button>
          </div>
        </>
      ) : null}

      {error ? <Notice tone="risk">{error}</Notice> : null}
    </div>
  )
}
