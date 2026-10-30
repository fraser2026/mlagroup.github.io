import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { clsx } from 'clsx'
import {
  Button,
  DataTable,
  Drawer,
  EmptyState,
  MetricStrip,
  Notice,
  SelectMenu,
  StatusLabel,
  UsageBars,
} from '../ui'
import type { Metric, UsageBar } from '../ui'
import { invokeEdge } from '../lib/edge'
import { fmtProviderTokens, labelProvider } from '../lib/registry'
import {
  GATEWAY_WINDOWS,
  costStatusHint,
  costStatusLabel,
  dlpDetections,
  dlpLabel,
  dlpProfileName,
  fmtMs,
  fmtTimeExact,
  fmtTimeShort,
  fmtUsdExact,
  fmtUsdFull,
  loadGatewayEvents,
  loadGatewaySummary,
  outcomeLabel,
  outcomeTone,
  prettyModel,
  routeLabel,
  type EventFilter,
  type GatewayEvent,
  type GatewaySettings,
  type GatewaySummary,
} from '../lib/gateway'
import styles from './GatewayActivity.module.css'

type Props = {
  orgId: string
  /** Omit for organisation scope (all agents). */
  assetId?: string | null
  provider?: string
  tokenNames?: Record<string, string>
  settings: GatewaySettings | null
  canViewContent: boolean
  accessToken?: string
  onSummary?: (summary: GatewaySummary | null) => void
}

const FILTERS: { value: EventFilter; label: string }[] = [
  { value: 'all', label: 'All requests' },
  { value: 'dlp', label: 'DLP findings' },
  { value: 'issues', label: 'Issues' },
]

const PAGE = 50

const COST_LINES: { key: string; label: string }[] = [
  { key: 'input', label: 'Input' },
  { key: 'output', label: 'Output' },
  { key: 'cache_write_5m', label: 'Cache writes, 5 minute' },
  { key: 'cache_write_1h', label: 'Cache writes, 1 hour' },
  { key: 'cache_read', label: 'Cache reads' },
  { key: 'web_search', label: 'Web search' },
]

function dayRange(days: number): string[] {
  const now = new Date()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Array.from({ length: days }, (_, i) =>
    new Date(today - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  )
}

function num(n: unknown) {
  return Number(n) || 0
}

type Block = { type?: string; text?: string }
type Message = { role?: string; content?: string | Block[] }

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as Block[])
      .map((b) => (b?.type === 'text' ? b.text || '' : b?.type ? `[${b.type.replace(/_/g, ' ')}]` : ''))
      .filter(Boolean)
      .join('\n\n')
  }
  return ''
}

type CapturedContent = {
  captured_at?: string | null
  streamed?: boolean
  request?: { system?: unknown; messages?: Message[] } | null
  response?: { content?: Block[] } | null
  response_text?: string | null
}

