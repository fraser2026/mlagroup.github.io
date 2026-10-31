import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Drawer, Notice, StatusLabel } from '../ui'
import { invokeEdge } from '../lib/edge'
import { sb } from '../lib/supabase'
import {
  RECON_USAGE_FIELDS,
  fmtCount,
  fmtTimeShort,
  fmtUsdExact,
  fmtUsdFull,
  loadReconciliation,
  prettyModel,
  reconStatusHint,
  reconStatusLabel,
  reconStatusTone,
  sumUsd,
  type ReconDay,
  type ReconRun,
} from '../lib/gateway'
import styles from './GatewayReconciliation.module.css'

type Props = {
  orgId: string
  canRun: boolean
  accessToken?: string
}

const WINDOW_DAYS = 30

function fmtDay(day: string, withYear = false) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: withYear ? undefined : 'short',
    day: 'numeric',
    month: 'short',
    year: withYear ? 'numeric' : undefined,
    timeZone: 'UTC',
  })
}

function settleDate(day: string) {
  const d = new Date(`${day}T00:00:00Z`)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 8)).toISOString().slice(0, 10)
}

function signedUsd(value: string) {
  const n = Number(value)
  if (!n) return '$0.00'
  return `${n > 0 ? '+' : '-'}${fmtUsdExact(Math.abs(n))}`
}

