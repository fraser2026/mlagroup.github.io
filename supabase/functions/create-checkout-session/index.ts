/**
 * create-checkout-session — embedded Stripe Checkout for the diagnostic report.
 *
 * Requires a real diagnostic_results UUID before minting a session. Guests buy
 * without a user JWT (Authorization = anon key); verify_jwt stays false.
 *
 * DEPLOY: GitHub Pages merge does NOT deploy functions. After merge:
 *   supabase functions deploy create-checkout-session --no-verify-jwt --project-ref hueftewwenjaiagdoqmb
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'

const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')!
const stripe = new Stripe(stripeKey, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})
const isTestKey = stripeKey.startsWith('sk_test')
const SITE_URL = Deno.env.get('SITE_URL') || 'https://reganchor.com'
const LIVE_PRICE_ID = 'price_1T6iCTRfSQTwpCt9sEdFA1Qy'

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const body = await req.json().catch(() => ({}))
    const resultId = String(body?.result_id || body?.rid || '').trim()

    // Same generic not_found for bad format and missing rows — do not help attackers.
    if (!UUID_RE.test(resultId)) {
      return json({ error: 'not_found' }, 404)
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: row, error: lookupError } = await supabase
      .from('diagnostic_results')
      .select('id, respondent_email')
      .eq('id', resultId)
      .maybeSingle()

    if (lookupError) {
      console.error('[create-checkout-session] lookup', lookupError.message)
      return json({ error: 'lookup_failed' }, 500)
    }
    if (!row) return json({ error: 'not_found' }, 404)

    const { data: entitlements, error: entError } = await supabase
      .from('entitlements')
      .select('id')
      .eq('diagnostic_id', resultId)
      .eq('product', 'premium_report')
      .eq('status', 'active')
      .limit(1)

    if (entError) {
      console.error('[create-checkout-session] entitlements', entError.message)
      return json({ error: 'lookup_failed' }, 500)
    }
    if (entitlements && entitlements.length > 0) {
      // buy-report.html already skips checkout when get-buy-context.paid is true;
      // results.html may still call — refuse rather than mint another session.
      return json({ error: 'already_paid' }, 409)
    }

    // Optional real user JWT only. Guests send the anon key; ignore body user_id.
    let userId = ''
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (token) {
      const { data: { user } } = await supabase.auth.getUser(token)
      if (user?.id) userId = user.id
    }

    const clientEmail = String(body?.email || '').trim()
    const customerEmail =
      (row.respondent_email && String(row.respondent_email).trim()) ||
      clientEmail ||
      undefined

    const line_items = isTestKey
      ? [{
          quantity: 1,
          price_data: {
            currency: 'gbp',
            unit_amount: 29500,
            product_data: { name: 'Diagnostic Report (test)' },
          },
        }]
      : [{ price: LIVE_PRICE_ID, quantity: 1 }]

    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded',
      mode: 'payment',
      line_items,
      return_url: `${SITE_URL}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
      allow_promotion_codes: true,
      customer_email: customerEmail || undefined,
      metadata: {
        result_id: row.id,
        user_id: userId,
        test: isTestKey ? 'true' : 'false',
      },
    })

    return json({ clientSecret: session.client_secret, testMode: isTestKey })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'session_failed'
    console.error('[create-checkout-session]', message)
    return json({ error: message }, 500)
  }
})
