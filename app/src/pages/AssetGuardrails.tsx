import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, StatusLabel } from '../ui'
import { guardrailsCall, type GuardrailsData } from '../lib/guardrails'
import styles from './RegistryDetailPage.module.css'

type Props = {
  orgId: string
  assetId: string
  assetName: string
  accessToken?: string
  onToast: (text: string) => void
}

/** Read-only summary of the organisation's guardrails for one agent, plus the pause switch. */
export function AssetGuardrails({ orgId, assetId, assetName, accessToken, onToast }: Props) {
  const [data, setData] = useState<GuardrailsData | null>(null)
  const [reason, setReason] = useState('')
  const [pausing, setPausing] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!accessToken) return
    try {
      setData(await guardrailsCall<GuardrailsData>('list', orgId, accessToken))
    } catch {
      setData(null)
    }
  }, [orgId, accessToken])

  useEffect(() => {
    void load()
  }, [load])

  if (!data) return null

  const pause = data.pauses.find((p) => p.asset_id === assetId) || null
  const on = data.guardrails.filter((g) => g.mode !== 'off')
  const inForce = on.length + (data.blocking_budgets ? 1 : 0) + (pause ? 1 : 0)
  const blocking = on.filter((g) => g.mode === 'block').length + (data.blocking_budgets ? 1 : 0) + (pause ? 1 : 0)

  async function act(action: 'pause_agent' | 'resume_agent') {
    if (!accessToken) return
    setBusy(true)
    try {
      await guardrailsCall(action, orgId, accessToken, { asset_id: assetId, reason })
      onToast(action === 'pause_agent' ? `${assetName} paused` : `${assetName} resumed`)
      setPausing(false)
      setReason('')
      await load()
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'That change did not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.cardSection}>
      <div className={styles.connBlockHead}>
        <span className={styles.sectionLabel}>Guardrails</span>
        <Link to="/gateway?tab=guardrails" className={styles.cardLink}>
          Open guardrails
        </Link>
      </div>
      <p className={styles.connHint}>
        Guardrails in force: {inForce}, blocking {blocking}. They are set for the whole organisation on the Guardrails
        tab in Monitoring.
      </p>
      {pause ? (
        <p className={styles.connHint}>
          <StatusLabel tone="risk">Paused</StatusLabel> Every request from this agent is refused. Reason: {pause.reason}
        </p>
      ) : null}
      {data.can_manage ? (
        pause ? (
          <div>
            <Button variant="ghost" size="sm" pending={busy} onClick={() => void act('resume_agent')}>
              Resume agent
            </Button>
          </div>
        ) : pausing ? (
          <form
            className={styles.mintRow}
            onSubmit={(e) => {
              e.preventDefault()
              void act('pause_agent')
            }}
          >
            <input
              className={styles.input}
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason, for example incident review"
              aria-label="Reason for pausing"
              autoFocus
            />
            <Button size="sm" type="submit" pending={busy} disabled={reason.trim().length < 3}>
              Pause agent
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPausing(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <div>
            <Button variant="ghost" size="sm" onClick={() => setPausing(true)}>
              Pause agent
            </Button>
          </div>
        )
      ) : null}
    </div>
  )
}
