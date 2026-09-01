/** Safe read of paid Checkout Session for post-pay signup prefills */
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { session_id } = await req.json()
    if (!session_id) {
      return new Response(JSON.stringify({ error: 'session_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const session = await stripe.checkout.sessions.retrieve(session_id)
    const ps = session.payment_status
    if (ps !== 'paid' && ps !== 'no_payment_required') {
      return new Response(JSON.stringify({ error: 'Payment not confirmed' }), {
        status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const email = (session.customer_details?.email || session.customer_email || '').toLowerCase().trim()
    const name = session.customer_details?.name || ''
    return new Response(JSON.stringify({
      email,
      name,
      plan: session.metadata?.plan || null,
      mode: session.mode,
      amount_total: session.amount_total,
      currency: session.currency,
      testMode: !session.livemode,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
