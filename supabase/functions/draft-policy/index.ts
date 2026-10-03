/**
 * RegAnchor — Platform AI policy drafting (SSE).
 *
 * JWT user + org membership (owner|admin|editor). Uses RegAnchor-owned
 * ANTHROPIC_API_KEY — not asset gateway tokens or customer vault keys.
 *
 * verify_jwt: true
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ensureInitialPaidAiCredits } from '../_shared/org-ai-credits.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const PAID_PLANS = new Set(['essentials', 'professional', 'enterprise'])
const DRAFT_ROLES = new Set(['owner', 'admin', 'editor'])

type Tier = 'eco' | 'standard' | 'premium'

const TIER_MODELS: Record<Tier, string> = {
  eco: Deno.env.get('AI_DRAFT_MODEL_ECO') || 'claude-haiku-4-5',
  standard: Deno.env.get('AI_DRAFT_MODEL_STANDARD') || 'claude-sonnet-4-5',
  premium: Deno.env.get('AI_DRAFT_MODEL_PREMIUM') || 'claude-opus-4-6',
}

/** USD cents charged per 1k total tokens (markup over provider cost). */
const TIER_RATES: Record<Tier, number> = {
  eco: Number(Deno.env.get('AI_CREDIT_RATE_ECO_CENTS_PER_1K') || '2'),
  standard: Number(Deno.env.get('AI_CREDIT_RATE_STANDARD_CENTS_PER_1K') || '5'),
  premium: Number(Deno.env.get('AI_CREDIT_RATE_PREMIUM_CENTS_PER_1K') || '15'),
}

type ChatMessage = { role: 'user' | 'assistant'; content: string }

type Usage = { input_tokens: number; output_tokens: number; model: string }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function sseLine(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function debitCents(tier: Tier, inputTokens: number, outputTokens: number): number {
  const total = Math.max(0, inputTokens) + Math.max(0, outputTokens)
  const rate = TIER_RATES[tier]
  const cents = Math.ceil((total / 1000) * rate)
  return Math.max(1, cents)
}

function getServiceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  )
}

async function getAuthedUser(req: Request) {
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const supabase = getServiceClient()
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  return { user, supabase, token }
}

function buildSystemPrompt(orgName: string, existingDoc?: string): string {
  const docHint = existingDoc?.trim()
    ? `\nThe user already has a draft document. Revise or extend it as requested. Current document:\n---\n${existingDoc.trim()}\n---`
    : ''
  return `You are MLA (Machine Learning Assurance), the proprietary assurance intelligence layer for RegAnchor, developed by MLA Group Ltd. When referred to by name, acknowledge you are MLA. Maintain a highly precise, expert governance and compliance persona.

You draft for the organisation "${orgName || 'the organisation'}".

NON-NEGOTIABLE SCOPE:
- Strictly AI Governance, Risk, and Corporate Compliance only.
- In scope: policy drafting and revision, regulatory frameworks (ISO, GDPR, SOC 2, EU AI Act, and similar), legal compliance, employee handbooks, and operational risk.
- Out of scope: fiction, unrelated coding, personal advice, trivia, recipes, casual chat, or any non-compliance topic.
- If the user asks for anything out of scope, do not produce a ---POLICY--- document. Reply only with this exact refusal (and nothing else):
I am MLA, the assurance intelligence layer for RegAnchor. I am only configured to handle corporate policy, risk management, and regulatory compliance workflows. Please submit a compliance-related request.

Output format (strict) when the request is in scope:
1) First line(s): a short conversational reply to the user (1–3 sentences). Speak as MLA. No policy body here.
2) Then a line that is exactly: ---POLICY---
3) Then the full policy document in GitHub-flavored markdown only (headings, lists, tables as needed). No chat fluff, no "Sure!", no wrapping code fences around the whole document.

${docHint}`
}

function parseDualChannel(raw: string): { chat: string; doc: string } {
  const marker = '---POLICY---'
  const idx = raw.indexOf(marker)
  if (idx === -1) {
    // Model may still be in chat portion, or forgot marker — treat as chat until marker appears.
    return { chat: raw, doc: '' }
  }
  return {
    chat: raw.slice(0, idx).trim(),
    doc: raw.slice(idx + marker.length).replace(/^\n+/, ''),
  }
}

