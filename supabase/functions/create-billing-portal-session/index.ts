// create-billing-portal-session — Stripe Customer Portal for the authenticated org
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@13.10.0?target=deno'

const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') || ''
const stripe = new Stripe(stripeKey, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const SITE_URL = Deno.env.get('SITE_URL') || 'https://reganchor.com'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Sign in to manage your subscription.' }, 401)

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return json({ error: 'Your session has expired. Sign in again.' }, 401)

    const { data: membership } = await supabase
      .from('org_members')
      .select('org_id, role')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle()

    if (!membership?.org_id) return json({ error: 'No organisation is linked to this account.' }, 403)

    const role = membership.role || ''
    if (role !== 'owner' && role !== 'admin') {
      return json({ error: 'Only an owner or admin can manage the organisation subscription.' }, 403)
    }

    const { data: org } = await supabase
      .from('organisations')
      .select('id, stripe_customer_id')
      .eq('id', membership.org_id)
      .maybeSingle()

    if (!org) return json({ error: 'Organisation not found.' }, 404)
    if (!org.stripe_customer_id) {
      return json({ error: 'No Stripe customer is linked to this organisation yet.' }, 400)
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripe_customer_id,
      return_url: SITE_URL.replace(/\/$/, '') + '/portal.html#billing',
    })

    if (!session.url) return json({ error: 'Billing settings could not be opened.' }, 500)
    return json({ url: session.url })
  } catch (err) {
    console.error('Billing portal session error:', err)
    return json({ error: 'Billing settings could not be opened. Try again, or contact support if this continues.' }, 500)
  }
})
