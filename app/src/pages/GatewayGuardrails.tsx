import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Notice, SelectMenu, StatusLabel } from '../ui'
import type { SelectOption } from '../ui'
import { labelProvider } from '../lib/registry'
import { fmtCount, fmtMs, outcomeLabel, prettyModel, type GatewaySettings } from '../lib/gateway'
import {
  APPLIES_LABEL,
  GUARDRAIL_COUNT_DAYS,
  GUARDRAIL_GROUPS,
  GUARDRAILS,
  MODE_LABEL,
  VERDICT,
  enforcedByLabel,
  evidenceLabel,
  expectedVerdict,
  guardrailLabel,
  guardrailsCall,
  type AppliesTo,
  type GuardrailDef,
  type GuardrailMode,
  type GuardrailState,
  type GuardrailTest,
  type GuardrailsData,
} from '../lib/guardrails'
import styles from './GatewayGuardrails.module.css'

type Props = {
  orgId: string
  accessToken?: string
  settings: GatewaySettings | null
  onOpenActivity: (opts: { guardrail?: string | null; checks?: boolean }) => void
  onOpenSpend: () => void
}

type TestState = { running: boolean; result?: GuardrailTest; error?: string }

const MODE_HINT: Record<GuardrailMode, string> = {
  off: 'Not checked.',
  flag: 'Let the request through and record the finding.',
  block: 'Refuse the request and record it.',
}

const RATE_WINDOWS: SelectOption[] = [
  { value: '60', label: 'Per minute' },
  { value: '300', label: 'Per 5 minutes' },
  { value: '3600', label: 'Per hour' },
]

const RULE_TYPES: SelectOption[] = [
  { value: 'phrase', label: 'Phrase', description: 'Matches the words, ignoring case.' },
  { value: 'pattern', label: 'Pattern', description: 'A regular expression, for example ACC-[0-9]{6}.' },
]

/** Settings with their own controls in the row instead of Off, Flag and Block. */
const OWN_CONTROLS = new Set(['agent_pause', 'budgets'])
const EXPANDABLE = new Set(['agent_pause', 'registered_model', 'blocked_models', 'custom_rules', 'rate_limit'])

function windowLabel(seconds: number) {
  return seconds === 3600 ? 'hour' : seconds === 300 ? '5 minutes' : 'minute'
}

function errorText(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback
}