export function GatewayReconciliation({ orgId, canRun, accessToken }: Props) {
  const [days, setDays] = useState<ReconDay[] | null>(null)
  const [runs, setRuns] = useState<ReconRun[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState('')
  const [selected, setSelected] = useState<ReconDay | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    loadReconciliation(orgId, WINDOW_DAYS)
      .then(async (r) => {
        const ids = [...new Set(r.days.flatMap((d) => d.asset_ids))]
        let nameMap = new Map<string, string>()
        if (ids.length) {
          const { data } = await sb.from('ai_systems').select('id,name').in('id', ids)
          nameMap = new Map(((data as Array<{ id: string; name: string }>) || []).map((a) => [a.id, a.name]))
        }
        if (cancelled) return
        setDays(r.days)
        setRuns(r.runs)
        setNames(nameMap)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load reconciliation.')
      })
    return () => {
      cancelled = true
    }
  }, [orgId, reloadKey])

  const summary = useMemo(() => {
    const list = days || []
    const settled = list.filter((d) => d.status !== 'provider_pending')
    return {
      total: list.length,
      matched: list.filter((d) => d.status === 'matched').length,
      review: list.filter((d) => ['provider_higher', 'recorded_higher', 'cost_difference'].includes(d.status)).length,
      pending: list.filter((d) => d.status === 'provider_pending').length,
      final: list.filter((d) => d.final).length,
      recorded: sumUsd(settled.map((d) => d.recorded_usd)),
      priority: sumUsd(settled.map((d) => d.recorded_priority_usd)),
      list: sumUsd(settled.map((d) => d.provider_list_usd)),
      billed: sumUsd(settled.map((d) => d.provider_billed_usd)),
      variance: sumUsd(settled.map((d) => d.variance_usd)),
    }
  }, [days])

  async function runNow() {
    if (!accessToken) return
    setRunning(true)
    setRunError('')
    try {
      await invokeEdge('gateway-reconcile', { org_id: orgId, days: WINDOW_DAYS }, accessToken)
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Reconciliation failed.')
    } finally {
      setRunning(false)
      setReloadKey((k) => k + 1)
    }
  }

  if (error) return <Notice tone="risk">{error}</Notice>
  if (!days) return null

  const lastRun = runs[0] || null
  const lastCompleted = runs.find((r) => r.status === 'completed') || null
  const agentLabel = (d: ReconDay) => {
    const named = d.asset_ids.map((id) => names.get(id)).filter(Boolean) as string[]
    if (!named.length) return 'Unassigned key'
    return named.length === 1 ? named[0] : `${named[0]} and ${named.length - 1} more`
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.meta}>
          {lastCompleted ? (
            <>
              Last checked {fmtTimeShort(lastCompleted.finished_at || lastCompleted.started_at)}
              {lastCompleted.data_refreshed_at ? (
                <> · Anthropic data to {fmtTimeShort(lastCompleted.data_refreshed_at)}</>
              ) : null}
            </>
          ) : (
            'Not checked yet'
          )}
        </span>
        {canRun ? (
          <Button variant="ghost" size="sm" onClick={() => void runNow()} pending={running}>
            Check now
          </Button>
        ) : null}
      </div>

      {runError ? <Notice tone="risk">{runError}</Notice> : null}
      {!runError && lastRun?.status === 'skipped' ? (
        <Notice tone="warn">
          {lastRun.error}{' '}
          <Link to="/organisation" className={styles.link}>
            Open Organisation
          </Link>
        </Notice>
      ) : null}
      {!runError && lastRun?.status === 'failed' ? (
        <Notice tone="risk">The last check did not finish: {lastRun.error}</Notice>
      ) : null}

      {summary.total ? (
        <>
          <section className={styles.summary}>
            <dl className={styles.facts}>
              <div>
                <dt>Matched</dt>
                <dd className={styles.num}>
                  {summary.matched} of {summary.total - summary.pending} {summary.total - summary.pending === 1 ? 'day' : 'days'}
                </dd>
              </div>
              <div>
                <dt>Need review</dt>
                <dd className={styles.num}>{summary.review}</dd>
              </div>
              <div>
                <dt>Awaiting Anthropic</dt>
                <dd className={styles.num}>{summary.pending}</dd>
              </div>
              <div>
                <dt>Final</dt>
                <dd className={styles.num}>{summary.final}</dd>
              </div>
            </dl>
            <dl className={styles.facts}>
              <div>
                <dt>Recorded by gateway</dt>
                <dd className={styles.num} title={fmtUsdFull(summary.recorded)}>
                  {fmtUsdExact(summary.recorded)}
                </dd>
              </div>
              <div>
                <dt>Anthropic, list price</dt>
                <dd className={styles.num} title={fmtUsdFull(summary.list)}>
                  {fmtUsdExact(summary.list)}
                </dd>
              </div>
              <div>
                <dt>Anthropic, billed</dt>
                <dd className={styles.num} title={fmtUsdFull(summary.billed)}>
                  {fmtUsdExact(summary.billed)}
                </dd>
              </div>
              <div>
                <dt>Difference</dt>
                <dd className={styles.num} title={fmtUsdFull(summary.variance)}>
                  {signedUsd(summary.variance)}
                </dd>
              </div>
            </dl>
          </section>

          <div className={styles.table} role="table" aria-label="Reconciliation by day">
            <div className={styles.row} role="row">
              <span role="columnheader">Day, UTC</span>
              <span role="columnheader">Agent</span>
              <span role="columnheader" className={styles.right}>
                Recorded
              </span>
              <span role="columnheader" className={styles.right}>
                Anthropic list
              </span>
              <span role="columnheader" className={styles.right}>
                Anthropic billed
              </span>
              <span role="columnheader" className={styles.right}>
                Difference
              </span>
              <span role="columnheader">Status</span>
            </div>
            {days.map((d) => (
              <button
                key={`${d.api_key_id}|${d.day}`}
                type="button"
                role="row"
                className={styles.row}
                onClick={() => setSelected(d)}
              >
                <span role="cell" className={styles.num}>
                  {fmtDay(d.day)}
                  {d.final ? <span className={styles.quiet}> · Final</span> : null}
                </span>
                <span role="cell" className={styles.agent}>
                  {agentLabel(d)}
                </span>
                <span role="cell" className={`${styles.num} ${styles.right}`} title={fmtUsdFull(d.recorded_usd)}>
                  {fmtUsdExact(d.recorded_usd)}
                </span>
                <span role="cell" className={`${styles.num} ${styles.right}`} title={fmtUsdFull(d.provider_list_usd)}>
                  {d.status === 'provider_pending' ? <span className={styles.quiet}>Pending</span> : fmtUsdExact(d.provider_list_usd)}
                </span>
                <span role="cell" className={`${styles.num} ${styles.right}`} title={fmtUsdFull(d.provider_billed_usd)}>
                  {d.status === 'provider_pending' ? <span className={styles.quiet}>Pending</span> : fmtUsdExact(d.provider_billed_usd)}
                </span>
                <span role="cell" className={`${styles.num} ${styles.right}`} title={fmtUsdFull(d.variance_usd)}>
                  {d.status === 'provider_pending' ? <span className={styles.quiet}>Pending</span> : signedUsd(d.variance_usd)}
                </span>
                <span role="cell">
                  <StatusLabel tone={reconStatusTone(d.status)}>{reconStatusLabel(d.status)}</StatusLabel>
                </span>
              </button>
            ))}
          </div>
        </>
      ) : lastCompleted ? (
        <p className={styles.note}>No gateway or Anthropic usage on your gateway keys in the last {WINDOW_DAYS} days.</p>
      ) : null}

      <p className={styles.note}>
        Each day, usage recorded by the gateway is compared with Anthropic&apos;s own usage and cost data for the same API
        key, token type by token type. Matched means every token count is identical and recorded cost equals Anthropic
        list price to within $0.000001 plus rounding. Billed is Anthropic&apos;s amount after discounts and before
        credits. Anthropic can revise figures until about seven days after the month ends; days are marked Final after
        that.
      </p>

      <ReconDrawer day={selected} names={names} onClose={() => setSelected(null)} />
    </div>
  )
}

