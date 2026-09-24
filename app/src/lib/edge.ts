import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

export class EdgeError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'EdgeError'
    this.status = status
    this.code = code
  }
}

export async function invokeEdge<T = Record<string, unknown>>(
  name: string,
  body: Record<string, unknown>,
  accessToken: string,
): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string }
  if (!res.ok) {
    throw new EdgeError(data.error || 'Request failed.', res.status, data.code)
  }
  return data
}
