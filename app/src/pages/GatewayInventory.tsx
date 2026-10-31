import { useEffect, useMemo, useState } from 'react'
import { Notice, SelectMenu, StatusLabel, type StatusTone } from '../ui'
import {
  fmtTimeShort,
  LEARNING_DAYS,
  loadInventory,
  prettyModel,
  toolLabel,
  type InventoryAgent,
  type InventoryItem,
} from '../lib/gateway'
import styles from './GatewayInventory.module.css'

type Props = { orgId: string }

type KindFilter = 'all' | 'model' | 'tool'

const KIND_OPTIONS = [
  { value: 'all', label: 'Models and tools' },
  { value: 'model', label: 'Models' },
  { value: 'tool', label: 'Tools' },
]

const DAY_MS = 86_400_000

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function itemStatus(item: InventoryItem, learnedAt: number | null, now: number): { label: string; tone: StatusTone } {
  const first = Date.parse(item.first_seen_at)
  if (learnedAt !== null && first >= learnedAt && now - first < LEARNING_DAYS * DAY_MS) {
    return { label: 'New', tone: 'warn' }
  }
  if (item.kind === 'tool' && !item.first_called_at) return { label: 'Offered, not called', tone: 'neutral' }
  return { label: 'In use', tone: 'neutral' }
}

export function GatewayInventory({ orgId }: Props) {
  const [items, setItems] = useState<InventoryItem[] | null>(null)
  const [agents, setAgents] = useState<InventoryAgent[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')
  const [agent, setAgent] = useState('all')

  useEffect(() => {
    let cancelled = false
    loadInventory(orgId)
      .then((r) => {
        if (cancelled) return
        setItems(r.items)
        setAgents(r.agents)
        setNames(r.names)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load models and tools.')
      })
    return () => {
      cancelled = true
    }
  }, [orgId])

  const learnedAt = useMemo(() => {
    const map: Record<string, number> = {}
    for (const a of agents) map[a.asset_id] = Date.parse(a.learning_started_at) + LEARNING_DAYS * DAY_MS
    return map
  }, [agents])

  const agentOptions = useMemo(() => {
    const ids = [...new Set((items || []).map((i) => i.asset_id))]
    return [
      { value: 'all', label: 'All agents' },
      ...ids
        .map((id) => ({ value: id, label: names[id] || 'Unnamed agent' }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ]
  }, [items, names])

  if (error) return <Notice tone="risk">{error}</Notice>
  if (!items) return null

  const now = Date.now()
  const learning = agents
    .filter((a) => (learnedAt[a.asset_id] ?? 0) > now)
    .map((a) => ({ name: names[a.asset_id] || 'Unnamed agent', until: learnedAt[a.asset_id] }))
    .sort((a, b) => a.until - b.until)
  const rows = items.filter((i) => (kind === 'all' || i.kind === kind) && (agent === 'all' || i.asset_id === agent))

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.meta}>
          Every model and tool each agent has used through the gateway. Tool names only; inputs and results are not
          recorded.
        </span>
        {items.length ? (
          <div className={styles.filters}>
            {agentOptions.length > 2 ? (
              <SelectMenu value={agent} options={agentOptions} aria-label="Agent" onChange={setAgent} />
            ) : null}
            <SelectMenu
              value={kind}
              options={KIND_OPTIONS}
              aria-label="Show"
              onChange={(v) => setKind(v as KindFilter)}
            />
          </div>
        ) : null}
      </div>

      {learning.length ? (
        <p className={styles.note}>
          Still learning what is normal:{' '}
          {learning.map((l, i) => (
            <span key={l.name + i}>
              {i ? ', ' : ''}
              {l.name} until <span className={styles.num}>{fmtDay(new Date(l.until).toISOString())}</span>
            </span>
          ))}
          . New models and tools for {learning.length === 1 ? 'this agent' : 'these agents'} raise notifications after
          that.
        </p>
      ) : null}

      {rows.length ? (
        <div className={styles.table} role="table" aria-label="Models and tools">
          <div className={styles.row} role="row">
            <span role="columnheader">Agent</span>
            <span role="columnheader">Type</span>
            <span role="columnheader">Name</span>
            <span role="columnheader">First seen</span>
            <span role="columnheader">Last seen</span>
            <span role="columnheader">Status</span>
          </div>
          {rows.map((item) => {
            const status = itemStatus(item, learnedAt[item.asset_id] ?? null, now)
            const tool = item.kind === 'tool' ? toolLabel(item.name) : null
            return (
              <div key={`${item.asset_id}:${item.kind}:${item.name}`} className={styles.row} role="row">
                <span role="cell" className={styles.ellipsis}>
                  {names[item.asset_id] || 'Unnamed agent'}
                </span>
                <span role="cell" className={styles.secondary}>
                  {item.kind === 'model' ? 'Model' : 'Tool'}
                </span>
                <span role="cell" className={styles.name} title={item.name}>
                  <span className={styles.ellipsis}>{tool ? tool.name : prettyModel('anthropic', item.name)}</span>
                  {tool?.via ? <span className={styles.via}>{tool.via}</span> : null}
                </span>
                <span role="cell" className={styles.num} title={new Date(item.first_seen_at).toISOString()}>
                  {fmtTimeShort(item.first_seen_at)}
                </span>
                <span
                  role="cell"
                  className={styles.num}
                  title={item.last_called_at ? `Last called ${fmtTimeShort(item.last_called_at)}` : undefined}
                >
                  {fmtTimeShort(item.last_seen_at)}
                </span>
                <span role="cell">
                  <StatusLabel tone={status.tone}>{status.label}</StatusLabel>
                </span>
              </div>
            )
          })}
        </div>
      ) : (
        <p className={styles.empty}>
          {items.length
            ? 'Nothing matches this filter.'
            : 'Nothing recorded yet. Models and tools appear here after an agent’s first request through the gateway.'}
        </p>
      )}

      <p className={styles.note}>
        Tools are recorded when a request offers them to the model and when the model asks to call one. Connected MCP
        servers show as MCP with the server name. Last seen updates at most once an hour. After an agent&apos;s first{' '}
        {LEARNING_DAYS} days, a model or tool it has not used before raises a notification, and an email if monitoring
        alert emails are on in Settings.
      </p>
    </div>
  )
}