function ReconDrawer({ day: d, names, onClose }: { day: ReconDay | null; names: Map<string, string>; onClose: () => void }) {
  const pending = d?.status === 'provider_pending'
  const priority = d ? Number(d.recorded_priority_usd) : 0
  const other = d ? Number(d.provider_other_billed_usd) : 0
  return (
    <Drawer
      open={!!d}
      onClose={onClose}
      title="Reconciliation"
      variant="preview"
      headerMeta={
        d ? (
          <span className={styles.drawerMeta}>
            <StatusLabel badge tone={reconStatusTone(d.status)}>
              {reconStatusLabel(d.status)}
            </StatusLabel>
            <span className={styles.num}>{fmtDay(d.day, true)}, UTC</span>
          </span>
        ) : undefined
      }
    >
      {d ? (
        <div className={styles.detail}>
          <section className={styles.block}>
            {reconStatusHint(d.status) ? <p className={styles.hint}>{reconStatusHint(d.status)}</p> : null}
            <dl className={styles.kv}>
              <dt>Agent</dt>
              <dd>
                {d.asset_ids.length
                  ? d.asset_ids.map((id) => names.get(id) || 'Removed agent').join(', ')
                  : 'No agent uses this key now'}
              </dd>
              <dt>Anthropic key</dt>
              <dd className={styles.mono}>{d.api_key_id}</dd>
              <dt>Figures</dt>
              <dd>{d.final ? 'Final' : `Provisional until ${fmtDay(settleDate(d.day), true)}`}</dd>
              <dt>Anthropic data</dt>
              <dd className={styles.num}>{d.data_refreshed_at ? `To ${fmtTimeShort(d.data_refreshed_at)}` : 'Not available yet'}</dd>
              <dt>Checked</dt>
              <dd className={styles.num}>{fmtTimeShort(d.checked_at)}</dd>
            </dl>
          </section>

          <section className={styles.block}>
            <span className={styles.blockTitle}>Cost</span>
            <ul className={styles.lines}>
              <li>
                <span>Recorded by gateway</span>
                <span className={styles.num}>{fmtUsdFull(d.recorded_usd)}</span>
              </li>
              {priority ? (
                <li>
                  <span>Less priority tier, covered by commitment</span>
                  <span className={styles.num}>-{fmtUsdFull(d.recorded_priority_usd)}</span>
                </li>
              ) : null}
              <li>
                <span>Anthropic, list price</span>
                <span className={styles.num}>{pending ? 'Pending' : fmtUsdFull(d.provider_list_usd)}</span>
              </li>
              <li className={styles.strong}>
                <span>Difference</span>
                <span className={styles.num}>{pending ? 'Pending' : fmtUsdFull(d.variance_usd)}</span>
              </li>
              <li>
                <span>Allowed for rounding</span>
                <span className={styles.num}>{fmtUsdFull(d.tolerance_usd)}</span>
              </li>
              <li>
                <span>Anthropic, billed after discounts</span>
                <span className={styles.num}>{pending ? 'Pending' : fmtUsdFull(d.provider_billed_usd)}</span>
              </li>
              {other ? (
                <li>
                  <span>Billed outside requests, not compared</span>
                  <span className={styles.num}>{fmtUsdFull(d.provider_other_billed_usd)}</span>
                </li>
              ) : null}
            </ul>
          </section>

          <section className={styles.block}>
            <span className={styles.blockTitle}>Usage</span>
            <div className={styles.compare} role="table" aria-label="Usage comparison">
              <div className={styles.compareRow} role="row">
                <span role="columnheader" />
                <span role="columnheader">Anthropic</span>
                <span role="columnheader">Gateway</span>
                <span role="columnheader">Difference</span>
              </div>
              {RECON_USAGE_FIELDS.map(({ key, label }) => {
                const p = Number(d.provider_usage[key] || 0)
                const r = Number(d.recorded_usage[key] || 0)
                if (!p && !r) return null
                const diff = r - p
                return (
                  <div key={key} className={styles.compareRow} role="row">
                    <span role="cell">{label}</span>
                    <span role="cell" className={styles.num}>{fmtCount(p)}</span>
                    <span role="cell" className={styles.num}>{fmtCount(r)}</span>
                    <span role="cell" className={styles.num}>
                      {diff === 0 ? 'Same' : `${diff > 0 ? '+' : '-'}${fmtCount(Math.abs(diff))}`}
                    </span>
                  </div>
                )
              })}
              <div className={styles.compareRow} role="row">
                <span role="cell">Requests</span>
                <span role="cell" className={styles.num}>{fmtCount(d.provider_usage.requests)}</span>
                <span role="cell" className={styles.num}>{fmtCount(d.recorded_usage.requests)}</span>
                <span role="cell" className={styles.quiet}>For reference</span>
              </div>
            </div>
          </section>

          {d.models.length > 1 ? (
            <section className={styles.block}>
              <span className={styles.blockTitle}>By model</span>
              <ul className={styles.lines}>
                {d.models.map((m) => (
                  <li key={m.model || 'none'}>
                    <span>{m.model ? prettyModel('anthropic', m.model) : 'Not model specific'}</span>
                    <span className={styles.num}>
                      {fmtUsdExact(m.recorded_usd)} recorded · {fmtUsdExact(m.provider_list_usd)} list
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {d.notes.length ? (
            <section className={styles.block}>
              <span className={styles.blockTitle}>Notes</span>
              <ul className={styles.notes}>
                {d.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  )
}
