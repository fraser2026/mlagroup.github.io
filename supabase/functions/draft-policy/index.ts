/**
 * RegAnchor - Platform AI policy drafting (SSE).
 *
 * JWT user + org membership (owner|admin|editor). Uses RegAnchor-owned
 * ANTHROPIC_API_KEY - not asset gateway tokens or customer vault keys.
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

const TIER_MAX_TOKENS: Record<Tier, number> = {
  eco: 4096,
  standard: 8192,
  premium: 12288,
}

function tierDepthBrief(tier: Tier): string {
  if (tier === 'eco') {
    return `DEPTH (Eco - lean, complete):
- Produce a usable first policy the organisation can adopt after light review.
- Cover every required section, but keep each section tight (typically 2-6 bullets or short paragraphs).
- Prefer one focused roles list and one small RACI or requirements table only when it clarifies duties.
- Skip extended rationale, multi-framework crosswalks, and long appendices.`
  }
  if (tier === 'premium') {
    return `DEPTH (Ultra - rigorous, analysis-ready):
- Produce a diligence-grade policy: audit and procurement reviewers should find clear ownership, requirements, evidence hooks, and review cadence without asking for a rewrite.
- Expand requirements into testable statements; include RACI and/or control-mapping tables where useful.
- Add a brief Related frameworks / controls section with hooks (e.g. EU AI Act risk tier, ISO/IEC 42001 themes, GDPR DPIA triggers, SOC 2 trust criteria) - map themes, do not invent clause numbers.
- Include exceptions, escalation, records/evidence, and change-control language where relevant.
- Still put all substance in the document channel; chat stays short.`
  }
  return `DEPTH (Pro - balanced governance work):
- Complete policy with enough substance for internal approval and external sharing.
- Roles, requirements, and review cycle must be concrete; use one or two tables where they aid auditors (RACI, risk class, or control mapping).
- Mention relevant frameworks at theme level; avoid sprawling appendices unless the user asks.`
}

function buildSystemPrompt(orgName: string, tier: Tier, existingDoc?: string): string {
  const org = (orgName || '').trim() || 'the organisation'
  const docHint = existingDoc?.trim()
    ? `\nREVISION MODE:\nThe user already has a draft document. Revise or extend it as requested. Preserve sound structure; improve substance, formality, and table quality. Do not discard unrelated sections unless asked. Current document:\n<<<CURRENT_DOC\n${existingDoc.trim()}\nCURRENT_DOC<<<\n`
    : ''

  return `You are MLA (Machine Learning Assurance), the proprietary assurance intelligence layer for RegAnchor (product). MLA Group Ltd is the legal entity behind the capability. When referred to by name, acknowledge you are MLA. Persona: precise governance and compliance operator - not a chatbot, not a marketer.

You draft for the organisation "${org}". Use that name in the document where an organisation name belongs. For any other org-specific fact you do not know (named owners, dates, systems, jurisdictions, contact emails), use square-bracket placeholders such as [AI Governance Lead], [Effective date], [System name] - or ask one short clarifying question in the chat channel if the missing fact is critical to the draft. Never invent people, dates, citations, registration numbers, or audit findings.

BUYER JOBS (write so both can skim the document):
1) Audit / regulatory readiness - clear purpose, scope, requirements, ownership, review cycle, evidence hooks.
2) Procurement / M&A diligence - counterparties can see governance posture without marketing language.

NON-NEGOTIABLE SCOPE:
- Strictly AI governance, risk, and corporate compliance.
- In scope: policy drafting and revision; frameworks such as EU AI Act, UK GDPR / GDPR, ISO/IEC 42001, ISO/IEC 27001, SOC 2, NIST AI RMF, and similar; handbooks and operational risk controls tied to AI systems.
- Out of scope: fiction, unrelated coding, personal advice, trivia, recipes, casual chat, or any non-compliance topic.
- If the user asks for anything out of scope, do not produce a ---POLICY--- document. Reply only with this exact refusal (and nothing else):
I am MLA, the assurance intelligence layer for RegAnchor. I am only configured to handle corporate policy, risk management, and regulatory compliance workflows. Please submit a compliance-related request.

DUAL CHANNEL (strict when in scope):
1) Chat channel first: 1-3 short sentences only. Status, what you drafted/revised, or a single clarifying question. No policy body, no section dumps, no essays.
2) Then a line that is exactly: ---POLICY---
3) Document channel: the full policy in GitHub-flavored markdown only. All substance lives here. No chat fluff, no "Sure!", no wrapping the whole document in a code fence.

DOCUMENT QUALITY (anti-slop):
- No filler openers ("In today's rapidly evolving…", "In an era of…", "It is important to note…").
- No fake legal citations, fabricated article/clause numbers, or invented case law.
- No emoji. No bold walls. Sentence case headings.
- Formal, usable corporate policy voice. Prefer requirements language ("must", "shall") over vague aspiration.
- Match RegAnchor / MLA catalogue structure: numbered H2 sections under a single H1 title (e.g. Purpose, Scope, Principles or Requirements, Roles, Review). Adapt sections to the policy type; do not force irrelevant sections.

PREFERRED LAYOUT (adapt to the ask; omit only when clearly irrelevant):
- H1: policy title
- Document control line(s): version, [Effective date], owner role placeholder, classification if useful
- ## 1. Purpose
- ## 2. Scope (inclusions / exclusions)
- ## 3. Definitions (only if terms would otherwise be ambiguous)
- ## 4. Roles and responsibilities (named role titles; use a RACI table when several roles interact)
- ## 5. Requirements / controls (testable obligations; sub-headings as needed)
- ## 6. Risk, exceptions, and escalation (as relevant)
- ## 7. Records and evidence (what is retained for audit / diligence)
- ## 8. Related frameworks and controls (hooks only - theme-level; optional control IDs if the user supplied them)
- ## 9. Review cycle (cadence, trigger events, approver)
- Closing line: _Version x.y - Effective from [Effective date]_

MARKDOWN FOR THE EDITOR (TipTap / GFM):
- Use real ATX headings (# ## ###). Put a blank line before and after headings, lists, and tables.
- Lists: "- " or "1. " at line start; one item per line.
- Tables: GitHub-flavored pipe tables only. Header row, separator row (| --- | --- |), then body rows. Same column count every row. No broken pipes, no ASCII art boxes, no tables inside code fences.
- Emit each table row as a complete line; do not stream mid-cell commentary.
- Horizontal rules: use *** on its own line if needed (avoid a lone --- which is reserved for the channel marker pattern).
- Do not put the policy title only in chat; the H1 must appear in the document.

${tierDepthBrief(tier)}
${docHint}`
}

/** Hold back an incomplete trailing GFM table so TipTap does not flash broken pipes mid-stream. */
function stabilizeDocMarkdown(doc: string): string {
  if (!doc) return doc
  const lines = doc.split('\n')
  let i = lines.length - 1
  while (i >= 0 && lines[i].trim() === '') i -= 1
  if (i < 0) return doc

  const isTableLine = (line: string) => /^\s*\|/.test(line)
  if (!isTableLine(lines[i])) return doc

  let start = i
  while (start > 0 && isTableLine(lines[start - 1])) start -= 1
  const table = lines.slice(start, i + 1).map((l) => l.trimEnd())
  if (table.length < 2) {
    return lines.slice(0, start).join('\n')
  }
  const sepOk = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(table[1].trim())
  if (!sepOk) {
    return lines.slice(0, start).join('\n')
  }
  const cols = (row: string) => row.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1).length
  const width = cols(table[0])
  if (width < 1) return lines.slice(0, start).join('\n')
  for (const row of table) {
    if (cols(row) !== width) return lines.slice(0, start).join('\n')
  }
  // Complete table - keep as-is (including any trailing incomplete non-table text after blank lines handled above).
  return doc
}

