/** Portal RPCs often return JSON objects (sometimes stringified). */
export function parseRpcPayload<T extends { ok?: boolean; error?: string }>(
  data: unknown,
): T | null {
  if (data == null) return null
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as T
    } catch {
      return null
    }
  }
  if (typeof data === 'object') return data as T
  return null
}

export function fmtDate(iso?: string | null) {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return '-'
  }
}
