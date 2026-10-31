// Reconciles gateway records against the provider's usage and cost analytics.
// Money is held as bigint units of 1e-8 USD: provider amounts arrive as cent strings with six
// decimals and gateway costs are numeric(18,8), so both convert without rounding.

export const UNITS_PER_USD = 100_000_000n

export const USAGE_FIELDS = [
  'uncached_input',
  'cache_write_5m',
  'cache_write_1h',
  'cache_read',
  'output',
  'web_search',
] as const
export type UsageField = typeof USAGE_FIELDS[number]
export type UsageCounts = Record<UsageField, number> & { requests: number }

// Charges the gateway prices per request. Other provider cost types (code execution hours,
// sessions) are billed outside requests and reported separately.
const REQUEST_COST_TYPES = new Set(['tokens', 'web_search'])

export type ReconcileStatus =
  | 'matched'
  | 'provider_higher'
  | 'recorded_higher'
  | 'cost_difference'
  | 'provider_pending'

export type ProviderUsageRow = { day: string; api_key_id: string; model: string; usage: UsageCounts }
export type ProviderCostRow = {
  day: string
  api_key_id: string
  model: string
  cost_type: string
  amount: bigint
  list_amount: bigint
}
export type RecordedRow = {
  api_key_id: string | null
  day: string
  model: string
  asset_id: string
  events: number
  requests: number
  uncached_input: number
  cache_write_5m: number
  cache_write_1h: number
  cache_read: number
  output: number
  web_search: number
  cost_usd: string
  priority_cost_usd: string
  unpriced: number
  open_cost: number
  incomplete: number
  priority: number
}

export type ModelDetail = {
  model: string
  provider_usage: UsageCounts
  recorded_usage: UsageCounts
  provider_list_usd: string
  provider_billed_usd: string
  recorded_usd: string
}

export type DayResult = {
  api_key_id: string
  day: string
  asset_ids: string[]
  status: ReconcileStatus
  final: boolean
  provider_usage: UsageCounts
  recorded_usage: UsageCounts & { events: number; unpriced: number; open_cost: number; incomplete: number; priority: number }
  provider_list_usd: string
  provider_billed_usd: string
  provider_other_list_usd: string
  provider_other_billed_usd: string
  recorded_usd: string
  recorded_priority_usd: string
  variance_usd: string
  tolerance_usd: string
  models: ModelDetail[]
  notes: string[]
  data_refreshed_at: string | null
}

export function emptyUsage(): UsageCounts {
  return { requests: 0, uncached_input: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0, output: 0, web_search: 0 }
}

function addUsage(into: UsageCounts, from: Partial<UsageCounts>) {
  into.requests += from.requests || 0
  for (const f of USAGE_FIELDS) into[f] += from[f] || 0
}

/** Exact decimal string to bigint units with the given number of fractional digits. */
function decimalToUnits(value: unknown, scale: number): bigint {
  const raw = String(value ?? '').trim()
  if (!raw) return 0n
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(raw)
  if (!m) throw new Error(`Unexpected amount format: ${raw.slice(0, 32)}`)
  const whole = m[2] || '0'
  const frac = m[3] || ''
  if (frac.length > scale && /[1-9]/.test(frac.slice(scale))) {
    throw new Error(`Amount has more precision than expected: ${raw.slice(0, 32)}`)
  }
  const units = BigInt(whole) * 10n ** BigInt(scale) + BigInt((frac.slice(0, scale) || '0').padEnd(scale, '0'))
  return m[1] ? -units : units
}

/** USD decimal string (up to 8 dp) to 1e-8 units. */
export function usdToUnits(value: unknown): bigint {
  return decimalToUnits(value, 8)
}

/** Provider cent string (up to 6 dp) to 1e-8 USD units: one millionth of a cent is one unit. */
export function centsToUnits(value: unknown): bigint {
  return decimalToUnits(value, 6)
}

export function unitsToUsd(units: bigint): string {
  const neg = units < 0n
  const abs = neg ? -units : units
  const whole = abs / UNITS_PER_USD
  const frac = (abs % UNITS_PER_USD).toString().padStart(8, '0')
  return `${neg ? '-' : ''}${whole}.${frac}`
}

function n(value: unknown): number {
  const v = Number(value)
  return Number.isFinite(v) ? v : 0
}

function dayOf(iso: unknown): string {
  return String(iso || '').slice(0, 10)
}

type Rec = Record<string, unknown>
const obj = (v: unknown): Rec => (v && typeof v === 'object' ? v as Rec : {})

export function parseUsageRows(data: unknown[]): ProviderUsageRow[] {
  return data.map((row) => {
    const r = obj(row)
    const group = obj(r.group)
    const usage = obj(r.usage)
    const creation = obj(usage.cache_creation)
    const tools = obj(usage.server_tool_use)
    return {
      day: dayOf(r.starting_at),
      api_key_id: String(group.api_key_id ?? ''),
      model: String(group.model ?? ''),
      usage: {
        requests: n(usage.requests),
        uncached_input: n(usage.uncached_input_tokens),
        cache_write_5m: n(creation.ephemeral_5m_input_tokens),
        cache_write_1h: n(creation.ephemeral_1h_input_tokens),
        cache_read: n(usage.cache_read_input_tokens),
        output: n(usage.output_tokens),
        web_search: n(tools.web_search_requests),
      },
    }
  })
}

