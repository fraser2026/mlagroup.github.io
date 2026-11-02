/**
 * Amazon Bedrock prices from the AWS Price List bulk files (public, versioned, no credentials).
 *
 * Only per-request charges are read: on-demand and batch input, output and prompt cache tokens.
 * Provisioned throughput and reserved capacity are commitments, not per-request prices, so they
 * are skipped. Anything that does not match a known pattern is reported, never guessed.
 */

export const PRICE_LIST_HOST = 'https://pricing.us-east-1.amazonaws.com'
export const BEDROCK_OFFER = 'AmazonBedrockFoundationModels'

export type BedrockDimension = 'input' | 'output' | 'cache_read' | 'cache_write_5m' | 'cache_write_1h'
export type BedrockScope = 'regional' | 'global'
export type BedrockTier = 'on_demand' | 'batch'

export type BedrockPriceRow = {
  region: string
  provider: string
  model_name: string
  model_key: string
  dimension: BedrockDimension
  scope: BedrockScope
  tier: BedrockTier
  long_context: boolean
  usd_per_mtok: string
  sku: string
  usage_type: string
  effective_from: string
}

export type ParsedPriceFile = {
  offer_version: string
  published_at: string
  rows: BedrockPriceRow[]
  skipped: number
  duplicates: number
  ambiguous: string[]
  unrecognised: string[]
}

type PriceFile = {
  offerCode?: string
  version?: string
  publicationDate?: string
  products?: Record<string, { sku?: string; attributes?: Record<string, string> }>
  terms?: {
    OnDemand?: Record<string, Record<string, {
      effectiveDate?: string
      priceDimensions?: Record<string, { unit?: string; pricePerUnit?: { USD?: string } }>
    }>>
  }
}

const PER_REQUEST_FEATURES = new Set(['On-demand Inference', 'Batch Inference'])
// Premium performance tier, chosen per request. Not imported, so such requests stay unpriced.
const LATENCY_OPTIMISED = /_LatencyOptimized$/

const NEW_STYLE = /^(input|output|cache_read|cache_write)_tokens(_1h)?(_long_ctx)?(_global)?_(standard|batch)$/
const OLD_STYLE = /^(InputTokenCount|OutputTokenCount|CacheReadInputTokenCount|CacheWriteInputTokenCount|CacheWrite1hInputTokenCount)(_Global)?(_Batch)?$/
const OLD_BATCH = /^MillionBatch(Input|Output)Tokens$/

const OLD_DIMENSION: Record<string, BedrockDimension> = {
  InputTokenCount: 'input',
  OutputTokenCount: 'output',
  CacheReadInputTokenCount: 'cache_read',
  CacheWriteInputTokenCount: 'cache_write_5m',
  CacheWrite1hInputTokenCount: 'cache_write_1h',
}

type Classified = Pick<BedrockPriceRow, 'dimension' | 'scope' | 'tier' | 'long_context'>

/** Strip the region prefix ("EUW2-MP:EUW2_") and unit suffix ("-Units") from a usage type. */
export function usageCore(usageType: string): string {
  return usageType.replace(/^[A-Z0-9]+-MP:[A-Z0-9]+_/, '').replace(/^[A-Z0-9]+-/, '').replace(/-Units$/, '')
}

export function classifyUsage(usageType: string): Classified | null {
  const core = usageCore(usageType)
  let m = core.match(NEW_STYLE)
  if (m) {
    const [, base, oneHour, longCtx, global, tier] = m
    if (oneHour && base !== 'cache_write') return null
    const dimension: BedrockDimension = base === 'cache_write' ? (oneHour ? 'cache_write_1h' : 'cache_write_5m') : base as BedrockDimension
    return { dimension, scope: global ? 'global' : 'regional', tier: tier === 'batch' ? 'batch' : 'on_demand', long_context: !!longCtx }
  }
  m = core.match(OLD_STYLE)
  if (m) {
    const [, base, global, batch] = m
    return { dimension: OLD_DIMENSION[base], scope: global ? 'global' : 'regional', tier: batch ? 'batch' : 'on_demand', long_context: false }
  }
  m = core.match(OLD_BATCH)
  if (m) {
    return { dimension: m[1] === 'Input' ? 'input' : 'output', scope: 'regional', tier: 'batch', long_context: false }
  }
  return null
}

