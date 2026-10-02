/**
 * Org AI credit helpers for platform drafting (not asset gateway metering).
 * Monthly refill is refill-to-cap: grant = max(0, allowance - balance).
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const AI_CREDIT_ALLOWANCE_CENTS_DEFAULT = 500 // $5 USD

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