export function GatewayActivity({
  orgId,
  assetId = null,
  provider = 'anthropic',
  tokenNames = {},
  settings,
  canViewContent,
  accessToken,
  onSummary,
}: Props) {
  const orgScope = !assetId
  const [days, setDays] = useState(30)
  const [filter, setFilter] = useState<EventFilter>('all')
  const [summary, setSummary] = useState<GatewaySummary | null>(null)
  const [events, setEvents] = useState<GatewayEvent[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [moreBusy, setMoreBusy] = useState(false)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [selected, setSelected] = useState<GatewayEvent | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    Promise.all([
      loadGatewaySummary(orgId, assetId, days),
      loadGatewayEvents({ orgId, assetId, days, filter, limit: PAGE }),
    ])
      .then(([s, rows]) => {
        if (cancelled) return
        setSummary(s)
        setEvents(rows)
        setHasMore(rows.length === PAGE)
        onSummary?.(s)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Could not load gateway activity.')
        onSummary?.(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // onSummary is a parent callback; reloading on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, assetId, days, filter, reloadKey])

  async function loadMore() {
    const last = events[events.length - 1]
    if (!last) return
    setMoreBusy(true)
    try {
      const rows = await loadGatewayEvents({ orgId, assetId, days, filter, before: last.created_at, limit: PAGE })
      setEvents((prev) => [...prev, ...rows])
      setHasMore(rows.length === PAGE)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load more requests.')
    } finally {
      setMoreBusy(false)
    }
  }

  const assetNames = useMemo(() => {
    const map: Record<string, string> = {}
    for (const a of summary?.assets || []) map[a.asset_id] = a.name || 'Removed asset'
    return map
  }, [summary])

  const t = summary?.totals
  const metrics: Metric[] = t
    ? [
        { id: 'requests', label: 'Requests', value: num(t.requests).toLocaleString('en-GB') },
        {
          id: 'spend',
          label: 'Spend',
          value: <span title={fmtUsdFull(t.cost_usd)}>{fmtUsdExact(t.cost_usd)}</span>,
          hint: num(t.cost_open) ? `${num(t.cost_open)} awaiting reconciliation` : 'Exact, list rates',
        },
        {
          id: 'dlp',
          label: 'DLP findings',
          value: (num(t.flagged) + num(t.blocked)).toLocaleString('en-GB'),
          hint: num(t.blocked) ? `${num(t.blocked)} blocked` : num(t.flagged) ? 'Flagged, not blocked' : undefined,
        },
        {
          id: 'issues',
          label: 'Issues',
          value: (num(t.errors) + num(t.rate_limited)).toLocaleString('en-GB'),
          hint: num(t.fallback) ? `${num(t.fallback)} sent direct` : undefined,
        },
        {
          id: 'latency',
          label: 'Median latency',
          value: t.latency_p50_ms != null ? fmtMs(t.latency_p50_ms) : 'None yet',
          hint: t.latency_p95_ms != null ? `p95 ${fmtMs(t.latency_p95_ms)}` : undefined,
        },
        {
          id: 'tokens',
          label: 'Tokens',
          value: fmtProviderTokens(num(t.input_tokens) + num(t.output_tokens)),
          hint: `${fmtProviderTokens(t.input_tokens)} in, ${fmtProviderTokens(t.output_tokens)} out`,
        },
      ]
    : []

  const bars = useMemo<UsageBar[]>(() => {
    if (!summary || days < 7) return []
    const byDay = new Map(summary.daily.map((d) => [String(d.day).slice(0, 10), d]))
    return dayRange(days).map((date) => {
      const d = byDay.get(date)
      return {
        date,
        value: num(d?.cost_usd),
        detail: d ? (
          <>
            {num(d.requests).toLocaleString('en-GB')} {num(d.requests) === 1 ? 'request' : 'requests'}
            {num(d.dlp) ? <div>{num(d.dlp)} DLP</div> : null}
            {num(d.issues) ? <div>{num(d.issues)} {num(d.issues) === 1 ? 'issue' : 'issues'}</div> : null}
          </>
        ) : undefined,
      }
    })
  }, [summary, days])

  const columns = useMemo<ColumnDef<GatewayEvent, unknown>[]>(() => {
    const cols: ColumnDef<GatewayEvent, unknown>[] = [
      {
        id: 'time',
        header: 'Time',
        accessorFn: (e) => e.created_at,
        size: 140,
        cell: ({ row }) => (
          <span className={styles.num} title={fmtTimeExact(row.original.created_at)}>
            {fmtTimeShort(row.original.created_at)}
          </span>
        ),
      },
    ]
    if (orgScope) {
      cols.push({
        id: 'agent',
        header: 'Agent',
        accessorFn: (e) => assetNames[e.asset_id] || '',
        meta: { flex: true },
        cell: ({ row }) => <span className={styles.primary}>{assetNames[row.original.asset_id] || 'Agent'}</span>,
      })
    }
    cols.push(
      {
        id: 'model',
        header: 'Model',
        accessorFn: (e) => e.model || e.request_model || '',
        meta: orgScope ? undefined : { flex: true },
        size: orgScope ? 160 : undefined,
        cell: ({ row }) => (
          <span className={styles.primary}>{prettyModel(provider, row.original.model || row.original.request_model)}</span>
        ),
      },
      {
        id: 'outcome',
        header: 'Outcome',
        accessorFn: (e) => e.outcome,
        size: 160,
        cell: ({ row }) => (
          <StatusLabel tone={outcomeTone(row.original.outcome)}>{outcomeLabel(row.original.outcome)}</StatusLabel>
        ),
      },
      {
        id: 'dlp',
        header: 'DLP',
        accessorFn: (e) => e.dlp_action || '',
        size: 130,
        cell: ({ row }) =>
          row.original.dlp_action ? (
            <StatusLabel tone={row.original.dlp_action === 'BLOCK' ? 'risk' : 'warn'}>
              {row.original.dlp_action === 'BLOCK' ? 'Blocked' : 'Flagged'}
            </StatusLabel>
          ) : (
            <span className={styles.quiet}>{row.original.route === 'ai_gateway' ? 'None' : 'Not checked'}</span>
          ),
      },
      {
        id: 'tokens',
        header: 'Tokens',
        accessorFn: (e) => num(e.input_tokens) + num(e.output_tokens),
        size: 110,
        cell: ({ row }) => (
          <span className={styles.num}>
            {fmtProviderTokens(row.original.input_tokens)} / {fmtProviderTokens(row.original.output_tokens)}
          </span>
        ),
      },
      {
        id: 'cost',
        header: 'Cost',
        accessorFn: (e) => num(e.cost_usd),
        size: 110,
        cell: ({ row }) => {
          const e = row.original
          if (e.cost_status === 'unpriced') return <span className={styles.quiet}>Unpriced</span>
          return (
            <span className={styles.num} title={`${fmtUsdFull(e.cost_usd)} · ${costStatusLabel(e.cost_status)}`}>
              {fmtUsdExact(e.cost_usd)}
              {e.cost_status === 'needs_reconciliation' || e.cost_status === 'partial' ? (
                <span className={styles.quiet}> est.</span>
              ) : null}
            </span>
          )
        },
      },
      {
        id: 'latency',
        header: 'Latency',
        accessorFn: (e) => num(e.latency_ms),
        size: 90,
        cell: ({ row }) => <span className={styles.num}>{fmtMs(row.original.latency_ms)}</span>,
      },
    )
    return cols
  }, [orgScope, assetNames, provider])

  const capture = settings?.capture_content
    ? `Prompt capture on, kept ${settings.content_retention_days} days`
    : 'Prompt capture off'

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <div className={styles.filters} role="tablist" aria-label="Filter requests">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              className={clsx(styles.filter, filter === f.value && styles.filterOn)}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className={styles.toolbarEnd}>
          <span className={styles.meta}>{capture}</span>
          <SelectMenu
            className={styles.window}
            value={String(days)}
            options={GATEWAY_WINDOWS}
            onChange={(v) => setDays(Number(v))}
          />
          <Button variant="ghost" size="sm" pending={loading && !!summary} onClick={() => setReloadKey((k) => k + 1)}>
            Refresh
          </Button>
        </div>
      </div>

      {error ? <Notice tone="risk">{error}</Notice> : null}

      {metrics.length ? <MetricStrip items={metrics} /> : null}

      {bars.length && num(t?.requests) > 0 ? (
        <UsageBars
          bars={bars}
          formatValue={fmtUsdExact}
          color="var(--ra-blurple)"
          label={`Daily spend over the last ${days} days`}
          emptyLabel="No spend in this window"
        />
      ) : null}

      {orgScope && summary && (summary.assets.length || summary.models.length) ? (
        <div className={styles.split}>
          <section className={styles.panel}>
            <header className={styles.panelHead}>
              <span className={styles.panelTitle}>By agent</span>
              <span className={styles.meta}>Spend</span>
            </header>
            <ul className={styles.rank}>
              {summary.assets.slice(0, 8).map((a) => (
                <li key={a.asset_id}>
                  <Link to={`/registry/${a.asset_id}?tab=connection`} className={styles.rankName}>
                    {a.name || 'Removed asset'}
                  </Link>
                  <span className={styles.rankMeta}>
                    {num(a.requests).toLocaleString('en-GB')} req
                    {num(a.dlp) ? <StatusLabel tone="warn">{num(a.dlp)} DLP</StatusLabel> : null}
                  </span>
                  <span className={styles.num} title={fmtUsdFull(a.cost_usd)}>
                    {fmtUsdExact(a.cost_usd)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className={styles.panel}>
            <header className={styles.panelHead}>
              <span className={styles.panelTitle}>By model</span>
              <span className={styles.meta}>Spend</span>
            </header>
            <ul className={styles.rank}>
              {summary.models.slice(0, 8).map((m) => (
                <li key={m.model}>
                  <span className={styles.rankName}>{prettyModel(provider, m.model)}</span>
                  <span className={styles.rankMeta}>{num(m.requests).toLocaleString('en-GB')} req</span>
                  <span className={styles.num} title={fmtUsdFull(m.cost_usd)}>
                    {fmtUsdExact(m.cost_usd)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      <div className={styles.tableWrap}>
        <DataTable
          data={events}
          columns={columns}
          getRowId={(e) => e.id}
          onRowClick={setSelected}
          empty={
            loading ? null : (
              <EmptyState
                title={
                  filter === 'dlp' ? 'No DLP findings' : filter === 'issues' ? 'No issues' : 'No gateway requests yet'
                }
                body={
                  filter === 'all'
                    ? orgScope
                      ? 'Requests appear here once an agent calls the RegAnchor gateway with its token.'
                      : 'Requests appear here once this asset calls the gateway with one of its tokens.'
                    : `Nothing in the selected window.`
                }
              />
            )
          }
        />
        {hasMore ? (
          <div className={styles.more}>
            <Button variant="ghost" size="sm" pending={moreBusy} onClick={() => void loadMore()}>
              Load more
            </Button>
          </div>
        ) : null}
      </div>

      <RequestDrawer
        event={selected}
        onClose={() => setSelected(null)}
        provider={provider}
        agentName={selected ? assetNames[selected.asset_id] : undefined}
        tokenName={selected?.token_id ? tokenNames[selected.token_id] : undefined}
        settings={settings}
        canViewContent={canViewContent}
        accessToken={accessToken}
      />
    </div>
  )
}

function CopyValue({ value }: { value?: string | null }) {
  const [copied, setCopied] = useState(false)
  if (!value) return <span className={styles.quiet}>Not recorded</span>
  return (
    <span className={styles.copyRow}>
      <code className={styles.code} title={value}>
        {value}
      </code>
      <button
        type="button"
        className={styles.copyBtn}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          })
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  )
}

function RequestDrawer({
  event,
  onClose,
  provider,
  agentName,
  tokenName,
  settings,
  canViewContent,
  accessToken,
}: {
  event: GatewayEvent | null
  onClose: () => void
  provider: string
  agentName?: string
  tokenName?: string
  settings: GatewaySettings | null
  canViewContent: boolean
  accessToken?: string
}) {
  const [content, setContent] = useState<CapturedContent | null>(null)
  const [contentBusy, setContentBusy] = useState(false)
  const [contentError, setContentError] = useState('')

  useEffect(() => {
    setContent(null)
    setContentError('')
  }, [event?.id])

  async function openContent() {
    if (!event || !accessToken) return
    setContentBusy(true)
    setContentError('')
    try {
      setContent(await invokeEdge<CapturedContent>('gateway-content', { event_id: event.id }, accessToken))
    } catch (e) {
      setContentError(e instanceof Error ? e.message : 'Could not load captured content.')
    } finally {
      setContentBusy(false)
    }
  }

  const e = event
  const lines = e?.cost_breakdown?.lines || {}
  const shownLines = COST_LINES.filter((l) => num(lines[l.key]) > 0)
  const detections = dlpDetections(e?.dlp)
  const model = e ? prettyModel(provider, e.model || e.request_model) : ''
  const requestedOther = e?.request_model && e.model && e.request_model !== e.model

  const usageRows: [string, number | null | undefined][] = e
    ? [
        ['Input', e.input_tokens],
        ['Output', e.output_tokens],
        ['Thinking, within output', e.thinking_tokens],
        ['Cache writes, 5 minute', e.cache_write_5m_tokens],
        ['Cache writes, 1 hour', e.cache_write_1h_tokens],
        ['Cache reads', e.cache_read_tokens],
        ['Web searches', e.web_search_requests],
        ['Web fetches', e.web_fetch_requests],
        ['Code executions', e.code_execution_requests],
      ]
    : []

  return (
    <Drawer
      open={!!e}
      onClose={onClose}
      title="Request details"
      variant="preview"
      headerMeta={
        e ? (
          <span className={styles.drawerMeta}>
            <StatusLabel badge tone={outcomeTone(e.outcome)}>
              {outcomeLabel(e.outcome)}
            </StatusLabel>
            <span className={styles.num}>{fmtTimeExact(e.created_at)}</span>
          </span>
        ) : undefined
      }
    >
      {e ? (
        <div className={styles.detail}>
          <section className={styles.block}>
            <dl className={styles.kv}>
              {agentName ? (
                <>
                  <dt>Agent</dt>
                  <dd>{agentName}</dd>
                </>
              ) : null}
              <dt>Model</dt>
              <dd>
                {model}
                {requestedOther ? (
                  <span className={styles.quiet}> (requested {prettyModel(provider, e.request_model)})</span>
                ) : null}
              </dd>
              <dt>Provider</dt>
              <dd>{labelProvider(e.provider)}</dd>
              <dt>Token</dt>
              <dd>
                {tokenName ||
                  (e.token_id ? <span className={styles.num}>{e.token_id.slice(0, 8)}</span> : 'None')}
              </dd>
              <dt>Route</dt>
              <dd>{routeLabel(e.route)}</dd>
              <dt>Status</dt>
              <dd className={styles.num}>
                {e.http_status ?? 'Not recorded'}
                {e.error_type ? <span className={styles.quiet}> · {e.error_type.replace(/_/g, ' ')}</span> : null}
              </dd>
              <dt>Latency</dt>
              <dd className={styles.num}>
                {fmtMs(e.latency_ms)}
                <span className={styles.quiet}> first byte · {fmtMs(e.duration_ms)} total</span>
              </dd>
              <dt>Delivery</dt>
              <dd>{e.streamed ? 'Streamed' : 'Single response'}</dd>
            </dl>
          </section>

          <section className={styles.block}>
            <div className={styles.blockHead}>
              <span className={styles.blockTitle}>Cost</span>
              <StatusLabel tone={e.cost_status === 'priced' ? 'ok' : e.cost_status === 'not_billable' ? 'neutral' : 'warn'}>
                {costStatusLabel(e.cost_status)}
              </StatusLabel>
            </div>
            <div className={styles.costTotal}>
              <span className={styles.costValue}>
                {e.cost_status === 'unpriced' ? 'Unpriced' : fmtUsdExact(e.cost_usd)}
              </span>
              {e.cost_status !== 'unpriced' ? <span className={styles.quiet}>{fmtUsdFull(e.cost_usd)}</span> : null}
            </div>
            {costStatusHint(e.cost_status) ? <p className={styles.hint}>{costStatusHint(e.cost_status)}</p> : null}
            {shownLines.length ? (
              <ul className={styles.lines}>
                {shownLines.map((l) => (
                  <li key={l.key}>
                    <span>{l.label}</span>
                    <span className={styles.num}>{fmtUsdFull(lines[l.key])}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {e.cost_breakdown?.input_per_mtok != null ? (
              <p className={styles.hint}>
                Rates per million tokens: input ${e.cost_breakdown.input_per_mtok}, output $
                {e.cost_breakdown.output_per_mtok}
                {e.cost_breakdown.rate_basis && e.cost_breakdown.rate_basis !== 'standard'
                  ? `, ${e.cost_breakdown.rate_basis.replace(/_/g, ' ')} rate`
                  : ''}
                {num(e.cost_breakdown.region_multiplier) > 1
                  ? `, region ×${e.cost_breakdown.region_multiplier}`
                  : ''}
                .
              </p>
            ) : null}
            {e.cost_breakdown?.notes?.length ? (
              <ul className={styles.notes}>
                {e.cost_breakdown.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className={styles.block}>
            <span className={styles.blockTitle}>Usage</span>
            <ul className={styles.lines}>
              {usageRows
                .filter(([label, v]) => num(v) > 0 || label === 'Input' || label === 'Output')
                .map(([label, v]) => (
                  <li key={label}>
                    <span>{label}</span>
                    <span className={styles.num}>{num(v).toLocaleString('en-GB')}</span>
                  </li>
                ))}
            </ul>
            {e.service_tier || e.inference_geo || e.speed ? (
              <p className={styles.hint}>
                {[
                  e.service_tier ? `Tier ${e.service_tier}` : '',
                  e.inference_geo ? `region ${e.inference_geo}` : '',
                  e.speed ? `${e.speed} speed` : '',
                ]
                  .filter(Boolean)
                  .join(', ')}
              </p>
            ) : null}
          </section>

          <section className={styles.block}>
            <div className={styles.blockHead}>
              <span className={styles.blockTitle}>Data loss prevention</span>
              {e.dlp_action ? (
                <StatusLabel tone={e.dlp_action === 'BLOCK' ? 'risk' : 'warn'}>{dlpLabel(e)}</StatusLabel>
              ) : e.route === 'ai_gateway' ? (
                <StatusLabel tone="ok">No findings</StatusLabel>
              ) : (
                <StatusLabel tone="warn">Not checked</StatusLabel>
              )}
            </div>
            {e.dlp?.findings?.length ? (
              <ul className={styles.findings}>
                {e.dlp.findings.map((f, i) => (
                  <li key={`${f.profile?.profile_id}-${i}`}>
                    <span className={styles.primary}>
                      {f.check === 'RESPONSE' ? 'Response' : 'Prompt'}: {dlpProfileName(f.profile?.profile_id)}
                    </span>
                    {f.policy_ids?.length ? (
                      <span className={styles.quiet}>Policy {f.policy_ids.join(', ')}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {detections.length ? <p className={styles.hint}>Detected: {detections.join(', ')}</p> : null}
            {!e.dlp_action ? (
              <p className={styles.hint}>
                {e.route === 'ai_gateway'
                  ? 'Checked by Cloudflare AI Gateway on the prompt and the response.'
                  : 'This request did not pass through Cloudflare AI Gateway, so DLP policies were not applied.'}
              </p>
            ) : null}
          </section>

          <section className={styles.block}>
            <span className={styles.blockTitle}>Prompt and response</span>
            {!e.content_captured ? (
              <p className={styles.hint}>
                {settings?.capture_content
                  ? 'Not captured for this request.'
                  : 'Not captured. Prompt capture is off for this organisation, so only metadata is recorded.'}
              </p>
            ) : !canViewContent ? (
              <p className={styles.hint}>Captured. Organisation owners and admins can view it.</p>
            ) : content ? (
              <div className={styles.transcript}>
                {textOf(content.request?.system) ? (
                  <div className={styles.turn}>
                    <span className={styles.turnRole}>System</span>
                    <pre className={styles.turnText}>{textOf(content.request?.system)}</pre>
                  </div>
                ) : null}
                {(content.request?.messages || []).map((m, i) => (
                  <div key={i} className={styles.turn}>
                    <span className={styles.turnRole}>{m.role === 'assistant' ? 'Assistant' : 'User'}</span>
                    <pre className={styles.turnText}>{textOf(m.content)}</pre>
                  </div>
                ))}
                <div className={styles.turn}>
                  <span className={styles.turnRole}>Response</span>
                  <pre className={styles.turnText}>
                    {content.response_text || textOf(content.response?.content) || 'No text in the response.'}
                  </pre>
                </div>
                <p className={styles.hint}>This view was recorded in the asset audit log.</p>
              </div>
            ) : (
              <>
                <p className={styles.hint}>
                  Captured in private storage for {settings?.content_retention_days ?? 30} days. Opening it is
                  recorded in the asset audit log.
                </p>
                <div>
                  <Button variant="ghost" size="sm" pending={contentBusy} onClick={() => void openContent()}>
                    View prompt and response
                  </Button>
                </div>
              </>
            )}
            {contentError ? <Notice tone="risk">{contentError}</Notice> : null}
          </section>

          <section className={styles.block}>
            <span className={styles.blockTitle}>Identifiers</span>
            <dl className={styles.kv}>
              <dt>Request</dt>
              <dd>
                <CopyValue value={e.id} />
              </dd>
              <dt>{labelProvider(e.provider)}</dt>
              <dd>
                <CopyValue value={e.provider_request_id} />
              </dd>
              <dt>Cloudflare log</dt>
              <dd>
                <CopyValue value={e.aig_log_id} />
              </dd>
            </dl>
          </section>
        </div>
      ) : null}
    </Drawer>
  )
}