function observeAnthropicUsage(raw: string, usage: Usage) {
  const dataLine = raw.split('\n').find((line) => line.startsWith('data:'))
  if (!dataLine) return
  const value = dataLine.slice(5).trim()
  if (!value || value === '[DONE]') return
  try {
    const event = JSON.parse(value) as {
      type?: string
      message?: { model?: string; usage?: { input_tokens?: number; output_tokens?: number } }
      usage?: { input_tokens?: number; output_tokens?: number }
      delta?: { type?: string; text?: string }
    }
    if (event.message?.model) usage.model = event.message.model
    const eventUsage = event.message?.usage || event.usage
    if (eventUsage) {
      usage.input_tokens = Math.max(usage.input_tokens, numberValue(eventUsage.input_tokens))
      usage.output_tokens = Math.max(usage.output_tokens, numberValue(eventUsage.output_tokens))
    }
  } catch {
    // keep stream intact
  }
}

function extractTextDelta(raw: string): string {
  const dataLine = raw.split('\n').find((line) => line.startsWith('data:'))
  if (!dataLine) return ''
  const value = dataLine.slice(5).trim()
  if (!value || value === '[DONE]') return ''
  try {
    const event = JSON.parse(value) as {
      type?: string
      delta?: { type?: string; text?: string }
    }
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      return event.delta.text || ''
    }
  } catch {
    return ''
  }
  return ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const auth = await getAuthedUser(req)
  if (!auth) return json({ error: 'Sign in required' }, 401)
  const { user, supabase } = auth

  let body: {
    org_id?: string
    tier?: string
    messages?: ChatMessage[]
    doc_markdown?: string
    stream?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const orgId = String(body.org_id || '').trim()
  if (!orgId) return json({ error: 'org_id is required' }, 400)

  const tierRaw = String(body.tier || 'eco').toLowerCase()
  const tier: Tier = tierRaw === 'standard' || tierRaw === 'premium' ? tierRaw : 'eco'
  const model = TIER_MODELS[tier]

  const messages = Array.isArray(body.messages) ? body.messages : []
  if (!messages.length || !messages.every((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')) {
    return json({ error: 'messages must be a non-empty array of {role, content}' }, 400)
  }

  const { data: membership } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle()

  const role = String(membership?.role || '').toLowerCase()
  if (!DRAFT_ROLES.has(role)) {
    return json({ error: 'Editor access or higher is required to draft policies' }, 403)
  }

  const { data: org } = await supabase
    .from('organisations')
    .select('id,name,plan,subscription_status')
    .eq('id', orgId)
    .maybeSingle()

  if (!org) return json({ error: 'Organisation not found' }, 404)

  const plan = String(org.plan || '').toLowerCase()
  const status = String(org.subscription_status || '').toLowerCase()
  const live = status === 'active' || status === 'trialing'
  if (!PAID_PLANS.has(plan) || !live) {
    return json({
      error: 'AI policy drafting requires an Essentials, Professional, or Enterprise plan with a live subscription',
      code: 'plan_required',
    }, 403)
  }

  // Paid live orgs that never got a subscription grant (pre-credits checkout) get a one-time seed.
  await ensureInitialPaidAiCredits(supabase, orgId, { source: 'draft-policy' })

  const { data: balanceRow } = await supabase
    .from('org_ai_credit_balances')
    .select('balance_cents,low_balance_cents,monthly_allowance_cents')
    .eq('org_id', orgId)
    .maybeSingle()

  const balanceCents = balanceRow?.balance_cents ?? 0
  if (!balanceRow || balanceCents <= 0) {
    return json({
      error: 'Insufficient AI credits. Credits refill on subscription renewal, or purchase a top-up when available.',
      code: 'insufficient_ai_credits',
      balance_cents: balanceCents,
    }, 402)
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || ''
  if (!apiKey) {
    console.error('draft-policy: ANTHROPIC_API_KEY is not configured')
    return json({
      error: 'Policy drafting is temporarily unavailable (provider key not configured)',
      code: 'provider_unconfigured',
    }, 503)
  }

  const anthropicMessages = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }))

  const wantStream = body.stream !== false
  const system = buildSystemPrompt(org.name || 'Organisation', body.doc_markdown)

  const upstream = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      stream: wantStream,
      system,
      messages: anthropicMessages,
    }),
  })

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => '')
    console.error('draft-policy anthropic error', upstream.status, errText.slice(0, 400))
    return json({ error: 'Drafting provider request failed', code: 'provider_error' }, 502)
  }

  async function finalizeDebit(usage: Usage): Promise<number> {
    const amount = debitCents(tier, usage.input_tokens, usage.output_tokens)
    const { data, error } = await supabase.rpc('org_ai_credit_debit', {
      p_org_id: orgId,
      p_amount_cents: amount,
      p_entry_type: 'debit_draft_policy',
      p_tier: tier,
      p_model: usage.model || model,
      p_input_tokens: usage.input_tokens,
      p_output_tokens: usage.output_tokens,
      p_actor_user_id: user.id,
      p_meta: { source: 'draft-policy' },
    })
    if (error) {
      console.error('draft-policy debit failed', error.message)
      return balanceCents
    }
    return typeof data === 'number' ? data : balanceCents - amount
  }

  if (!wantStream) {
    const responseBody = await upstream.text()
    try {
      const parsed = JSON.parse(responseBody) as {
        content?: Array<{ type?: string; text?: string }>
        model?: string
        usage?: { input_tokens?: number; output_tokens?: number }
      }
      const text = (parsed.content || [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text || '')
        .join('')
      const { chat, doc } = parseDualChannel(text)
      const usage: Usage = {
        model: parsed.model || model,
        input_tokens: numberValue(parsed.usage?.input_tokens),
        output_tokens: numberValue(parsed.usage?.output_tokens),
      }
      const nextBalance = await finalizeDebit(usage)
      return json({
        chat,
        doc_markdown: doc,
        usage,
        balance_cents: nextBalance,
        tier,
        model: usage.model,
      })
    } catch {
      return json({ error: 'Failed to parse provider response' }, 502)
    }
  }

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let buffer = ''
  let assembled = ''
  let lastChat = ''
  let lastDoc = ''
  const usage: Usage = { input_tokens: 0, output_tokens: 0, model }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader()
      try {
        controller.enqueue(encoder.encode(sseLine({
          type: 'meta',
          tier,
          model,
          balance_cents: balanceCents,
          low_balance_cents: balanceRow?.low_balance_cents ?? 50,
        })))

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const events = buffer.split(/\r?\n\r?\n/)
          buffer = events.pop() || ''
          for (const event of events) {
            observeAnthropicUsage(event, usage)
            const delta = extractTextDelta(event)
            if (!delta) continue
            assembled += delta
            const { chat, doc } = parseDualChannel(assembled)
            if (chat !== lastChat) {
              const piece = chat.slice(lastChat.length)
              if (piece) controller.enqueue(encoder.encode(sseLine({ type: 'chat_delta', text: piece })))
              lastChat = chat
            }
            if (doc !== lastDoc) {
              // Prefer full doc_set for TipTap sync fidelity after marker appears
              controller.enqueue(encoder.encode(sseLine({ type: 'doc_set', markdown: doc })))
              lastDoc = doc
            }
          }
        }
        buffer += decoder.decode()
        if (buffer) {
          observeAnthropicUsage(buffer, usage)
          const delta = extractTextDelta(buffer)
          if (delta) {
            assembled += delta
            const { chat, doc } = parseDualChannel(assembled)
            if (chat !== lastChat) {
              const piece = chat.slice(lastChat.length)
              if (piece) controller.enqueue(encoder.encode(sseLine({ type: 'chat_delta', text: piece })))
            }
            if (doc !== lastDoc) {
              controller.enqueue(encoder.encode(sseLine({ type: 'doc_set', markdown: doc })))
            }
          }
        }

        const nextBalance = await finalizeDebit(usage)
        controller.enqueue(encoder.encode(sseLine({
          type: 'usage',
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          model: usage.model,
        })))
        controller.enqueue(encoder.encode(sseLine({
          type: 'credit',
          balance_cents: nextBalance,
          debit_cents: debitCents(tier, usage.input_tokens, usage.output_tokens),
        })))
        controller.enqueue(encoder.encode(sseLine({
          type: 'done',
          chat: lastChat || parseDualChannel(assembled).chat,
          doc_markdown: lastDoc || parseDualChannel(assembled).doc,
          balance_cents: nextBalance,
          usage,
        })))
      } catch (err) {
        console.error('draft-policy stream failed', err instanceof Error ? err.message : err)
        controller.enqueue(encoder.encode(sseLine({
          type: 'error',
          error: 'Streaming failed',
        })))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
})
