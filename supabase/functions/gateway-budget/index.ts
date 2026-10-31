/**
 * RegAnchor — Monthly gateway budgets (organisation or agent scope), whether they block at 100%,
 * and lifting or reinstating a block for the rest of the month.
 * Organisation owners and admins only; every change is written to the audit log.
 */
import type { SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2'
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

function parseEnforcement(value: unknown, current?: string | null): 'monitor' | 'block' {
  if (value === undefined || value === null || value === '') return current === 'block' ? 'block' : 'monitor'
  if (value === 'monitor' || value === 'block') return value
  bad('Choose whether the budget monitors or blocks.')
}

function currentPeriodStart(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`
}

async function actorName(supabase: SupabaseClient, user: User): Promise<string> {
  const { data } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
  return String(data?.full_name || '').trim() || user.email || 'An admin'
}

async function loadBudget(supabase: SupabaseClient, orgId: string, budgetId: string) {
  const { data } = await supabase
    .from('gateway_budgets')
    .select('id,asset_id,amount_usd,enforcement')
    .eq('id', budgetId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!data) bad('Budget not found.', 404)
  let assetName: string | null = null
  if (data.asset_id) {
    const { data: asset } = await supabase.from('ai_systems').select('name').eq('id', data.asset_id).maybeSingle()
    assetName = asset?.name || null
  }
  return { budget: data, assetName }
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
        .select('id,amount_usd,warn_at_pct,enforcement')
        .eq('org_id', orgId)
      existingQuery = assetId ? existingQuery.eq('asset_id', assetId) : existingQuery.is('asset_id', null)
      const { data: existing } = await existingQuery.maybeSingle()
      const enforcement = parseEnforcement(body.enforcement, existing?.enforcement)

      const now = new Date().toISOString()
      const write = existing
        ? supabase
            .from('gateway_budgets')
            .update({ amount_usd: amount, warn_at_pct: warnAt, enforcement, updated_at: now, updated_by: user.id })
            .eq('id', existing.id)
        : supabase.from('gateway_budgets').insert({
            org_id: orgId,
            asset_id: assetId,
            amount_usd: amount,
            warn_at_pct: warnAt,
            enforcement,
            created_by: user.id,
            updated_by: user.id,
          })
      const { data, error } = await write.select('id,asset_id,amount_usd,warn_at_pct,enforcement,updated_at').single()
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
          enforcement: existing ? { from: existing.enforcement, to: enforcement } : enforcement,
        },
      })
      const { error: alertError } = await supabase.rpc('gateway_budget_alerts_sync', { p_org_id: orgId })
      if (alertError) console.error('budget alert check failed', alertError.message)
      return json({ ok: true, budget: data })
    }

    if (action === 'lift') {
      const budgetId = parseUuid(body.budget_id, 'Budget')
      const reason = String(body.reason || '').trim()
      if (reason.length < 10 || reason.length > 500) bad('Give a reason of 10 to 500 characters.')
      const { budget, assetName } = await loadBudget(supabase, orgId, budgetId)
      if (budget.enforcement !== 'block') bad('Only budgets that block requests can be lifted.')
      const periodStart = currentPeriodStart()
      const { data, error } = await supabase
        .from('gateway_budget_lifts')
        .insert({
          budget_id: budget.id,
          org_id: orgId,
          period_start: periodStart,
          reason,
          created_by: user.id,
          created_by_name: await actorName(supabase, user),
        })
        .select('id,created_at')
        .single()
      if (error?.code === '23505') return json({ ok: false, error: 'The block is already lifted for this month.' }, 409)
      if (error || !data) return json({ ok: false, error: error?.message || 'Could not lift the block.' }, 500)

      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: 'gateway_budget_block_lifted',
        entity_type: budget.asset_id ? 'ai_system' : 'organisation',
        entity_id: budget.asset_id || orgId,
        changes: {
          budget_id: budget.id,
          lift_id: data.id,
          scope: budget.asset_id ? 'agent' : 'organisation',
          ...(assetName ? { _system_name: assetName } : {}),
          amount_usd: String(budget.amount_usd),
          period_start: periodStart,
          reason,
        },
      })
      return json({ ok: true, lift: data })
    }

    if (action === 'reinstate') {
      const budgetId = parseUuid(body.budget_id, 'Budget')
      const { budget, assetName } = await loadBudget(supabase, orgId, budgetId)
      const periodStart = currentPeriodStart()
      const { data, error } = await supabase
        .from('gateway_budget_lifts')
        .update({ ended_at: new Date().toISOString(), ended_by: user.id })
        .eq('budget_id', budget.id)
        .eq('period_start', periodStart)
        .is('ended_at', null)
        .select('id,reason')
        .maybeSingle()
      if (error) return json({ ok: false, error: error.message }, 500)
      if (!data) return json({ ok: false, error: 'The block is not lifted this month.' }, 404)

      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: 'gateway_budget_block_reinstated',
        entity_type: budget.asset_id ? 'ai_system' : 'organisation',
        entity_id: budget.asset_id || orgId,
        changes: {
          budget_id: budget.id,
          lift_id: data.id,
          scope: budget.asset_id ? 'agent' : 'organisation',
          ...(assetName ? { _system_name: assetName } : {}),
          amount_usd: String(budget.amount_usd),
          period_start: periodStart,
        },
      })
      return json({ ok: true })
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

    return json({ ok: false, error: 'Action must be upsert, delete, lift or reinstate.' }, 400)
  } catch (error) {
    if (error instanceof Response) {
      const payload = await error.json().catch(() => ({ ok: false, error: 'Request failed.' }))
      return json(payload, error.status)
    }
    return json({ ok: false, error: error instanceof Error ? error.message : 'Request failed.' }, 500)
  }
})