export function parseCostRows(data: unknown[]): ProviderCostRow[] {
  return data.map((row) => {
    const r = obj(row)
    const group = obj(r.group)
    const cost = obj(r.cost)
    const currency = String(cost.currency || 'USD')
    if (currency !== 'USD') throw new Error(`Unexpected provider cost currency: ${currency.slice(0, 8)}`)
    return {
      day: dayOf(r.starting_at),
      api_key_id: String(group.api_key_id ?? ''),
      model: String(group.model ?? ''),
      cost_type: String(group.cost_type ?? ''),
      amount: centsToUnits(cost.amount),
      list_amount: centsToUnits(cost.list_amount),
    }
  })
}

function dayEnd(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) + 24 * 60 * 60 * 1000
}

/** Provider figures stop changing about seven days after the calendar month ends. */
export function isFinal(day: string, now: Date): boolean {
  const d = new Date(`${day}T00:00:00Z`)
  const settle = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 8)
  return now.getTime() >= settle
}

type ModelAcc = {
  provider_usage: UsageCounts
  recorded_usage: UsageCounts
  list: bigint
  billed: bigint
  recorded: bigint
}

type DayAcc = {
  api_key_id: string
  day: string
  assets: Set<string>
  provider: UsageCounts
  recorded: UsageCounts
  events: number
  unpriced: number
  open_cost: number
  incomplete: number
  priority: number
  list: bigint
  billed: bigint
  otherList: bigint
  otherBilled: bigint
  recordedUnits: bigint
  priorityUnits: bigint
  models: Map<string, ModelAcc>
}

function fmtUsdNote(units: bigint): string {
  const usd = Number(units) / Number(UNITS_PER_USD)
  if (usd >= 1) return `$${usd.toFixed(2)}`
  return `$${usd.toPrecision(3).replace(/0+$/, '').replace(/\.$/, '')}`
}