/** "Claude Sonnet 5" -> "claude-sonnet-5", "Claude 3.7 Sonnet" -> "claude-3-7-sonnet". */
export function modelKeyFromName(name: string): string {
  return name.trim().toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * Bedrock model ID to price list key. Handles inference profile prefixes (global., eu., us., apac.),
 * the provider prefix (anthropic.), and version suffixes (-20251001-v1:0, -v1, -v1:0).
 * "global.anthropic.claude-haiku-4-5-20251001-v1:0" -> { key: "claude-haiku-4-5", scope: "global" }
 */
export function bedrockModelKey(modelId: string): { provider: string; key: string; scope: BedrockScope } | null {
  const parts = modelId.trim().toLowerCase().split('.')
  let scope: BedrockScope = 'regional'
  if (parts.length > 2) {
    if (parts[0] === 'global') scope = 'global'
    parts.shift()
  }
  if (parts.length !== 2) return null
  const [provider, rest] = parts
  const key = rest.replace(/:\d+$/, '').replace(/-v\d+$/, '').replace(/-\d{8}$/, '')
  if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) return null
  return { provider, key, scope }
}

function normaliseUsd(value: string): string | null {
  if (!/^\d+(\.\d+)?$/.test(value)) return null
  const [whole, frac = ''] = value.split('.')
  const trimmed = frac.slice(0, 6).replace(/0+$/, '')
  if (frac.slice(6).replace(/0/g, '')) return null
  return trimmed ? `${BigInt(whole)}.${trimmed}` : `${BigInt(whole)}`
}

export function parsePriceFile(file: PriceFile, region: string, providers = ['Anthropic']): ParsedPriceFile {
  if (file.offerCode !== BEDROCK_OFFER) throw new Error(`Unexpected offer ${file.offerCode}`)
  if (!file.version || !file.publicationDate) throw new Error('Price file has no version or publication date')
  const rows: BedrockPriceRow[] = []
  const unrecognised: string[] = []
  let skipped = 0
  const wanted = new Set(providers)

  for (const [sku, product] of Object.entries(file.products || {})) {
    const a = product.attributes || {}
    if (!wanted.has(a.provider) || a.regionCode !== region) continue
    if (!PER_REQUEST_FEATURES.has(a.feature) || LATENCY_OPTIMISED.test(usageCore(a.usagetype || ''))) {
      skipped++
      continue
    }
    const classified = classifyUsage(a.usagetype || '')
    const terms = Object.values(file.terms?.OnDemand?.[sku] || {})
    const dims = terms.flatMap((t) => Object.values(t.priceDimensions || {}).map((d) => ({ d, t })))
    const usd = dims.length === 1 && dims[0].d.unit === '1M tokens' ? normaliseUsd(dims[0].d.pricePerUnit?.USD || '') : null
    const effective = dims.length === 1 ? dims[0].t.effectiveDate : undefined
    if (!classified || !a.model || usd === null || !effective || Number.isNaN(Date.parse(effective))) {
      unrecognised.push(`${a.model || 'unknown model'}: ${a.usagetype || sku}`)
      continue
    }
    rows.push({
      region,
      provider: modelKeyFromName(a.provider),
      model_name: a.model,
      model_key: modelKeyFromName(a.model),
      ...classified,
      usd_per_mtok: usd,
      sku,
      usage_type: a.usagetype,
      effective_from: new Date(effective).toISOString(),
    })
  }

  // AWS sometimes lists one price under both its old and new usage type names: identical prices
  // collapse to one row. Some retired models are listed twice with different prices (for example a
  // standard and a 100K context edition under one model name). Those models are left unpriced.
  rows.sort((a, b) => a.usage_type.localeCompare(b.usage_type) || a.sku.localeCompare(b.sku))
  const unique = new Map<string, BedrockPriceRow>()
  const ambiguous = new Set<string>()
  let duplicates = 0
  for (const r of rows) {
    const key = [r.model_key, r.dimension, r.scope, r.tier, r.long_context].join('|')
    const prior = unique.get(key)
    if (!prior) {
      unique.set(key, r)
    } else if (prior.usd_per_mtok === r.usd_per_mtok && prior.effective_from === r.effective_from) {
      duplicates++
    } else {
      ambiguous.add(r.model_key)
    }
  }

  return {
    offer_version: file.version,
    published_at: new Date(file.publicationDate).toISOString(),
    rows: [...unique.values()].filter((r) => !ambiguous.has(r.model_key)),
    skipped,
    duplicates,
    ambiguous: [...ambiguous].sort(),
    unrecognised,
  }
}