export function GatewayGuardrails({ orgId, accessToken, settings, onOpenActivity, onOpenSpend }: Props) {
  const [data, setData] = useState<GuardrailsData | null>(null)
  const [error, setError] = useState('')
  const [agentId, setAgentId] = useState('')
  const [busy, setBusy] = useState('')
  const [rowError, setRowError] = useState<Record<string, string>>({})
  const [tests, setTests] = useState<Record<string, TestState>>({})
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [blockInput, setBlockInput] = useState('')
  const [allowInput, setAllowInput] = useState('')
  const [ruleLabel, setRuleLabel] = useState('')
  const [rulePattern, setRulePattern] = useState('')
  const [ruleType, setRuleType] = useState<'phrase' | 'pattern'>('phrase')
  const [sample, setSample] = useState('')
  const [pauseReason, setPauseReason] = useState('')
  const [rateLimit, setRateLimit] = useState('600')
  const [rateWindow, setRateWindow] = useState('60')

  const load = useCallback(async () => {
    if (!accessToken) return
    try {
      const next = await guardrailsCall<GuardrailsData>('list', orgId, accessToken)
      setData(next)
      setError('')
      setAgentId((current) => (current && next.agents.some((a) => a.id === current) ? current : next.agents[0]?.id || ''))
      const rate = next.guardrails.find((g) => g.key === 'rate_limit')
      if (rate?.config.limit) setRateLimit(String(rate.config.limit))
      if (rate?.config.interval) setRateWindow(String(rate.config.interval))
    } catch (e) {
      setError(errorText(e, 'Could not load guardrails.'))
    }
  }, [orgId, accessToken])

  useEffect(() => {
    void load()
  }, [load])

  const state = useMemo(() => new Map((data?.guardrails || []).map((g) => [g.key, g])), [data])
  const agent = data?.agents.find((a) => a.id === agentId) || null
  const paused = new Map((data?.pauses || []).map((p) => [p.asset_id, p]))
  const canManage = !!data?.can_manage && !!accessToken
  const agentNames = new Map((data?.agents || []).map((a) => [a.id, a.name]))

  async function run(key: string, label: string, fn: () => Promise<unknown>) {
    setBusy(label)
    setRowError((r) => ({ ...r, [key]: '' }))
    try {
      await fn()
      await load()
      return true
    } catch (e) {
      setRowError((r) => ({ ...r, [key]: errorText(e, 'That change did not save.') }))
      return false
    } finally {
      setBusy('')
    }
  }

  function call(action: string, body: Record<string, unknown> = {}) {
    return guardrailsCall(action, orgId, accessToken!, body)
  }

  function setMode(def: GuardrailDef, row: GuardrailState, mode: GuardrailMode, appliesTo?: AppliesTo) {
    if (mode === row.mode && (!appliesTo || appliesTo === row.applies_to)) return
    if (mode === 'block' && row.mode !== 'block' && !confirm(`Block requests that trip "${def.label}"? Agents will receive an error for those requests.`)) {
      return
    }
    const config = def.key === 'rate_limit' ? { limit: Number(rateLimit), interval: Number(rateWindow) } : undefined
    void run(def.key, `set:${def.key}`, () => call('set', { key: def.key, mode, applies_to: appliesTo, config }))
  }

  async function runTest(def: GuardrailDef) {
    if (!agentId) return
    setTests((t) => ({ ...t, [def.key]: { running: true } }))
    try {
      const res = await call('test', {
        key: def.key,
        asset_id: agentId,
        sample: def.key === 'custom_rules' ? sample : undefined,
      }) as unknown as { test: GuardrailTest }
      setTests((t) => ({ ...t, [def.key]: { running: false, result: res.test } }))
      void load()
    } catch (e) {
      setTests((t) => ({ ...t, [def.key]: { running: false, error: errorText(e, 'The test did not run.') } }))
    }
  }

  function toggle(key: string) {
    setOpen((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (error && !data) return <Notice tone="risk">{error}</Notice>
  if (!data) return <p className={styles.note}>Loading guardrails</p>

  const cloudflareReady = data.setup.cloudflare
  const agentOptions: SelectOption[] = data.agents.map((a) => ({
    value: a.id,
    label: a.name,
    description: [labelProvider(a.provider_slug || ''), a.model_name ? prettyModel('anthropic', a.model_name) : '']
      .filter(Boolean)
      .join(' · '),
  }))
  const inForce = data.guardrails.filter((g) => g.mode !== 'off').length + data.pauses.length + (data.blocking_budgets ? 1 : 0)

  function modeFor(def: GuardrailDef): GuardrailMode {
    if (def.key === 'agent_pause') return agentId && paused.has(agentId) ? 'block' : 'off'
    if (def.key === 'budgets') return data!.blocking_budgets ? 'block' : 'off'
    return state.get(def.key)?.mode || 'off'
  }

  function detailLabel(def: GuardrailDef, row?: GuardrailState) {
    switch (def.key) {
      case 'agent_pause':
        return data!.pauses.length ? `Paused agents (${data!.pauses.length})` : 'Pause an agent'
      case 'registered_model': {
        const extra = data!.allowed_models.filter((m) => m.asset_id === agentId).length
        return agent ? `Models for ${agent.name}${extra ? ` (${extra} extra)` : ''}` : 'Models by agent'
      }
      case 'blocked_models':
        return `Blocked list (${data!.blocked_models.length})`
      case 'custom_rules':
        return `Rules (${data!.custom_rules.length})`
      case 'rate_limit':
        return row?.mode !== 'off' && row?.config.limit
          ? `${fmtCount(row.config.limit)} requests per ${windowLabel(Number(row.config.interval) || 60)}`
          : 'Set the limit'
      default:
        return ''
    }
  }

  function controls(def: GuardrailDef, row?: GuardrailState) {
    if (def.key === 'agent_pause') {
      if (!agent) return <span className={styles.quiet}>No agent selected</span>
      const p = paused.get(agent.id)
      return (
        <div className={styles.controlLine}>
          {p ? <StatusLabel tone="risk">Paused</StatusLabel> : <span className={styles.value}>Running</span>}
          {canManage ? (
            p ? (
              <Button
                variant="ghost"
                size="sm"
                pending={busy === `resume:${agent.id}`}
                onClick={() => void run(def.key, `resume:${agent.id}`, () => call('resume_agent', { asset_id: agent.id }))}
              >
                Resume
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setOpen((s) => new Set(s).add(def.key))}>
                Pause
              </Button>
            )
          ) : null}
        </div>
      )
    }
    if (def.key === 'budgets') {
      return (
        <div className={styles.controlLine}>
          <span className={styles.value}>
            {data!.blocking_budgets ? `${fmtCount(data!.blocking_budgets)} set to block` : 'None set to block'}
          </span>
          <button type="button" className={styles.textBtn} onClick={onOpenSpend}>
            Manage on Spend
          </button>
        </div>
      )
    }
    if (!row) return null
    const locked = def.enforcedBy === 'cloudflare' && !cloudflareReady
    if (!canManage || locked) {
      return (
        <span className={styles.value}>
          {MODE_LABEL[row.mode]}
          {row.mode !== 'off' && def.appliesTo.length > 1 ? `, ${APPLIES_LABEL[row.applies_to].toLowerCase()}` : ''}
        </span>
      )
    }
    const saving = busy === `set:${def.key}`
    return (
      <div className={styles.controlLine}>
        <SelectMenu
          className={styles.mode}
          value={row.mode}
          disabled={saving}
          aria-label={`${def.label} setting`}
          options={def.modes.map((m) => ({ value: m, label: MODE_LABEL[m], description: MODE_HINT[m] }))}
          onChange={(v) => setMode(def, row, v as GuardrailMode)}
        />
        {def.appliesTo.length > 1 && row.mode !== 'off' ? (
          <SelectMenu
            className={styles.applies}
            value={row.applies_to}
            disabled={saving}
            aria-label={`${def.label} applies to`}
            options={def.appliesTo.map((a) => ({ value: a, label: APPLIES_LABEL[a] }))}
            onChange={(v) => setMode(def, row, row.mode, v as AppliesTo)}
          />
        ) : null}
      </div>
    )
  }

  function count(def: GuardrailDef) {
    const c = data!.counts[def.key]
    const total = (c?.flagged || 0) + (c?.blocked || 0)
    if (!total) return <span className={styles.quiet}>None</span>
    const text = [c.blocked ? `${fmtCount(c.blocked)} blocked` : '', c.flagged ? `${fmtCount(c.flagged)} flagged` : '']
      .filter(Boolean)
      .join(', ')
    return (
      <button type="button" className={styles.countBtn} onClick={() => onOpenActivity({ guardrail: def.key })}>
        {text}
      </button>
    )
  }

  function testCell(def: GuardrailDef) {
    if (!def.test) {
      return (
        <span className={styles.quiet}>
          {def.key === 'budgets' ? 'Shown on Spend' : def.key === 'rate_limit' ? 'No test' : 'No test yet'}
        </span>
      )
    }
    const t = tests[def.key]
    const disabled = !canManage || !agentId || !data!.setup.tests
    return (
      <Button
        variant="ghost"
        size="sm"
        pending={t?.running}
        disabled={disabled}
        title={!agentId ? 'Add an Anthropic or Amazon Bedrock agent to run tests.' : undefined}
        onClick={() => void runTest(def)}
      >
        Test
      </Button>
    )
  }

  function testResult(def: GuardrailDef) {
    const t = tests[def.key]
    if (!t || t.running) return null
    if (t.error) {
      return (
        <div className={styles.result}>
          <StatusLabel tone="risk">Did not run</StatusLabel>
          <span className={styles.resultText}>{t.error}</span>
        </div>
      )
    }
    const r = t.result
    if (!r) return null
    const mode = modeFor(def)
    const expected = expectedVerdict(mode)
    const v = VERDICT[r.verdict]
    const own = r.hits.filter((h) => h.key === def.key)
    const onResponse = own.some((h) => h.check === 'RESPONSE')
    const others = r.hits.filter((h) => h.key !== def.key && h.action === 'BLOCK').map((h) => guardrailLabel(h.key))
    const changedAt = state.get(def.key)?.updated_at
    const settling =
      def.enforcedBy === 'cloudflare' && r.verdict !== expected && !!changedAt && Date.now() - Date.parse(changedAt) < 120_000
    const summary =
      r.verdict === 'blocked'
        ? `Blocked by ${def.label} ${onResponse ? 'on the response' : 'before it reached the model'}`
        : r.verdict === 'flagged'
          ? `Allowed and flagged by ${def.label}${onResponse ? ' on the response' : ''}`
          : r.verdict === 'allowed'
            ? 'Allowed: this guardrail did not fire'
            : r.verdict === 'stopped_by_other'
              ? `Stopped by ${others.length ? others.join(', ') : outcomeLabel(r.outcome).toLowerCase()} before this guardrail was checked`
              : 'The request did not complete'
    return (
      <div className={styles.result}>
        <div className={styles.resultHead}>
          <StatusLabel tone={v.tone}>{v.label}</StatusLabel>
          <span className={styles.resultText}>
            {summary}, <span className={styles.num}>{fmtMs(r.elapsed_ms)}</span>
          </span>
          {r.event_id ? (
            <button type="button" className={styles.textBtn} onClick={() => onOpenActivity({ checks: true })}>
              View request
            </button>
          ) : null}
        </div>
        <p className={styles.resultPrompt}>
          {r.verdict === expected ? `As expected with ${MODE_LABEL[mode]}.` : `Expected ${VERDICT[expected].label.toLowerCase()} with ${MODE_LABEL[mode]}.`}{' '}
          Sent as {r.agent.name} to {prettyModel('anthropic', r.model)}: “{r.prompt}”
        </p>
        {settling ? (
          <p className={styles.resultPrompt}>This setting changed in the last two minutes. Cloudflare takes up to about a minute to apply a change, so test again shortly.</p>
        ) : null}
        {r.message && r.verdict === 'error' ? <p className={styles.resultPrompt}>Gateway reply: {r.message}</p> : null}
        {r.message && r.verdict === 'allowed' && r.http_status >= 400 ? (
          <p className={styles.resultPrompt}>The provider then returned an error: {r.message}</p>
        ) : null}
      </div>
    )
  }

  function detail(def: GuardrailDef) {
    switch (def.key) {
      case 'agent_pause':
        return (
          <div className={styles.detail}>
            {data!.pauses.length ? (
              <ul className={styles.list}>
                {data!.pauses.map((p) => (
                  <li key={p.asset_id}>
                    <span className={styles.value}>{agentNames.get(p.asset_id) || 'Agent'}</span>
                    <span className={styles.listMeta}>
                      {p.reason} · {new Date(p.paused_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </span>
                    {canManage ? (
                      <button
                        type="button"
                        className={styles.textBtn}
                        disabled={busy === `resume:${p.asset_id}`}
                        onClick={() => void run(def.key, `resume:${p.asset_id}`, () => call('resume_agent', { asset_id: p.asset_id }))}
                      >
                        Resume
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.note}>No agents are paused.</p>
            )}
            {canManage && agent && !paused.has(agent.id) ? (
              <form
                className={styles.inline}
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!confirm(`Pause ${agent.name}? Every request from it will be refused until it is resumed.`)) return
                  void run(def.key, 'pause', () => call('pause_agent', { asset_id: agent.id, reason: pauseReason })).then(
                    (ok) => ok && setPauseReason(''),
                  )
                }}
              >
                <input
                  className={styles.input}
                  value={pauseReason}
                  maxLength={500}
                  placeholder={`Reason for pausing ${agent.name}, for example incident review`}
                  onChange={(e) => setPauseReason(e.target.value)}
                />
                <Button size="sm" type="submit" pending={busy === 'pause'} disabled={pauseReason.trim().length < 3}>
                  Pause {agent.name}
                </Button>
              </form>
            ) : null}
          </div>
        )
      case 'registered_model': {
        const extra = data!.allowed_models.filter((m) => m.asset_id === agentId)
        return (
          <div className={styles.detail}>
            {agent ? (
              <>
                <ul className={styles.list}>
                  <li>
                    <span className={styles.value}>
                      {agent.model_name ? prettyModel('anthropic', agent.model_name) : 'No model in the registry entry'}
                    </span>
                    <span className={styles.listMeta}>Registered model</span>
                  </li>
                  {extra.map((m) => (
                    <li key={m.id}>
                      <span className={styles.value}>{prettyModel('anthropic', m.model_id)}</span>
                      <span className={styles.listMeta}>Extra model allowed</span>
                      {canManage ? (
                        <button
                          type="button"
                          className={styles.textBtn}
                          disabled={busy === `disallow:${m.id}`}
                          onClick={() => void run(def.key, `disallow:${m.id}`, () => call('disallow_model', { id: m.id }))}
                        >
                          Remove
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {!agent.model_name ? (
                  <p className={styles.note}>
                    Agents with no registered model and no extra models are not checked. Set the model on the{' '}
                    <Link to={`/registry/${agent.id}`} className={styles.link}>
                      registry entry
                    </Link>
                    .
                  </p>
                ) : null}
                {canManage ? (
                  <form
                    className={styles.inline}
                    onSubmit={(e) => {
                      e.preventDefault()
                      void run(def.key, 'allow', () => call('allow_model', { asset_id: agent.id, model: allowInput })).then(
                        (ok) => ok && setAllowInput(''),
                      )
                    }}
                  >
                    <input
                      className={styles.input}
                      value={allowInput}
                      placeholder="Model ID, for example claude-sonnet-4-5"
                      onChange={(e) => setAllowInput(e.target.value)}
                    />
                    <Button size="sm" variant="ghost" type="submit" pending={busy === 'allow'} disabled={!allowInput.trim()}>
                      Allow for {agent.name}
                    </Button>
                  </form>
                ) : null}
              </>
            ) : (
              <p className={styles.note}>Pick an agent at the top to see its models.</p>
            )}
          </div>
        )
      }
      case 'blocked_models':
        return (
          <div className={styles.detail}>
            {data!.blocked_models.length ? (
              <ul className={styles.list}>
                {data!.blocked_models.map((m) => (
                  <li key={m.id}>
                    <span className={styles.value}>{prettyModel('anthropic', m.model_id)}</span>
                    <span className={styles.listMeta}>{m.model_id}</span>
                    {canManage ? (
                      <button
                        type="button"
                        className={styles.textBtn}
                        disabled={busy === `unblock:${m.id}`}
                        onClick={() => void run(def.key, `unblock:${m.id}`, () => call('unblock_model', { id: m.id }))}
                      >
                        Remove
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.note}>No models are on the blocked list.</p>
            )}
            {canManage ? (
              <form
                className={styles.inline}
                onSubmit={(e) => {
                  e.preventDefault()
                  void run(def.key, 'block', () => call('block_model', { model: blockInput })).then((ok) => ok && setBlockInput(''))
                }}
              >
                <input
                  className={styles.input}
                  value={blockInput}
                  placeholder="Model ID, for example claude-opus-4-1"
                  onChange={(e) => setBlockInput(e.target.value)}
                />
                <Button size="sm" variant="ghost" type="submit" pending={busy === 'block'} disabled={!blockInput.trim()}>
                  Add to list
                </Button>
              </form>
            ) : null}
            <p className={styles.note}>Versions and regions count as the same model: blocking Claude Opus 4.1 covers every dated release and Bedrock region.</p>
          </div>
        )
      case 'custom_rules':
        return (
          <div className={styles.detail}>
            {data!.custom_rules.length ? (
              <ul className={styles.list}>
                {data!.custom_rules.map((r) => (
                  <li key={r.id}>
                    <span className={styles.value}>{r.label}</span>
                    <span className={styles.listMeta}>
                      {r.match_type === 'pattern' ? 'Pattern' : 'Phrase'} <code className={styles.code}>{r.pattern}</code>
                    </span>
                    {canManage ? (
                      <button
                        type="button"
                        className={styles.textBtn}
                        disabled={busy === `rule:${r.id}`}
                        onClick={() => void run(def.key, `rule:${r.id}`, () => call('remove_rule', { id: r.id }))}
                      >
                        Remove
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.note}>No rules yet.</p>
            )}
            {canManage ? (
              <form
                className={styles.ruleForm}
                onSubmit={(e) => {
                  e.preventDefault()
                  void run(def.key, 'rule', () =>
                    call('add_rule', { label: ruleLabel, match_type: ruleType, pattern: rulePattern }),
                  ).then((ok) => {
                    if (!ok) return
                    setRuleLabel('')
                    setRulePattern('')
                  })
                }}
              >
                <input
                  className={styles.input}
                  value={ruleLabel}
                  maxLength={80}
                  placeholder="Name, for example client account numbers"
                  onChange={(e) => setRuleLabel(e.target.value)}
                />
                <SelectMenu
                  className={styles.ruleType}
                  value={ruleType}
                  options={RULE_TYPES}
                  aria-label="Match type"
                  onChange={(v) => setRuleType(v === 'pattern' ? 'pattern' : 'phrase')}
                />
                <input
                  className={styles.input}
                  value={rulePattern}
                  maxLength={200}
                  placeholder={ruleType === 'pattern' ? 'ACC-[0-9]{6}' : 'Project Falcon'}
                  onChange={(e) => setRulePattern(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  type="submit"
                  pending={busy === 'rule'}
                  disabled={ruleLabel.trim().length < 2 || rulePattern.trim().length < 2}
                >
                  Add rule
                </Button>
              </form>
            ) : null}
            {canManage ? (
              <label className={styles.field}>
                Text to test against your rules
                <input
                  className={styles.input}
                  value={sample}
                  maxLength={500}
                  placeholder="Leave empty to test with your first phrase"
                  onChange={(e) => setSample(e.target.value)}
                />
              </label>
            ) : null}
          </div>
        )
      case 'rate_limit': {
        const row = state.get('rate_limit')
        return (
          <div className={styles.detail}>
            {canManage && cloudflareReady ? (
              <form
                className={styles.inline}
                onSubmit={(e) => {
                  e.preventDefault()
                  void run(def.key, 'set:rate_limit', () =>
                    call('set', {
                      key: 'rate_limit',
                      mode: 'block',
                      config: { limit: Number(rateLimit), interval: Number(rateWindow) },
                    }),
                  )
                }}
              >
                <input
                  className={`${styles.input} ${styles.numInput}`}
                  value={rateLimit}
                  inputMode="numeric"
                  aria-label="Requests allowed"
                  onChange={(e) => setRateLimit(e.target.value.replace(/[^0-9]/g, ''))}
                />
                <SelectMenu className={styles.window} value={rateWindow} options={RATE_WINDOWS} aria-label="Window" onChange={setRateWindow} />
                <Button size="sm" variant="ghost" type="submit" pending={busy === 'set:rate_limit'} disabled={!Number(rateLimit)}>
                  {row?.mode === 'block' ? 'Save limit' : 'Switch on'}
                </Button>
              </form>
            ) : null}
            <p className={styles.note}>
              Counts every request from the organisation through Cloudflare. Requests over the limit are refused with a rate
              limit error until the window moves on.
            </p>
          </div>
        )
      }
      default:
        return null
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.top}>
        <div className={styles.topText}>
          <span className={styles.topTitle}>
            {inForce ? `${fmtCount(inForce)} guardrails in force` : 'No guardrails in force'}
          </span>
          <span className={styles.note}>
            Tests send a real one-token request through the gateway as the agent you pick. They are labelled as tests and
            left out of spend, counts and reports.
          </span>
        </div>
        {agentOptions.length ? (
          <label className={styles.picker}>
            <span className={styles.pickerLabel}>Test as</span>
            <SelectMenu className={styles.agent} value={agentId} options={agentOptions} aria-label="Agent for tests" onChange={setAgentId} />
          </label>
        ) : null}
      </div>

      {error ? <Notice tone="risk">{error}</Notice> : null}
      {!cloudflareReady ? (
        <Notice tone="warn">
          Cloudflare guardrails are not set up for this workspace yet, so data, prompt injection, harmful content and rate
          limit settings cannot be changed.
        </Notice>
      ) : null}
      {!data.setup.tests ? <Notice tone="quiet">Guardrail tests are not set up for this workspace yet.</Notice> : null}
      {!data.agents.length ? (
        <Notice tone="quiet">
          Add an Anthropic or Amazon Bedrock agent to the{' '}
          <Link to="/registry" className={styles.link}>
            registry
          </Link>{' '}
          and connect it to the gateway to run tests.
        </Notice>
      ) : null}

      {GUARDRAIL_GROUPS.map((group) => {
        const defs = GUARDRAILS.filter((g) => g.group === group.id)
        return (
          <section key={group.id} className={styles.group}>
            <header className={styles.groupHead}>
              <h3 className={styles.groupTitle}>{group.label}</h3>
              <p className={styles.note}>{group.line}</p>
            </header>
            <div className={styles.table} role="table" aria-label={group.label}>
              <div className={styles.head} role="row">
                <span role="columnheader">Guardrail</span>
                <span role="columnheader">Setting</span>
                <span role="columnheader">Last {GUARDRAIL_COUNT_DAYS} days</span>
                <span role="columnheader">Test</span>
              </div>
              {defs.map((def) => {
                const row = state.get(def.key)
                const expandable = EXPANDABLE.has(def.key)
                const isOpen = open.has(def.key)
                return (
                  <div key={def.key} className={styles.item} role="rowgroup">
                    <div className={styles.row} role="row">
                      <div className={styles.main} role="cell">
                        <span className={styles.name}>
                          {def.label}
                          {def.code ? <span className={styles.codeTag}>{def.code}</span> : null}
                        </span>
                        <span className={styles.line}>{def.line}</span>
                        <span className={styles.facts}>
                          Enforced by {enforcedByLabel(def)}
                          {evidenceLabel(def) ? ` · Evidence for ${evidenceLabel(def)}` : ''}
                          {row?.inherited ? ' · Flagged on the shared gateway' : ''}
                        </span>
                        {expandable ? (
                          <button
                            type="button"
                            className={styles.textBtn}
                            aria-expanded={isOpen}
                            onClick={() => toggle(def.key)}
                          >
                            {isOpen ? 'Hide' : detailLabel(def, row)}
                          </button>
                        ) : null}
                      </div>
                      <div role="cell">{OWN_CONTROLS.has(def.key) ? controls(def) : controls(def, row)}</div>
                      <div role="cell">{count(def)}</div>
                      <div role="cell">{testCell(def)}</div>
                    </div>
                    {rowError[def.key] ? (
                      <div className={styles.sub}>
                        <Notice tone="risk">{rowError[def.key]}</Notice>
                      </div>
                    ) : null}
                    {isOpen ? <div className={styles.sub}>{detail(def)}</div> : null}
                    {tests[def.key] && !tests[def.key].running ? <div className={styles.sub}>{testResult(def)}</div> : null}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}

      <section className={styles.group}>
        <header className={styles.groupHead}>
          <h3 className={styles.groupTitle}>Limits</h3>
        </header>
        <ul className={styles.limits}>
          <li>Guardrails apply to requests through the RegAnchor gateway. Calls made directly to a provider are not checked.</li>
          <li>
            RegAnchor guardrails apply as soon as you save. Cloudflare guardrails take up to about a minute to reach
            every Cloudflare location.
          </li>
          <li>
            Cloudflare checks add about half a second to each request. Checking responses holds a streamed response until
            the check finishes.
          </li>
          <li>
            Harmful content and prompt injection are judged by a safety model. It works best in English, French, German,
            Hindi, Italian, Portuguese, Spanish and Thai, and can miss or over-flag. Cloudflare bills these checks as
            Workers AI usage.
          </li>
          <li>
            {settings?.fail_mode === 'closed'
              ? 'If Cloudflare is unavailable, requests are refused, so Cloudflare guardrails are never skipped.'
              : 'If Cloudflare is unavailable, requests are sent direct to the provider and recorded as such. Cloudflare guardrails do not apply to those requests; RegAnchor guardrails still do.'}
          </li>
          <li>Prompts and responses are not stored by these checks. Only the finding, its category and the request record are kept.</li>
        </ul>
      </section>
    </div>
  )
}
