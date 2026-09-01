/** Diagnostic report Checkout — live price or test catalog with sk_test */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'

const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')!
const stripe = new Stripe(stripeKey, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})
const isTestKey = stripeKey.startsWith('sk_test')
const SITE_URL = Deno.env.get('SITE_URL') || 'https://reganchor.com'
const LIVE_PRICE_ID = 'price_1T6iCTRfSQTwpCt9sEdFA1Qy'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { result_id, user_id, email } = await req.json()

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
      customer_email: email || undefined,
      metadata: {
        result_id: result_id || '',
        user_id: user_id || '',
        test: isTestKey ? 'true' : 'false',
      },
    })

    return new Response(
      JSON.stringify({ clientSecret: session.client_secret, testMode: isTestKey }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[create-checkout-session]', err.message)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
