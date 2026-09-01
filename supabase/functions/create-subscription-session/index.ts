// create-subscription-session — live price IDs or test: tokens with sk_test
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@13.10.0?target=deno'

const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') || ''
const stripe = new Stripe(stripeKey, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})
const isTestKey = stripeKey.startsWith('sk_test')

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const SITE_URL = Deno.env.get('SITE_URL') || 'https://reganchor.com'

const LIVE_PRICE_MAP: Record<string, { plan: string; period: string }> = {
  'price_1TD37VRfSQTwpCt9fmlCcuQh': { plan: 'essentials', period: 'monthly' },
  'price_1TD37VRfSQTwpCt914LUfLrf': { plan: 'essentials', period: 'annual' },
  'price_1TD392RfSQTwpCt9yaJicEiY': { plan: 'professional', period: 'monthly' },
  'price_1TD3AbRfSQTwpCt969zGi3bD': { plan: 'professional', period: 'annual' },
}

const TEST_CATALOG: Record<string, { plan: string; period: string; amount: number; interval: 'month' | 'year'; name: string }> = {
  'test:essentials:monthly': { plan: 'essentials', period: 'monthly', amount: 12900, interval: 'month', name: 'Essentials — Governance' },
  'test:essentials:annual': { plan: 'essentials', period: 'annual', amount: 129000, interval: 'year', name: 'Essentials — Governance (annual)' },
  'test:professional:monthly': { plan: 'professional', period: 'monthly', amount: 24900, interval: 'month', name: 'Professional — Compliance' },
  'test:professional:annual': { plan: 'professional', period: 'annual', amount: 249000, interval: 'year', name: 'Professional — Compliance (annual)' },
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function resolveLine(price_id: string) {
  if (price_id.startsWith('test:')) {
    if (!isTestKey) throw new Error('Test catalog requires Supabase STRIPE_SECRET_KEY to be sk_test_…')
    const cat = TEST_CATALOG[price_id]
    if (!cat) throw new Error('Unknown test price token: ' + price_id)
    return {
      planInfo: { plan: cat.plan, period: cat.period },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'gbp',
          unit_amount: cat.amount,
          recurring: { interval: cat.interval },
          product_data: { name: cat.name + ' (test)' },
        },
      }],
    }
  }
  if (isTestKey) throw new Error('Live price IDs cannot be charged with sk_test. Use frontend mode test tokens or switch STRIPE_SECRET_KEY to sk_live.')
  const planInfo = LIVE_PRICE_MAP[price_id]
  if (!planInfo) throw new Error('Invalid price_id')
  return { planInfo, line_items: [{ price: price_id, quantity: 1 }] }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()
    const { price_id, org_id, embedded, guest } = body
    if (!price_id) {
      return new Response(JSON.stringify({ error: 'price_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let resolved
    try { resolved = resolveLine(price_id) }
    catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { planInfo, line_items } = resolved
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    if (guest === true) {
      const sessionConfig: Record<string, unknown> = {
        mode: 'subscription',
        line_items,
        allow_promotion_codes: true,
        metadata: { plan: planInfo.plan, period: planInfo.period, guest: 'true', test: isTestKey ? 'true' : 'false' },
        subscription_data: {
          metadata: { plan: planInfo.plan, period: planInfo.period, guest: 'true' },
        },
      }
      if (embedded) {
        sessionConfig.ui_mode = 'embedded'
        sessionConfig.return_url = SITE_URL + '/subscription-success.html?session_id={CHECKOUT_SESSION_ID}&plan=' + planInfo.plan
      } else {
        sessionConfig.success_url = SITE_URL + '/subscription-success.html?session_id={CHECKOUT_SESSION_ID}&plan=' + planInfo.plan
        sessionConfig.cancel_url = SITE_URL + '/pricing.html'
      }
      const session = await stripe.checkout.sessions.create(sessionConfig as any)
      return new Response(JSON.stringify(embedded ? { clientSecret: session.client_secret, testMode: isTestKey } : { url: session.url, testMode: isTestKey }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (!org_id) {
      return new Response(JSON.stringify({ error: 'org_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: membership } = await supabase.from('org_members').select('role').eq('org_id', org_id).eq('user_id', user.id).single()
    if (!membership) {
      return new Response(JSON.stringify({ error: 'Not a member of this organisation' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { data: org } = await supabase.from('organisations').select('id, name, stripe_customer_id').eq('id', org_id).single()
    if (!org) {
      return new Response(JSON.stringify({ error: 'Organisation not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let customerId = org.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email, name: org.name,
        metadata: { org_id: org_id, created_by: user.id },
      })
      customerId = customer.id
      await supabase.from('organisations').update({ stripe_customer_id: customerId }).eq('id', org_id)
    }

    const { data: existingOrg } = await supabase.from('organisations').select('stripe_subscription_id, subscription_status').eq('id', org_id).single()
    if (existingOrg?.stripe_subscription_id && existingOrg?.subscription_status === 'active') {
      return new Response(JSON.stringify({ error: 'Active subscription exists. Manage it from your portal settings.', existing: true }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const sessionConfig: any = {
      customer: customerId,
      mode: 'subscription',
      line_items,
      metadata: { org_id, plan: planInfo.plan, period: planInfo.period, user_id: user.id },
      subscription_data: { metadata: { org_id, plan: planInfo.plan, period: planInfo.period } },
      allow_promotion_codes: true,
    }
    if (embedded) {
      sessionConfig.ui_mode = 'embedded'
      sessionConfig.return_url = SITE_URL + '/portal.html?subscription=success&plan=' + planInfo.plan + '&session_id={CHECKOUT_SESSION_ID}'
    } else {
      sessionConfig.success_url = SITE_URL + '/portal.html?subscription=success&plan=' + planInfo.plan
      sessionConfig.cancel_url = SITE_URL + '/portal.html?subscription=cancelled'
    }

    const session = await stripe.checkout.sessions.create(sessionConfig)
    return new Response(JSON.stringify(embedded ? { clientSecret: session.client_secret, testMode: isTestKey } : { url: session.url, testMode: isTestKey }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Subscription session error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