export function reconcileDays(input: {
  providerUsage: ProviderUsageRow[]
  providerCost: ProviderCostRow[]
  recorded: RecordedRow[]
  keys: Iterable<string>
  keyAssets?: Map<string, string[]>
  refreshedFor: (day: string) => string | null
  now: Date
}): DayResult[] {
  const keys = new Set(input.keys)
  const days = new Map<string, DayAcc>()
  const acc = (apiKeyId: string, day: string): DayAcc => {
    const id = `${apiKeyId}|${day}`
    let d = days.get(id)
    if (!d) {
      d = {
        api_key_id: apiKeyId,
        day,
        assets: new Set(input.keyAssets?.get(apiKeyId) || []),
        provider: emptyUsage(),
        recorded: emptyUsage(),
        events: 0,
        unpriced: 0,
        open_cost: 0,
        incomplete: 0,
        priority: 0,
        list: 0n,
        billed: 0n,
        otherList: 0n,
        otherBilled: 0n,
        recordedUnits: 0n,
        priorityUnits: 0n,
        models: new Map(),
      }
      days.set(id, d)
    }
    return d
  }
  const model = (d: DayAcc, name: string): ModelAcc => {
    let m = d.models.get(name)
    if (!m) {
      m = { provider_usage: emptyUsage(), recorded_usage: emptyUsage(), list: 0n, billed: 0n, recorded: 0n }
      d.models.set(name, m)
    }
    return m
  }

  for (const row of input.providerUsage) {
    if (!keys.has(row.api_key_id) || !row.day) continue
    const d = acc(row.api_key_id, row.day)
    addUsage(d.provider, row.usage)
    addUsage(model(d, row.model).provider_usage, row.usage)
  }

  for (const row of input.providerCost) {
    if (!keys.has(row.api_key_id) || !row.day) continue
    const d = acc(row.api_key_id, row.day)
    if (REQUEST_COST_TYPES.has(row.cost_type)) {
      d.list += row.list_amount
      d.billed += row.amount
      const m = model(d, row.model)
      m.list += row.list_amount
      m.billed += row.amount
    } else {
      d.otherList += row.list_amount
      d.otherBilled += row.amount
    }
  }

  for (const row of input.recorded) {
    if (!row.api_key_id || !keys.has(row.api_key_id)) continue
    const d = acc(row.api_key_id, row.day)
    d.assets.add(row.asset_id)
    const usage = {
      requests: n(row.requests),
      uncached_input: n(row.uncached_input),
      cache_write_5m: n(row.cache_write_5m),
      cache_write_1h: n(row.cache_write_1h),
      cache_read: n(row.cache_read),
      output: n(row.output),
      web_search: n(row.web_search),
    }
    addUsage(d.recorded, usage)
    d.events += n(row.events)
    d.unpriced += n(row.unpriced)
    d.open_cost += n(row.open_cost)
    d.incomplete += n(row.incomplete)
    d.priority += n(row.priority)
    const cost = usdToUnits(row.cost_usd)
    d.recordedUnits += cost
    d.priorityUnits += usdToUnits(row.priority_cost_usd)
    const m = model(d, row.model)
    addUsage(m.recorded_usage, usage)
    m.recorded += cost
  }

  const results: DayResult[] = []
  for (const d of days.values()) {
    const providerEmpty = USAGE_FIELDS.every((f) => d.provider[f] === 0) && d.list === 0n && d.otherList === 0n
    if (providerEmpty && d.events === 0) continue

    const refreshed = input.refreshedFor(d.day)
    const pending = !refreshed || dayEnd(d.day) > Date.parse(refreshed)
    const recordedHigher = USAGE_FIELDS.some((f) => d.recorded[f] > d.provider[f])
    const providerHigher = USAGE_FIELDS.some((f) => d.provider[f] > d.recorded[f])
    const comparable = d.recordedUnits - d.priorityUnits
    const variance = comparable - d.list
    const tolerance = 100n + BigInt(Math.max(d.events, d.provider.requests))
    const absVariance = variance < 0n ? -variance : variance

    let status: ReconcileStatus
    if (pending) status = 'provider_pending'
    else if (recordedHigher) status = 'recorded_higher'
    else if (providerHigher) status = 'provider_higher'
    else if (absVariance > tolerance) status = 'cost_difference'
    else status = 'matched'

    const notes: string[] = []
    if (pending) {
      notes.push('The provider has not finished reporting this day yet. It is checked again on the next run.')
    }
    if (status === 'provider_higher') {
      notes.push(d.incomplete > 0
        ? `${d.incomplete} response${d.incomplete === 1 ? '' : 's'} ended early (cancelled or interrupted). The provider bills tokens generated after the gateway stopped reading, so some difference is expected.`
        : 'The provider reports more usage on this key than passed through the gateway. Requests made with this key outside RegAnchor show up here.')
    }
    if (status === 'recorded_higher') {
      notes.push('The gateway recorded more usage than the provider reports for this key. Requests that span midnight UTC can land on different days; a key change on this day can also cause it.')
    }
    if (status === 'cost_difference') {
      notes.push('Token counts match but the list price differs. The price table may be out of date for a model used on this day.')
    }
    if (d.priority > 0) {
      notes.push(`${d.priority} priority tier request${d.priority === 1 ? '' : 's'}: covered by your commitment, so the provider reports no token cost. Their list price is left out of the comparison.`)
    }
    if (d.unpriced > 0) {
      notes.push(`${d.unpriced} request${d.unpriced === 1 ? '' : 's'} had no list price on record, so recorded cost is incomplete.`)
    }
    if (d.otherList > 0n) {
      notes.push(`Charges billed outside requests (code execution hours, sessions): ${fmtUsdNote(d.otherBilled)} billed. Not compared.`)
    }

    const models: ModelDetail[] = [...d.models.entries()]
      .map(([name, m]) => ({
        model: name,
        provider_usage: m.provider_usage,
        recorded_usage: m.recorded_usage,
        provider_list_usd: unitsToUsd(m.list),
        provider_billed_usd: unitsToUsd(m.billed),
        recorded_usd: unitsToUsd(m.recorded),
      }))
      .sort((a, b) => a.model.localeCompare(b.model))

    results.push({
      api_key_id: d.api_key_id,
      day: d.day,
      asset_ids: [...d.assets].sort(),
      status,
      final: !pending && isFinal(d.day, input.now),
      provider_usage: d.provider,
      recorded_usage: {
        ...d.recorded,
        events: d.events,
        unpriced: d.unpriced,
        open_cost: d.open_cost,
        incomplete: d.incomplete,
        priority: d.priority,
      },
      provider_list_usd: unitsToUsd(d.list),
      provider_billed_usd: unitsToUsd(d.billed),
      provider_other_list_usd: unitsToUsd(d.otherList),
      provider_other_billed_usd: unitsToUsd(d.otherBilled),
      recorded_usd: unitsToUsd(d.recordedUnits),
      recorded_priority_usd: unitsToUsd(d.priorityUnits),
      variance_usd: unitsToUsd(variance),
      tolerance_usd: unitsToUsd(tolerance),
      models,
      notes,
      data_refreshed_at: refreshed,
    })
  }

  return results.sort((a, b) => (a.day === b.day ? a.api_key_id.localeCompare(b.api_key_id) : a.day < b.day ? -1 : 1))
}

/** Splits [start, end) into chunks of at most maxDays whole UTC days. */
export function chunkRange(start: string, end: string, maxDays = 31): Array<{ start: string; end: string }> {
  const out: Array<{ start: string; end: string }> = []
  const day = 24 * 60 * 60 * 1000
  let s = Date.parse(`${start}T00:00:00Z`)
  const e = Date.parse(`${end}T00:00:00Z`)
  while (s < e) {
    const next = Math.min(e, s + maxDays * day)
    out.push({ start: new Date(s).toISOString().slice(0, 10), end: new Date(next).toISOString().slice(0, 10) })
    s = next
  }
  return out
}
