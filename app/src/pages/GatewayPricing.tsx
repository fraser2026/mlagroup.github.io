import { useEffect, useMemo, useState } from 'react'
import { Button, DateField, Drawer, Notice, SelectMenu, StatusLabel } from '../ui'
import { invokeEdge } from '../lib/edge'
import {
  agreementState,
  fmtPct,
  loadPricing,
  prettyModel,
  type PriceAgreement,
  type PriceSuggestion,
} from '../lib/gateway'
import styles from './GatewayPricing.module.css'

type Props = {
  orgId: string
  canManage: boolean
  accessToken?: string
}

type Draft = {
  id: string | null
  model: string
  discount: string
  from: string
  to: string
  reference: string
}

const ALL_MODELS = 'all'
const DISCOUNT_RE = /^\d{1,2}(\.\d{1,3})?$/

const STATE_LABEL = {
  active: { label: 'In effect', tone: 'ok' as const },
  scheduled: { label: 'Scheduled', tone: 'neutral' as const },
  ended: { label: 'Ended', tone: 'neutral' as const },
}

function fmtDate(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** End dates are stored exclusive; people read the last day covered. */
function lastDay(exclusiveEnd: string) {
  const d = new Date(`${exclusiveEnd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

function nextDay(day: string) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function monthStart() {
  return `${new Date().toISOString().slice(0, 7)}-01`
}

function modelLabel(id: string | null) {
  return id ? prettyModel('anthropic', id) : 'All Anthropic models'
}

export function GatewayPricing({ orgId, canManage, accessToken }: Props) {
  const [agreements, setAgreements] = useState<PriceAgreement[] | null>(null)
  const [suggestion, setSuggestion] = useState<PriceSuggestion | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [savedNote, setSavedNote] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    loadPricing(orgId)
      .then((r) => {
        if (cancelled) return
        setAgreements(r.agreements)
        setSuggestion(r.suggestion)
        setModels(r.models)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load pricing.')
      })
    return () => {
      cancelled = true
    }
  }, [orgId, reloadKey])

  const modelOptions = useMemo(
    () => [
      { value: ALL_MODELS, label: 'All Anthropic models' },
      ...models.map((m) => ({ value: m, label: modelLabel(m) })),
    ],
    [models],
  )

  const check = useMemo(() => {
    if (!agreements || !suggestion || suggestion.discount_pct == null) return null
    if (suggestion.days < 7 || Number(suggestion.list_usd) < 1) return null
    const inEffect = agreements.filter((a) => agreementState(a) === 'active')
    const active = inEffect.find((a) => !a.model_id) || null
    if (!active && inEffect.length) return null
    const billed = Number(suggestion.discount_pct)
    const recorded = active ? Number(active.discount_pct) : 0
    return { active, billed, recorded, differs: Math.abs(billed - recorded) >= 0.5 }
  }, [agreements, suggestion])

  function openNew(discount = '') {
    setFormError('')
    setSavedNote('')
    setDraft({ id: null, model: ALL_MODELS, discount, from: monthStart(), to: '', reference: '' })
  }

  function openEdit(a: PriceAgreement) {
    setFormError('')
    setSavedNote('')
    setDraft({
      id: a.id,
      model: a.model_id || ALL_MODELS,
      discount: String(Number(a.discount_pct)),
      from: a.effective_from,
      to: a.effective_to ? lastDay(a.effective_to) : '',
      reference: a.reference || '',
    })
  }

  function repricedNote(n: unknown) {
    const count = typeof n === 'number' ? n : 0
    return count
      ? `${count.toLocaleString('en-GB')} ${count === 1 ? 'request was' : 'requests were'} re-priced. Spend and budgets now use the contracted price.`
      : 'Saved. No recorded requests fall in this period yet.'
  }

  async function save() {
    if (!draft || !accessToken) return
    const discount = draft.discount.trim().replace(/%$/, '')
    if (!DISCOUNT_RE.test(discount) || !(Number(discount) > 0)) {
      setFormError('Enter the discount as a percentage above 0 and below 100, for example 15 or 12.5.')
      return
    }
    if (!draft.from) {
      setFormError('Choose the date the agreement starts.')
      return
    }
    if (draft.to && draft.to < draft.from) {
      setFormError('The last day must be on or after the start date.')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const res = await invokeEdge<{ repriced?: number }>(
        'gateway-pricing',
        {
          action: 'upsert',
          org_id: orgId,
          id: draft.id,
          provider: 'anthropic',
          model_id: draft.model === ALL_MODELS ? null : draft.model,
          discount_pct: discount,
          effective_from: draft.from,
          effective_to: draft.to ? nextDay(draft.to) : null,
          reference: draft.reference.trim() || null,
        },
        accessToken,
      )
      setDraft(null)
      setSavedNote(repricedNote(res.repriced))
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not save the agreement.')
    } finally {
      setSaving(false)
      setReloadKey((k) => k + 1)
    }
  }

  async function remove() {
    if (!draft?.id || !accessToken) return
    if (!confirm('Remove this agreement? Requests in its period go back to list price. The change is audited.')) return
    setSaving(true)
    setFormError('')
    try {
      const res = await invokeEdge<{ repriced?: number }>('gateway-pricing', { action: 'remove', org_id: orgId, id: draft.id }, accessToken)
      setDraft(null)
      setSavedNote(repricedNote(res.repriced).replace('use the contracted price', 'use list price for that period'))
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not remove the agreement.')
    } finally {
      setSaving(false)
      setReloadKey((k) => k + 1)
    }
  }

  if (error) return <Notice tone="risk">{error}</Notice>
  if (!agreements) return null

  const period = check && suggestion?.from && suggestion.to ? `${fmtDate(suggestion.from)} to ${fmtDate(suggestion.to)}` : ''

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.meta}>
          Spend uses Anthropic list price unless a contracted discount is recorded here.
        </span>
        {canManage ? (
          <Button variant="ghost" size="sm" onClick={() => openNew()}>
            Add agreement
          </Button>
        ) : null}
      </div>

      {savedNote ? <Notice>{savedNote}</Notice> : null}

      {check?.differs && !check.active && check.billed >= 0.5 ? (
        <Notice tone="warn" title="Anthropic billed below list price">
          Over {suggestion?.days} days ({period}), Anthropic billed {fmtPct(check.billed)} less than list price. If your
          organisation has a contracted discount, record it so spend and budgets match your invoice.
          {canManage ? (
            <span className={styles.noticeAction}>
              <Button variant="ghost" size="sm" onClick={() => openNew(String(check.billed))}>
                Record {fmtPct(check.billed)}
              </Button>
            </span>
          ) : null}
        </Notice>
      ) : null}

      {check?.differs && check.active ? (
        <Notice tone="warn" title="Discount differs from billing">
          Over {suggestion?.days} days ({period}), Anthropic billed {fmtPct(check.billed)} below list price, but{' '}
          {fmtPct(check.recorded)} is recorded here. Check the agreement against your contract.
          {canManage ? (
            <span className={styles.noticeAction}>
              <Button variant="ghost" size="sm" onClick={() => openEdit(check.active as PriceAgreement)}>
                Review agreement
              </Button>
            </span>
          ) : null}
        </Notice>
      ) : null}

      {agreements.length ? (
        <div className={styles.table} role="table" aria-label="Contracted pricing">
          <div className={styles.row} role="row">
            <span role="columnheader">Models</span>
            <span role="columnheader" className={styles.right}>
              Discount
            </span>
            <span role="columnheader">Period, UTC</span>
            <span role="columnheader">Reference</span>
            <span role="columnheader">Status</span>
          </div>
          {agreements.map((a) => {
            const state = STATE_LABEL[agreementState(a)]
            return (
              <div key={a.id} className={styles.row} role="row">
                <span role="cell" className={styles.primary}>
                  <span className={styles.ellipsis}>{modelLabel(a.model_id)}</span>
                  {canManage ? (
                    <button type="button" className={styles.edit} onClick={() => openEdit(a)}>
                      Edit
                    </button>
                  ) : null}
                </span>
                <span role="cell" className={`${styles.num} ${styles.right}`}>
                  {fmtPct(a.discount_pct)}
                </span>
                <span role="cell" className={styles.num}>
                  {fmtDate(a.effective_from)} to {a.effective_to ? fmtDate(lastDay(a.effective_to)) : 'no end date'}
                </span>
                <span role="cell" className={`${styles.ellipsis} ${a.reference ? '' : styles.quiet}`} title={a.reference || undefined}>
                  {a.reference || 'None'}
                </span>
                <span role="cell">
                  <StatusLabel tone={state.tone}>{state.label}</StatusLabel>
                </span>
              </div>
            )
          })}
        </div>
      ) : null}

      {check && !check.differs ? (
        <p className={styles.note}>
          {check.active
            ? `Matches Anthropic billing: ${fmtPct(check.billed)} below list price over ${suggestion?.days} days (${period}).`
            : `Anthropic billed at list price over ${suggestion?.days} days (${period}).`}
        </p>
      ) : null}

      <p className={styles.note}>
        Recorded spend is list price less the discount in effect on the day of each request. An agreement for a single
        model takes precedence over one for all models. Reconciliation still compares token counts and list price with
        Anthropic, so a discount never hides a usage difference. Changes are recorded in the audit log.
      </p>

      <Drawer
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Edit agreement' : 'Add agreement'}
        description="The discount off Anthropic list price in your contract. Requests from the start date are re-priced when you save."
        footer={
          <div className={styles.footer}>
            {draft?.id ? (
              <Button variant="ghost" size="sm" onClick={() => void remove()} pending={saving}>
                Remove agreement
              </Button>
            ) : (
              <span />
            )}
            <div className={styles.footerEnd}>
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void save()} pending={saving}>
                Save agreement
              </Button>
            </div>
          </div>
        }
      >
        {draft ? (
          <div className={styles.form}>
            <label className={styles.field}>
              <span>Models</span>
              <SelectMenu
                value={draft.model}
                options={modelOptions}
                aria-label="Models covered"
                onChange={(v) => setDraft({ ...draft, model: v })}
              />
            </label>
            <label className={styles.field}>
              <span>Discount off list price, %</span>
              <input
                className={styles.input}
                inputMode="decimal"
                placeholder="15"
                value={draft.discount}
                onChange={(e) => setDraft({ ...draft, discount: e.target.value })}
                aria-label="Discount off list price as a percentage"
              />
            </label>
            <div className={styles.dates}>
              <label className={styles.field}>
                <span>Starts</span>
                <DateField aria-label="Start date" value={draft.from} onChange={(v) => setDraft({ ...draft, from: v })} />
              </label>
              <label className={styles.field}>
                <span>Last day, optional</span>
                <DateField
                  aria-label="Last day"
                  value={draft.to}
                  placeholder="No end date"
                  onChange={(v) => setDraft({ ...draft, to: v })}
                />
              </label>
            </div>
            <label className={styles.field}>
              <span>Contract reference, optional</span>
              <input
                className={`${styles.input} ${styles.text}`}
                maxLength={200}
                placeholder="For example: Anthropic order form, March 2026"
                value={draft.reference}
                onChange={(e) => setDraft({ ...draft, reference: e.target.value })}
                aria-label="Contract reference"
              />
            </label>
            <p className={styles.note}>
              Dates are UTC, matching Anthropic billing. Agreements for the same models cannot overlap; end the current
              one the day before a new rate starts.
            </p>
            {formError ? <Notice tone="risk">{formError}</Notice> : null}
          </div>
        ) : null}
      </Drawer>
    </div>
  )
}
