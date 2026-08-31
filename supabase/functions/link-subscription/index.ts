/**
 * RegAnchor — Link Subscription
 *
 * Proves payment via Stripe session, attaches subscription to an org for the
 * signed-in JWT user (never body user_id). Stripe customer email must match
 * the signed-in user email.
 *
 * verify_jwt: true (gateway). Unauthenticated calls → 401.
 *
 * DEPLOY (after merge — Pages does not ship Edge Functions):
 *   supabase functions deploy link-subscription --project-ref hueftewwenjaiagdoqmb
 */
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) return json({ error: 'Sign in required' }, 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    )
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return json({ error: 'Sign in required' }, 401)

    // IGNORE body user_id — bind to JWT sub only.
    const user_id = user.id
    const userEmail = (user.email || '').toLowerCase().trim()
    if (!userEmail) return json({ error: 'Account email is required' }, 400)

    const body = await req.json().catch(() => ({}))
    const { session_id, organisation, full_name, job_title } = body || {}

    if (!session_id) {
      return json({ error: 'session_id is required' }, 400)
    }

    let stripeSession: Stripe.Checkout.Session
    try {
      stripeSession = await stripe.checkout.sessions.retrieve(session_id, {
        expand: ['subscription'],
      })
    } catch (_e) {
      return json({ error: 'Invalid session_id' }, 400)
    }

    if (stripeSession.mode !== 'subscription') {
      return json({ error: 'Not a subscription checkout' }, 400)
    }

    const ps = stripeSession.payment_status
    if (ps !== 'paid' && ps !== 'no_payment_required') {
      return json({ error: 'Payment not confirmed', payment_status: ps }, 402)
    }

    const email = (
      stripeSession.customer_details?.email ||
      stripeSession.customer_email ||
      ''
    ).toLowerCase().trim()

    if (!email || email !== userEmail) {
      console.warn('[link-subscription] email mismatch', { email, userEmail })
      return json({ error: 'Checkout email does not match signed-in account' }, 403)
    }

    const plan = stripeSession.metadata?.plan || 'essentials'
    const period = stripeSession.metadata?.period || null
    const subscriptionId =
      typeof stripeSession.subscription === 'string'
        ? stripeSession.subscription
        : stripeSession.subscription?.id
    const customerId =
      typeof stripeSession.customer === 'string'
        ? stripeSession.customer
        : stripeSession.customer?.id || null

    if (!subscriptionId) {
      return json({ error: 'Missing subscription on session' }, 400)
    }

    const { data: pending } = await supabase
      .from('pending_subscriptions')
      .select('*')
      .eq('checkout_session_id', session_id)
      .maybeSingle()

    if (pending?.status === 'claimed' && pending.claimed_org_id) {
      return json({
        success: true,
        org_id: pending.claimed_org_id,
        plan,
        already_claimed: true,
      })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id, organisation, full_name, email, job_title')
      .eq('id', user_id)
      .maybeSingle()

    const profilePatch: Record<string, unknown> = {}
    if (organisation) profilePatch.organisation = organisation
    if (full_name) profilePatch.full_name = full_name
    if (job_title) profilePatch.job_title = job_title
    if (email) profilePatch.email = email

    if (!profile) {
      await supabase.from('profiles').insert({
        id: user_id,
        email: email || null,
        organisation: organisation || null,
        full_name: full_name || null,
        job_title: job_title || null,
      })
    } else if (Object.keys(profilePatch).length) {
      await supabase.from('profiles').update(profilePatch).eq('id', user_id)
    }

    let orgId = profile?.org_id || null

    if (orgId) {
      const { data: org } = await supabase
        .from('organisations')
        .select('id, subscription_status')
        .eq('id', orgId)
        .maybeSingle()
      if (!org) orgId = null
    }

    if (!orgId) {
      const { data: existing } = await supabase
        .from('organisations')
        .select('id')
        .eq('created_by', user_id)
        .limit(1)
        .maybeSingle()
      if (existing) orgId = existing.id
    }

    if (!orgId) {
      const orgName = organisation || profile?.organisation || 'My Organisation'
      const { data: newOrg, error: orgErr } = await supabase
        .from('organisations')
        .insert({ name: orgName, created_by: user_id })
        .select('id')
        .maybeSingle()
      if (orgErr || !newOrg) {
        throw new Error(orgErr?.message || 'Could not create organisation')
      }
      orgId = newOrg.id
      await supabase.from('org_members').insert({
        org_id: orgId,
        user_id,
        role: 'owner',
        accepted_at: new Date().toISOString(),
      })
    } else {
      const { data: mem } = await supabase
        .from('org_members')
        .select('id')
        .eq('org_id', orgId)
        .eq('user_id', user_id)
        .maybeSingle()
      if (!mem) {
        await supabase.from('org_members').insert({
          org_id: orgId,
          user_id,
          role: 'owner',
          accepted_at: new Date().toISOString(),
        })
      }
      if (organisation) {
        await supabase.from('organisations').update({ name: organisation }).eq('id', orgId)
      }
    }

    await supabase.from('profiles').update({ org_id: orgId }).eq('id', user_id)

    const subscription = await stripe.subscriptions.retrieve(subscriptionId)
    const periodEnd = new Date(subscription.current_period_end * 1000).toISOString()

    await supabase
      .from('organisations')
      .update({
        plan,
        subscription_status: 'active',
        stripe_subscription_id: subscriptionId,
        stripe_customer_id: customerId,
        subscription_period_end: periodEnd,
      })
      .eq('id', orgId)

    await stripe.subscriptions.update(subscriptionId, {
      metadata: {
        ...subscription.metadata,
        org_id: orgId,
        plan,
        period: period || subscription.metadata?.period || '',
        guest: 'false',
        claimed_user_id: user_id,
      },
    })

    await supabase.from('pending_subscriptions').upsert({
      checkout_session_id: session_id,
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: customerId,
      customer_email: email || null,
      plan,
      period,
      status: 'claimed',
      claimed_user_id: user_id,
      claimed_org_id: orgId,
      claimed_at: new Date().toISOString(),
    }, { onConflict: 'checkout_session_id' })

    await supabase.from('registry_audit_log').insert({
      org_id: orgId,
      user_id,
      action: 'subscription_claimed',
      entity_type: 'organisation',
      entity_id: orgId,
      changes: {
        plan,
        subscription_id: subscriptionId,
        checkout_session_id: session_id,
        job_title: job_title || null,
      },
    })

    return json({ success: true, org_id: orgId, plan })
  } catch (err) {
    console.error('[link-subscription]', (err as Error).message)
    return json({ error: (err as Error).message }, 500)
  }
})
