import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

export type DraftTier = 'eco' | 'standard' | 'premium'

export type DraftChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type DraftStreamHandlers = {
  onMeta?: (meta: { tier: string; model: string; balance_cents: number; low_balance_cents?: number }) => void
  onChatDelta?: (text: string) => void
  onDocSet?: (markdown: string) => void
  onUsage?: (usage: { input_tokens: number; output_tokens: number; model: string }) => void
  onCredit?: (credit: { balance_cents: number; debit_cents?: number }) => void
  onDone?: (done: {
    chat?: string
    doc_markdown?: string
    balance_cents?: number
    usage?: { input_tokens: number; output_tokens: number; model: string }
  }) => void
  onError?: (message: string, code?: string) => void
}

export class DraftPolicyError extends Error {
  status: number
  code?: string
  balance_cents?: number
  constructor(message: string, status: number, code?: string, balance_cents?: number) {
    super(message)
    this.name = 'DraftPolicyError'
    this.status = status
    this.code = code
    this.balance_cents = balance_cents
  }
}

/**
 * Stream a policy draft from the platform draft-policy edge function.
 * Uses raw fetch (functions.invoke is awkward for SSE).
 */
export async function streamDraftPolicy(
  input: {
    orgId: string
    accessToken: string
    tier: DraftTier
    messages: DraftChatMessage[]
    docMarkdown?: string
    signal?: AbortSignal
  },
  handlers: DraftStreamHandlers,
): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/draft-policy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.accessToken}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      org_id: input.orgId,
      tier: input.tier,
      messages: input.messages,
      doc_markdown: input.docMarkdown || undefined,
      stream: true,
    }),
    signal: input.signal,
  })

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as {
      error?: string
      code?: string
      balance_cents?: number
    }
    throw new DraftPolicyError(
      data.error || 'Draft request failed.',
      res.status,
      data.code,
      data.balance_cents,
    )
  }

  if (!res.body) {
    throw new DraftPolicyError('Empty stream response', 502)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split(/\r?\n\r?\n/)
    buffer = chunks.pop() || ''
    for (const chunk of chunks) {
      const line = chunk.split('\n').find((l) => l.startsWith('data:'))
      if (!line) continue
      const raw = line.slice(5).trim()
      if (!raw) continue
      let event: Record<string, unknown>
      try {
        event = JSON.parse(raw) as Record<string, unknown>
      } catch {
        continue
      }
      const type = String(event.type || '')
      if (type === 'meta') {
        handlers.onMeta?.({
          tier: String(event.tier || ''),
          model: String(event.model || ''),
          balance_cents: Number(event.balance_cents) || 0,
          low_balance_cents: Number(event.low_balance_cents) || undefined,
        })
      } else if (type === 'chat_delta') {
        handlers.onChatDelta?.(String(event.text || ''))
      } else if (type === 'doc_set') {
        handlers.onDocSet?.(String(event.markdown || ''))
      } else if (type === 'doc_delta') {
        // Compatibility if harness emits incremental doc tokens
        handlers.onDocSet?.(String(event.text || ''))
      } else if (type === 'usage') {
        handlers.onUsage?.({
          input_tokens: Number(event.input_tokens) || 0,
          output_tokens: Number(event.output_tokens) || 0,
          model: String(event.model || ''),
        })
      } else if (type === 'credit') {
        handlers.onCredit?.({
          balance_cents: Number(event.balance_cents) || 0,
          debit_cents: Number(event.debit_cents) || undefined,
        })
      } else if (type === 'error') {
        handlers.onError?.(String(event.error || 'Streaming error'), String(event.code || '') || undefined)
      } else if (type === 'done') {
        handlers.onDone?.({
          chat: typeof event.chat === 'string' ? event.chat : undefined,
          doc_markdown: typeof event.doc_markdown === 'string' ? event.doc_markdown : undefined,
          balance_cents: typeof event.balance_cents === 'number' ? event.balance_cents : undefined,
          usage: event.usage as { input_tokens: number; output_tokens: number; model: string } | undefined,
        })
      }
    }
  }
}
