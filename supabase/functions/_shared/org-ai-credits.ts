/**
 * Org AI credit helpers for platform drafting (not asset gateway metering).
 * Monthly refill is refill-to-cap: grant = max(0, allowance - balance).
 *
 * Claude Console / Anthropic Console prepaid balance is a separate wallet -
 * never treat it as org_ai_credit_balances.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const AI_CREDIT_ALLOWANCE_CENTS_DEFAULT = 500 // $5 USD
export const PAID_AI_CREDIT_PLANS = new Set(['essentials', 'professional', 'enterprise'])

export async function refillAiCredits(
  supabase: SupabaseClient,
  orgId: string,
  stripeEventId: string,
  meta: Record<string, unknown> = {},
): Promise<number | null> {
  const allowance = Number(Deno.env.get('AI_CREDIT_ALLOWANCE_CENTS') || AI_CREDIT_ALLOWANCE_CENTS_DEFAULT)
  const { data, error } = await supabase.rpc('org_ai_credit_refill_subscription', {
    p_org_id: orgId,
    p_stripe_event_id: stripeEventId,
    p_allowance_cents: Number.isFinite(allowance) ? allowance : AI_CREDIT_ALLOWANCE_CENTS_DEFAULT,
    p_meta: meta,
  })
  if (error) {
    console.error('AI credit refill failed:', error.message || error)
    return null
  }
  return typeof data === 'number' ? data : null
}

/**
 * Resolve org for Stripe subscription events when metadata.org_id is missing.
 * Order: metadata -> stripe_subscription_id → stripe_customer_id (paid live org).
 */
export async function resolveOrgIdForSubscription(
  supabase: SupabaseClient,
  opts: {
    metadataOrgId?: string | null
    subscriptionId?: string | null
    customerId?: string | null
  },
): Promise<string | null> {
  const metaOrg = String(opts.metadataOrgId || '').trim()
  if (metaOrg) return metaOrg

  const subscriptionId = String(opts.subscriptionId || '').trim()
  if (subscriptionId) {
    const { data } = await supabase
      .from('organisations')
      .select('id')
      .eq('stripe_subscription_id', subscriptionId)
      .maybeSingle()
    if (data?.id) return data.id as string
  }

  const customerId = String(opts.customerId || '').trim()
  if (customerId) {
    const { data } = await supabase
      .from('organisations')
      .select('id,plan,subscription_status')
      .eq('stripe_customer_id', customerId)
      .in('plan', ['essentials', 'professional', 'enterprise'])
      .in('subscription_status', ['active', 'trialing'])
      .limit(2)
    if (data && data.length === 1) return data[0].id as string
  }

  return null
}

/**
 * Safety net for paid live orgs that never received a subscription grant
 * (e.g. migration landed after checkout). Does not re-grant mid-cycle after spend.
 */
export async function ensureInitialPaidAiCredits(
  supabase: SupabaseClient,
  orgId: string,
  meta: Record<string, unknown> = {},
): Promise<number | null> {
  const { data: balanceRow } = await supabase
    .from('org_ai_credit_balances')
    .select('balance_cents')
    .eq('org_id', orgId)
    .maybeSingle()

  if (balanceRow && Number(balanceRow.balance_cents) > 0) {
    return Number(balanceRow.balance_cents)
  }

  const { data: priorGrant } = await supabase
    .from('org_ai_credit_ledger')
    .select('id')
    .eq('org_id', orgId)
    .eq('entry_type', 'grant_subscription')
    .gt('amount_cents', 0)
    .limit(1)
    .maybeSingle()

  if (priorGrant) {
    return balanceRow ? Number(balanceRow.balance_cents) : 0
  }

  return refillAiCredits(supabase, orgId, `ensure_paid_v1:${orgId}`, {
    ...meta,
    source: meta.source || 'ensure_initial_paid',
  })
}
