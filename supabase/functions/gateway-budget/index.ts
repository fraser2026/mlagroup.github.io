/**
 * RegAnchor — Monthly gateway budgets (organisation or agent scope).
 * Organisation owners and admins only; every change is written to the audit log.
 */
import {
  assertOrgAdmin,
  corsHeaders,
  getAuthedUser,
  json,
  parseUuid,
  writeAudit,
} from '../_shared/provider-connection.ts'

const AMOUNT_RE = /^\d{1,9}(\.\d{1,2})?$/
const MAX_AMOUNT = 100_000_000

function bad(message: string, status = 400): never {
  throw new Response(JSON.stringify({ ok: false, error: message }), { status })
}

/** Amounts are validated as text so the stored value is exactly what was entered. */
function parseAmount(value: unknown): string {
  const raw = String(value ?? '').trim().replace(/,/g, '')
  if (!AMOUNT_RE.test(raw)) bad('Enter a budget in US dollars with up to two decimal places.')
  const n = Number(raw)
  if (!(n > 0)) bad('Budget must be more than $0.')
  if (n > MAX_AMOUNT) bad('Budget must be $100,000,000 or less.')
  return raw
}

function parseWarnAt(value: unknown): number {
  if (value === undefined || value === null || value === '') return 80
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 100) bad('Warning level must be a whole percentage from 1 to 100.')
  return n
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

    if (action === 'upsert') {
      const assetId = body.asset_id ? parseUuid(body.asset_id, 'Agent') : null
      const amount = parseAmount(body.amount_usd)
      const warnAt = parseWarnAt(body.warn_at_pct)

      let assetName: string | null = null
      if (assetId) {
        const { data: asset } = await supabase
          .from('ai_systems')
          .select('id,org_id,name')
          .eq('id', assetId)
          .is('deleted_at', null)
          .maybeSingle()
        if (!asset || asset.org_id !== orgId) bad('Agent not found in this organisation.', 404)
        assetName = asset.name
      }

      let existingQuery = supabase
        .from('gateway_budgets')
        .select('id,amount_usd,warn_at_pct')
        .eq('org_id', orgId)
      existingQuery = assetId ? existingQuery.eq('asset_id', assetId) : existingQuery.is('asset_id', null)
      const { data: existing } = await existingQuery.maybeSingle()

      const now = new Date().toISOString()
      const write = existing
        ? supabase
            .from('gateway_budgets')
            .update({ amount_usd: amount, warn_at_pct: warnAt, updated_at: now, updated_by: user.id })
            .eq('id', existing.id)
        : supabase.from('gateway_budgets').insert({
            org_id: orgId,
            asset_id: assetId,
            amount_usd: amount,
            warn_at_pct: warnAt,
            created_by: user.id,
            updated_by: user.id,
          })
      const { data, error } = await write.select('id,asset_id,amount_usd,warn_at_pct,updated_at').single()
      if (error || !data) return json({ ok: false, error: error?.message || 'Could not save budget.' }, 500)

      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: existing ? 'gateway_budget_updated' : 'gateway_budget_set',
        entity_type: assetId ? 'ai_system' : 'organisation',
        entity_id: assetId || orgId,
        changes: {
          budget_id: data.id,
          scope: assetId ? 'agent' : 'organisation',
          ...(assetName ? { _system_name: assetName } : {}),
          amount_usd: existing ? { from: String(existing.amount_usd), to: amount } : amount,
          warn_at_pct: existing ? { from: existing.warn_at_pct, to: warnAt } : warnAt,
        },
      })
      return json({ ok: true, budget: data })
    }

    if (action === 'delete') {
      const budgetId = parseUuid(body.budget_id, 'Budget')
      const { data, error } = await supabase
        .from('gateway_budgets')
        .delete()
        .eq('id', budgetId)
        .eq('org_id', orgId)
        .select('id,asset_id,amount_usd,warn_at_pct')
        .maybeSingle()
      if (error) return json({ ok: false, error: error.message }, 500)
      if (!data) return json({ ok: false, error: 'Budget not found.' }, 404)

      let assetName: string | null = null
      if (data.asset_id) {
        const { data: asset } = await supabase.from('ai_systems').select('name').eq('id', data.asset_id).maybeSingle()
        assetName = asset?.name || null
      }
      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: 'gateway_budget_removed',
        entity_type: data.asset_id ? 'ai_system' : 'organisation',
        entity_id: data.asset_id || orgId,
        changes: {
          budget_id: data.id,
          scope: data.asset_id ? 'agent' : 'organisation',
          ...(assetName ? { _system_name: assetName } : {}),
          amount_usd: String(data.amount_usd),
          warn_at_pct: data.warn_at_pct,
        },
      })
      return json({ ok: true })
    }

    return json({ ok: false, error: 'Action must be upsert or delete.' }, 400)
  } catch (error) {
    if (error instanceof Response) {
      const payload = await error.json().catch(() => ({ ok: false, error: 'Request failed.' }))
      return json(payload, error.status)
    }
    return json({ ok: false, error: error instanceof Error ? error.message : 'Request failed.' }, 500)
  }
})
