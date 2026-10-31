/**
 * RegAnchor — Contracted pricing: the discount an organisation has agreed with a provider.
 * Owners and admins only. Every change is audited, and requests from the earliest affected day
 * are re-priced so spend and budgets reflect the agreement.
 */
import {
  assertOrgAdmin,
  corsHeaders,
  getAuthedUser,
  json,
  parseUuid,
  writeAudit,
} from '../_shared/provider-connection.ts'

const PROVIDERS = new Set(['anthropic'])
const DISCOUNT_RE = /^\d{1,2}(\.\d{1,3})?$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function bad(message: string, status = 400): never {
  throw new Response(JSON.stringify({ ok: false, error: message }), { status })
}

function parseDiscount(value: unknown): string {
  const raw = String(value ?? '').trim().replace(/%$/, '')
  if (!DISCOUNT_RE.test(raw) || !(Number(raw) > 0)) {
    bad('Enter the discount as a percentage above 0 and below 100, with up to three decimal places.')
  }
  return raw
}

function parseDate(value: unknown, label: string): string {
  const raw = String(value ?? '').trim()
  if (!DATE_RE.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`)) || new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) !== raw) {
    bad(`${label} must be a date.`)
  }
  return raw
}

function earliest(...dates: Array<string | null | undefined>): string {
  return dates.filter((d): d is string => !!d).sort()[0]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  try {
    const { user, supabase } = await getAuthedUser(req)
    const body = await req.json().catch(() => ({}))
    const orgId = parseUuid(body.org_id, 'Organisation')
    const action = String(body.action || '').trim().toLowerCase()
    await assertOrgAdmin(supabase, user.id, orgId)

    let audit: { action: string; changes: Record<string, unknown> }
    let repriceFrom: string
    let agreement: Record<string, unknown> | null = null

    if (action === 'upsert') {
      const provider = String(body.provider || 'anthropic').trim().toLowerCase()
      if (!PROVIDERS.has(provider)) bad('Contracted pricing is available for Anthropic.')
      const modelId = body.model_id ? String(body.model_id).trim() : null
      if (modelId) {
        const { data: price } = await supabase
          .from('model_prices')
          .select('id')
          .eq('provider', provider)
          .eq('model_id', modelId)
          .limit(1)
          .maybeSingle()
        if (!price) bad('Choose a model RegAnchor has a list price for.')
      }
      const discount = parseDiscount(body.discount_pct)
      const from = parseDate(body.effective_from, 'Start date')
      const to = body.effective_to ? parseDate(body.effective_to, 'End date') : null
      if (to && to <= from) bad('The end date must be after the start date.')
      const reference = body.reference ? String(body.reference).trim().slice(0, 200) || null : null

      const fields = {
        provider,
        model_id: modelId,
        discount_pct: discount,
        effective_from: from,
        effective_to: to,
        reference,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      }

      let existing: Record<string, unknown> | null = null
      if (body.id) {
        const id = parseUuid(body.id, 'Agreement')
        const { data } = await supabase
          .from('gateway_price_agreements')
          .select('id,provider,model_id,discount_pct,effective_from,effective_to,reference')
          .eq('id', id)
          .eq('org_id', orgId)
          .maybeSingle()
        if (!data) bad('Agreement not found.', 404)
        existing = data
      }

      const write = existing
        ? supabase.from('gateway_price_agreements').update(fields).eq('id', existing.id as string)
        : supabase.from('gateway_price_agreements').insert({ ...fields, org_id: orgId, created_by: user.id })
      const { data, error } = await write
        .select('id,provider,model_id,discount_pct,effective_from,effective_to,reference')
        .single()
      if (error?.code === '23P01') {
        return json({ ok: false, error: 'Another agreement for these models already covers part of this period. End it first, or change the dates.' }, 409)
      }
      if (error || !data) return json({ ok: false, error: error?.message || 'Could not save the agreement.' }, 500)
      agreement = data

      const pair = (key: string) => existing ? { from: existing[key] ?? null, to: data[key as keyof typeof data] ?? null } : data[key as keyof typeof data] ?? null
      audit = {
        action: existing ? 'gateway_price_agreement_updated' : 'gateway_price_agreement_set',
        changes: {
          agreement_id: data.id,
          provider,
          model_id: pair('model_id'),
          discount_pct: pair('discount_pct'),
          effective_from: pair('effective_from'),
          effective_to: pair('effective_to'),
          reference: pair('reference'),
        },
      }
      repriceFrom = earliest(from, existing?.effective_from as string | undefined)
    } else if (action === 'remove') {
      const id = parseUuid(body.id, 'Agreement')
      const { data, error } = await supabase
        .from('gateway_price_agreements')
        .delete()
        .eq('id', id)
        .eq('org_id', orgId)
        .select('id,provider,model_id,discount_pct,effective_from,effective_to,reference')
        .maybeSingle()
      if (error) return json({ ok: false, error: error.message }, 500)
      if (!data) return json({ ok: false, error: 'Agreement not found.' }, 404)
      audit = {
        action: 'gateway_price_agreement_removed',
        changes: {
          agreement_id: data.id,
          provider: data.provider,
          model_id: data.model_id,
          discount_pct: data.discount_pct,
          effective_from: data.effective_from,
          effective_to: data.effective_to,
          reference: data.reference,
        },
      }
      repriceFrom = data.effective_from
    } else {
      return json({ ok: false, error: 'Action must be upsert or remove.' }, 400)
    }

    const { data: repriced, error: repriceError } = await supabase.rpc('gateway_events_reprice_org', {
      p_org_id: orgId,
      p_from: `${repriceFrom}T00:00:00Z`,
      p_to: null,
    })
    if (repriceError) console.error('contract reprice failed', repriceError.message)

    await writeAudit(supabase, {
      org_id: orgId,
      user_id: user.id,
      action: audit.action,
      entity_type: 'organisation',
      entity_id: orgId,
      changes: { ...audit.changes, repriced_requests: typeof repriced === 'number' ? repriced : null },
    })

    const { error: alertError } = await supabase.rpc('gateway_budget_alerts_sync', { p_org_id: orgId })
    if (alertError) console.error('budget alert check failed', alertError.message)

    if (repriceError) {
      return json({ ok: false, error: 'The agreement was saved, but existing requests could not be re-priced. Try saving again.' }, 500)
    }
    return json({ ok: true, agreement, repriced })
  } catch (error) {
    if (error instanceof Response) {
      const payload = await error.json().catch(() => ({ ok: false, error: 'Request failed.' }))
      return json(payload, error.status)
    }
    return json({ ok: false, error: error instanceof Error ? error.message : 'Request failed.' }, 500)
  }
})
