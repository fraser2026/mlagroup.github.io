import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { Button, Drawer, Notice, SelectMenu, StatusLabel } from '../ui'
import { invokeEdge } from '../lib/edge'
import { sb } from '../lib/supabase'
import {
  budgetStateLabel,
  budgetStateTone,
  fmtPct,
  fmtUsdBudget,
  fmtUsdExact,
  fmtUsdFull,
  loadBudgetStatus,
  type BudgetRow,
  type BudgetStatus,
} from '../lib/gateway'
import styles from './GatewayBudgets.module.css'

type Props = {
  orgId: string
  canManage: boolean
  accessToken?: string
}

type Agent = { id: string; name: string }

type Enforcement = 'monitor' | 'block'

type Draft = { budgetId: string | null; scope: string; amount: string; warnAt: string; enforcement: Enforcement }

type LiftDraft = { row: BudgetRow; reason: string }

const ORG_SCOPE = 'org'

const ENFORCEMENT_OPTIONS = [
  { value: 'monitor', label: 'Keep monitoring' },
  { value: 'block', label: 'Block new requests' },
]

function rowStatus(row: BudgetRow) {
  if (row.blocking) return { label: 'Blocking', tone: 'risk' as const }
  if (row.lift && row.state === 'over') return { label: 'Block lifted', tone: 'warn' as const }
  return { label: budgetStateLabel(row.state), tone: budgetStateTone(row.state) }
}

function BudgetMode({ row }: { row: BudgetRow }) {
  if (row.enforcement !== 'block') return null
  if (row.lift) {
    return (
      <span className={styles.mode} title={row.lift.reason}>
        Lifted by {row.lift.created_by_name || 'an admin'}: {row.lift.reason}
      </span>
    )
  }
  return <span className={styles.mode}>{row.blocking ? 'Refusing new requests' : 'Blocks at 100%'}</span>
}

function fmtPeriod(status: BudgetStatus) {
  const start = new Date(status.period_start)
  const lastDay = new Date(new Date(status.period_end).getTime() - 1)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: 'UTC' }
  const days = Math.max(0, Math.ceil((new Date(status.period_end).getTime() - new Date(status.as_of).getTime()) / 86_400_000))
  return `${start.toLocaleDateString('en-GB', opts)} to ${lastDay.toLocaleDateString('en-GB', { ...opts, year: 'numeric' })}, UTC · ${days} ${days === 1 ? 'day' : 'days'} left`
}

