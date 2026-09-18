import { clsx } from 'clsx'
import { labelProvider } from '../lib/registry'
import styles from './BrandIcon.module.css'

/** Brand marks from /providers/*.svg (LobeHub pack + official Cursor mark). */
const PROVIDER_FILES: Record<string, string> = {
  anthropic: '/providers/anthropic-color.svg',
  openai: '/providers/openai-color.svg',
  google: '/providers/google-color.svg',
  gemini: '/providers/gemini-color.svg',
  googlecloud: '/providers/googlecloud-color.svg',
  azure: '/providers/azureai-color.svg',
  azureai: '/providers/azureai-color.svg',
  microsoft: '/providers/microsoft-color.svg',
  bedrock: '/providers/bedrock-color.svg',
  meta: '/providers/meta-color.svg',
  huggingface: '/providers/huggingface-color.svg',
  cohere: '/providers/cohere-color.svg',
  groq: '/providers/groq-color.svg',
  cerebras: '/providers/cerebras-color.svg',
  deepmind: '/providers/deepmind-color.svg',
  /** Host mark (not a model provider) — LobeHub Cursor glyph, same pack as others. */
  cursor: '/providers/cursor.svg',
  /** Data backends (warehouses / databases) — not model providers. */
  bigquery: '/providers/bigquery-color.svg',
  snowflake: '/providers/snowflake-color.svg',
  databricks: '/providers/databricks-color.svg',
  redshift: '/providers/redshift-color.svg',
  postgres: '/providers/postgres-color.svg',
  postgresql: '/providers/postgres-color.svg',
}

/** Black / near-black marks — invert on dark surfaces (no white tile). */
const MONO_DARK_MARKS = new Set(['anthropic', 'openai', 'cursor'])

type Props = {
  slug: string
  size?: number
  className?: string
  title?: string
}

export function hasBrandIcon(slug?: string | null) {
  const key = (slug || '').trim().toLowerCase()
  return Boolean(key && PROVIDER_FILES[key])
}

/**
 * Official provider mark only. No initials tile when a logo is missing —
 * call sites should show the plain label instead.
 */
export function BrandIcon({ slug, size = 22, className, title }: Props) {
  const key = slug.trim().toLowerCase()
  const src = PROVIDER_FILES[key]
  if (!src) return null
  const label = title || labelProvider(key)
  return (
    <img
      className={clsx(styles.img, MONO_DARK_MARKS.has(key) && styles.monoDark, className)}
      src={src}
      alt={label}
      width={size}
      height={size}
      draggable={false}
    />
  )
}
