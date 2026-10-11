import { sb } from './supabase'

export type Person = { name: string; email: string | null }

export async function loadPeople(ids: Array<string | null | undefined>) {
  const unique = [...new Set(ids.filter(Boolean))] as string[]
  const map = new Map<string, Person>()
  if (!unique.length) return map
  const { data } = await sb.from('profiles').select('id,full_name,email').in('id', unique)
  for (const p of (data as { id: string; full_name: string | null; email: string | null }[]) || []) {
    map.set(p.id, { name: (p.full_name || p.email || 'Member').trim(), email: p.email })
  }
  return map
}

export function fmtWhen(iso?: string | null) {
  if (!iso) return 'Not recorded'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Not recorded'
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function fmtBytes(n?: number | null) {
  if (!n) return ''
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