function BudgetBar({ row }: { row: BudgetRow }) {
  const used = Math.max(0, Math.min(100, Number(row.used_pct) || 0))
  return (
    <div
      className={styles.bar}
      role="progressbar"
      aria-valuenow={Number(row.used_pct) || 0}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${fmtPct(row.used_pct)} of budget used`}
      style={{ '--used': `${used}%`, '--warn': `${row.warn_at_pct}%` } as CSSProperties}
    >
      <span className={styles.barFill} />
      {row.warn_at_pct < 100 ? <span className={styles.barMark} title={`Warning at ${row.warn_at_pct}%`} /> : null}
    </div>
  )
}

export function GatewayBudgets({ orgId, canManage, accessToken }: Props) {
  const [status, setStatus] = useState<BudgetStatus | null>(null)
  const [error, setError] = useState('')
  const [agents, setAgents] = useState<Agent[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [lift, setLift] = useState<LiftDraft | null>(null)
  const [actionError, setActionError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    loadBudgetStatus(orgId)
      .then((s) => {
        if (!cancelled) setStatus(s)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load budgets.')
      })
    return () => {
      cancelled = true
    }
  }, [orgId, reloadKey])

  useEffect(() => {
    if (!canManage) return
    let cancelled = false
    void sb
      .from('ai_systems')
      .select('id,name')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .order('name')
      .then(({ data }) => {
        if (!cancelled) setAgents(((data as Agent[]) || []).filter((a) => a.name))
      })
    return () => {
      cancelled = true
    }
  }, [orgId, canManage])

  const orgBudget = status?.budgets.find((b) => !b.asset_id) || null
  const agentBudgets = useMemo(() => status?.budgets.filter((b) => b.asset_id) || [], [status])

  const scopeOptions = useMemo(() => {
    const taken = new Set(agentBudgets.map((b) => b.asset_id))
    const editingAgent = draft?.budgetId ? agentBudgets.find((b) => b.id === draft.budgetId)?.asset_id : null
    return [
      ...(!orgBudget || draft?.budgetId === orgBudget.id ? [{ value: ORG_SCOPE, label: 'Whole organisation' }] : []),
      ...agents
        .filter((a) => !taken.has(a.id) || a.id === editingAgent)
        .map((a) => ({ value: a.id, label: a.name })),
    ]
  }, [agents, agentBudgets, orgBudget, draft?.budgetId])

  function openNew() {
    setFormError('')
    setDraft({
      budgetId: null,
      scope: orgBudget ? agents.find((a) => !agentBudgets.some((b) => b.asset_id === a.id))?.id || '' : ORG_SCOPE,
      amount: '',
      warnAt: '80',
      enforcement: 'monitor',
    })
  }

  function openEdit(row: BudgetRow) {
    setFormError('')
    setDraft({
      budgetId: row.id,
      scope: row.asset_id || ORG_SCOPE,
      amount: Number(row.amount_usd).toFixed(2),
      warnAt: String(row.warn_at_pct),
      enforcement: row.enforcement === 'block' ? 'block' : 'monitor',
    })
  }

  function openLift(row: BudgetRow) {
    setFormError('')
    setLift({ row, reason: '' })
  }

  async function saveLift() {
    if (!lift || !accessToken) return
    const reason = lift.reason.trim()
    if (reason.length < 10 || reason.length > 500) {
      setFormError('Give a reason of 10 to 500 characters. It is kept in the audit log.')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      await invokeEdge('gateway-budget', { action: 'lift', org_id: orgId, budget_id: lift.row.id, reason }, accessToken)
      setLift(null)
      setReloadKey((k) => k + 1)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not lift the block.')
    } finally {
      setSaving(false)
    }
  }

  async function reinstate(row: BudgetRow) {
    if (!accessToken) return
    if (!confirm('Reinstate the block? If spend is at or over the budget, new requests are refused straight away.')) return
    setActionError('')
    try {
      await invokeEdge('gateway-budget', { action: 'reinstate', org_id: orgId, budget_id: row.id }, accessToken)
      setReloadKey((k) => k + 1)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not reinstate the block.')
    }
  }

  function blockAction(row: BudgetRow) {
    if (!canManage || row.enforcement !== 'block') return null
    if (row.lift) {
      return (
        <button type="button" className={styles.edit} onClick={() => void reinstate(row)}>
          Reinstate block
        </button>
      )
    }
    if (!row.blocking) return null
    return (
      <button type="button" className={styles.edit} onClick={() => openLift(row)}>
        Lift block
      </button>
    )
  }

  async function save() {
    if (!draft || !accessToken) return
    const amount = draft.amount.trim().replace(/,/g, '').replace(/^\$/, '')
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(amount) || !(Number(amount) > 0)) {
      setFormError('Enter a monthly amount in US dollars, for example 2500 or 2500.50.')
      return
    }
    const warn = Number(draft.warnAt)
    if (!Number.isInteger(warn) || warn < 1 || warn > 100) {
      setFormError('Warning level must be a whole percentage from 1 to 100.')
      return
    }
    if (!draft.scope) {
      setFormError('Choose what this budget covers.')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      await invokeEdge(
        'gateway-budget',
        {
          action: 'upsert',
          org_id: orgId,
          asset_id: draft.scope === ORG_SCOPE ? null : draft.scope,
          amount_usd: amount,
          warn_at_pct: warn,
          enforcement: draft.enforcement,
        },
        accessToken,
      )
      setDraft(null)
      setReloadKey((k) => k + 1)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not save budget.')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!draft?.budgetId || !accessToken) return
    if (!confirm('Remove this budget? Spend history is kept; only the limit is removed.')) return
    setSaving(true)
    setFormError('')
    try {
      await invokeEdge('gateway-budget', { action: 'delete', org_id: orgId, budget_id: draft.budgetId }, accessToken)
      setDraft(null)
      setReloadKey((k) => k + 1)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not remove budget.')
    } finally {
      setSaving(false)
    }
  }

  if (error) return <Notice tone="risk">{error}</Notice>
  if (!status) return null

  const spend = status.org_spend
  const unpriced = Number(spend.unpriced_requests) || 0
  const estimated = Number(spend.estimated_usd) || 0

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.period}>{fmtPeriod(status)}</span>
        {canManage ? (
          <Button variant="ghost" size="sm" onClick={openNew} disabled={!scopeOptions.length && !!orgBudget}>
            Set budget
          </Button>
        ) : null}
      </div>

      <section className={styles.org}>
        <div className={styles.orgMain}>
          <span className={styles.label}>{orgBudget ? 'Organisation spend against budget' : 'Organisation spend this month'}</span>
          <div className={styles.figure}>
            <span className={styles.big} title={fmtUsdFull(spend.spend_usd)}>
              {fmtUsdExact(spend.spend_usd)}
            </span>
            {orgBudget ? <span className={styles.of}>of {fmtUsdBudget(orgBudget.amount_usd)}</span> : null}
            {orgBudget ? <StatusLabel tone={rowStatus(orgBudget).tone}>{rowStatus(orgBudget).label}</StatusLabel> : null}
          </div>
          {orgBudget ? <BudgetBar row={orgBudget} /> : null}
          {orgBudget?.enforcement === 'block' ? (
            <div className={styles.modeLine}>
              <BudgetMode row={orgBudget} />
              {blockAction(orgBudget)}
            </div>
          ) : null}
        </div>
        <dl className={styles.facts}>
          {orgBudget ? (
            <>
              <div>
                <dt>Used</dt>
                <dd className={styles.num}>{fmtPct(orgBudget.used_pct)}</dd>
              </div>
              <div>
                <dt>Remaining</dt>
                <dd className={styles.num}>
                  {Number(orgBudget.remaining_usd) >= 0
                    ? fmtUsdExact(orgBudget.remaining_usd)
                    : `${fmtUsdExact(-Number(orgBudget.remaining_usd))} over`}
                </dd>
              </div>
            </>
          ) : null}
          <div>
            <dt>Exact</dt>
            <dd className={styles.num} title={fmtUsdFull(spend.exact_usd)}>
              {fmtUsdExact(spend.exact_usd)}
            </dd>
          </div>
          <div>
            <dt>Awaiting reconciliation</dt>
            <dd className={styles.num} title={fmtUsdFull(estimated)}>
              {fmtUsdExact(estimated)}
            </dd>
          </div>
          <div>
            <dt>Projected month end</dt>
            <dd className={styles.num}>
              {spend.projected_usd != null ? fmtUsdExact(spend.projected_usd) : 'From day 4'}
            </dd>
          </div>
        </dl>
      </section>

      {unpriced ? (
        <Notice tone="warn">
          {unpriced} {unpriced === 1 ? 'request has' : 'requests have'} no verified price yet, so spend this month is
          incomplete. RegAnchor does not guess prices; these are added once the model&apos;s list price is on record.
        </Notice>
      ) : null}

      {agentBudgets.length ? (
        <div className={styles.table} role="table" aria-label="Agent budgets">
          <div className={styles.row} role="row">
            <span role="columnheader">Agent</span>
            <span role="columnheader" className={styles.right}>
              Spent
            </span>
            <span role="columnheader" className={styles.right}>
              Budget
            </span>
            <span role="columnheader">Used</span>
            <span role="columnheader" className={styles.right}>
              Projected
            </span>
            <span role="columnheader">Status</span>
          </div>
          {agentBudgets.map((b) => (
            <div key={b.id} className={styles.row} role="row">
              <span role="cell" className={styles.agent}>
                <Link to={`/registry/${b.asset_id}?tab=connection`}>{b.asset_name || 'Removed agent'}</Link>
                {canManage ? (
                  <button type="button" className={styles.edit} onClick={() => openEdit(b)}>
                    Edit
                  </button>
                ) : null}
              </span>
              <span role="cell" className={`${styles.num} ${styles.right}`} title={fmtUsdFull(b.spend_usd)}>
                {fmtUsdExact(b.spend_usd)}
              </span>
              <span role="cell" className={`${styles.num} ${styles.right}`}>
                {fmtUsdBudget(b.amount_usd)}
              </span>
              <span role="cell" className={styles.used}>
                <BudgetBar row={b} />
                <span className={styles.num}>{fmtPct(b.used_pct)}</span>
              </span>
              <span role="cell" className={`${styles.num} ${styles.right}`}>
                {b.projected_usd != null ? fmtUsdExact(b.projected_usd) : 'From day 4'}
              </span>
              <span role="cell" className={styles.status}>
                <StatusLabel tone={rowStatus(b).tone}>{rowStatus(b).label}</StatusLabel>
                <BudgetMode row={b} />
                {blockAction(b)}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {canManage && orgBudget ? (
        <div>
          <button type="button" className={styles.edit} onClick={() => openEdit(orgBudget)}>
            Edit organisation budget
          </button>
        </div>
      ) : null}

      {actionError ? <Notice tone="risk">{actionError}</Notice> : null}

      <p className={styles.note}>
        Spend is priced per request from the usage the provider reports, at the provider&apos;s published list price less
        any contracted discount under Pricing, and includes both exact and awaiting-reconciliation amounts. Months run in
        UTC, matching provider billing. Budgets set to block refuse new requests once spend reaches 100%.
      </p>

      <Drawer
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.budgetId ? 'Edit budget' : 'Set budget'}
        description="A monthly spending limit in US dollars, measured against gateway spend for the calendar month in UTC."
        footer={
          <div className={styles.footer}>
            {draft?.budgetId ? (
              <Button variant="ghost" size="sm" onClick={() => void remove()} pending={saving}>
                Remove budget
              </Button>
            ) : (
              <span />
            )}
            <div className={styles.footerEnd}>
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void save()} pending={saving}>
                Save budget
              </Button>
            </div>
          </div>
        }
      >
        {draft ? (
          <div className={styles.form}>
            <label className={styles.field}>
              <span>Applies to</span>
              {draft.budgetId ? (
                <span className={styles.fixed}>
                  {draft.scope === ORG_SCOPE
                    ? 'Whole organisation'
                    : agents.find((a) => a.id === draft.scope)?.name ||
                      agentBudgets.find((b) => b.id === draft.budgetId)?.asset_name ||
                      'Agent'}
                </span>
              ) : (
                <SelectMenu
                  value={draft.scope}
                  options={scopeOptions}
                  placeholder="Choose organisation or agent"
                  onChange={(v) => setDraft({ ...draft, scope: v })}
                />
              )}
            </label>
            <label className={styles.field}>
              <span>Monthly budget, USD</span>
              <input
                className={styles.input}
                inputMode="decimal"
                placeholder="2500.00"
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                aria-label="Monthly budget in US dollars"
              />
            </label>
            <label className={styles.field}>
              <span>Warning level, % of budget</span>
              <input
                className={styles.input}
                inputMode="numeric"
                value={draft.warnAt}
                onChange={(e) => setDraft({ ...draft, warnAt: e.target.value })}
                aria-label="Warning level as a percentage of the budget"
              />
            </label>
            <p className={styles.note}>
              Status changes to Warning level reached at this percentage and Over budget at 100%. Once three full days
              of the month have passed, it also shows Projected over when the average daily spend so far would pass the
              budget by month end. Changes are recorded in the audit log.
            </p>
            <label className={styles.field}>
              <span>When the budget is reached</span>
              <SelectMenu
                value={draft.enforcement}
                options={ENFORCEMENT_OPTIONS}
                aria-label="When the budget is reached"
                onChange={(v) => setDraft({ ...draft, enforcement: v === 'block' ? 'block' : 'monitor' })}
              />
            </label>
            {draft.enforcement === 'block' ? (
              <p className={styles.note}>
                Once spend reaches the budget, new requests are refused with a clear error naming the budget. Requests
                already running finish, so spend can end slightly above the limit. Models without a verified price are
                also refused, because their spend cannot be counted. An owner or admin can lift the block for the rest
                of the month, with a reason.
              </p>
            ) : null}
            {formError ? <Notice tone="risk">{formError}</Notice> : null}
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={!!lift}
        onClose={() => setLift(null)}
        title="Lift block"
        description="Requests continue for the rest of this month (UTC). The block applies again from the 1st, or sooner if you reinstate it."
        footer={
          <div className={styles.footer}>
            <span />
            <div className={styles.footerEnd}>
              <Button variant="ghost" size="sm" onClick={() => setLift(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void saveLift()} pending={saving}>
                Lift block
              </Button>
            </div>
          </div>
        }
      >
        {lift ? (
          <div className={styles.form}>
            <div className={styles.field}>
              <span>Budget</span>
              <span className={styles.fixed}>
                {lift.row.asset_id ? lift.row.asset_name || 'Agent' : 'Whole organisation'},{' '}
                <span className={styles.num}>{fmtUsdBudget(lift.row.amount_usd)}</span> a month, spent{' '}
                <span className={styles.num}>{fmtUsdExact(lift.row.spend_usd)}</span>
              </span>
            </div>
            <label className={styles.field}>
              <span>Reason</span>
              <textarea
                className={styles.textarea}
                rows={4}
                maxLength={500}
                placeholder="For example: quarter-end reporting run approved by the head of finance"
                value={lift.reason}
                onChange={(e) => setLift({ ...lift, reason: e.target.value })}
              />
            </label>
            <p className={styles.note}>Your name, the reason and the time are recorded in the audit log.</p>
            {formError ? <Notice tone="risk">{formError}</Notice> : null}
          </div>
        ) : null}
      </Drawer>
    </div>
  )
}