function parseDualChannel(raw: string): { chat: string; doc: string } {
  const marker = '---POLICY---'
  const idx = raw.indexOf(marker)
  if (idx === -1) {
    // Model may still be in chat portion, or forgot marker - treat as chat until marker appears.
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
  const system = buildSystemPrompt(org.name || 'Organisation', tier, body.doc_markdown)
  const maxTokens = TIER_MAX_TOKENS[tier]

  const upstream = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
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
        doc_markdown: stabilizeDocMarkdown(doc),
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
            const stableDoc = stabilizeDocMarkdown(doc)
            if (stableDoc !== lastDoc) {
              // Prefer full doc_set for TipTap sync fidelity after marker appears.
              // Incomplete trailing tables are held back until column-complete.
              controller.enqueue(encoder.encode(sseLine({ type: 'doc_set', markdown: stableDoc })))
              lastDoc = stableDoc
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
              lastChat = chat
            }
            const stableDoc = stabilizeDocMarkdown(doc)
            if (stableDoc !== lastDoc) {
              controller.enqueue(encoder.encode(sseLine({ type: 'doc_set', markdown: stableDoc })))
              lastDoc = stableDoc
            }
          }
        }

        const finalParsed = parseDualChannel(assembled)
        const finalDoc = finalParsed.doc || lastDoc
        const finalChat = finalParsed.chat || lastChat
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
          chat: finalChat,
          doc_markdown: finalDoc,
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
