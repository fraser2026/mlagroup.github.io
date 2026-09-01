// supabase/functions/subscription-webhook/index.ts
// Deploy: supabase functions deploy subscription-webhook --no-verify-jwt

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@13.10.0?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const webhookSecret = Deno.env.get('STRIPE_SUBSCRIPTION_WEBHOOK_SECRET') || ''

const PRICE_TO_PLAN: Record<string, string> = {
  'price_1TD37VRfSQTwpCt9fmlCcuQh': 'essentials',
  'price_1TD37VRfSQTwpCt914LUfLrf': 'essentials',
  'price_1TD392RfSQTwpCt9yaJicEiY': 'professional',
  'price_1TD3AbRfSQTwpCt969zGi3bD': 'professional',
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const body = await req.text()
    const sig = req.headers.get('stripe-signature')

    if (!sig) {
      return new Response('Missing signature', { status: 400 })
    }

    let event: Stripe.Event
    try {
      event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret)
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message)
      return new Response('Invalid signature', { status: 400 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    console.log('Subscription webhook event:', event.type)

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.mode !== 'subscription') break

        const orgId = session.metadata?.org_id
        const plan = session.metadata?.plan
        const period = session.metadata?.period
        const subscriptionId = session.subscription as string
        const email = (
          session.customer_details?.email ||
          session.customer_email ||
          ''
        ).toLowerCase().trim()

        if (!subscriptionId) {
          console.error('Missing subscription_id in checkout session')
          break
        }

        // Guest / pay-first: stash until account claim
        if (!orgId || session.metadata?.guest === 'true') {
          const { error } = await supabase.from('pending_subscriptions').upsert({
            checkout_session_id: session.id,
            stripe_subscription_id: subscriptionId,
            stripe_customer_id: session.customer as string,
            customer_email: email || null,
            plan: plan || 'essentials',
            period: period || null,
            status: 'pending',
          }, { onConflict: 'checkout_session_id' })

          if (error) console.error('Failed to store pending subscription:', error)
          else console.log('Pending guest subscription stored:', session.id, plan, email)
          break
        }

        const subscription = await stripe.subscriptions.retrieve(subscriptionId)
        const periodEnd = new Date(subscription.current_period_end * 1000).toISOString()

        const { error } = await supabase
          .from('organisations')
          .update({
            plan: plan || 'essentials',
            subscription_status: 'active',
            stripe_subscription_id: subscriptionId,
            stripe_customer_id: session.customer as string,
            subscription_period_end: periodEnd,
          })
          .eq('id', orgId)

        if (error) {
          console.error('Failed to update org on checkout:', error)
        } else {
          console.log('Subscription activated for org:', orgId, 'plan:', plan)
          await supabase.from('registry_audit_log').insert({
            org_id: orgId,
            user_id: session.metadata?.user_id || null,
            action: 'subscription_activated',
            entity_type: 'organisation',
            entity_id: orgId,
            changes: {
              _actor_name: 'Stripe',
              _is_mla: false,
              plan: plan,
              subscription_id: subscriptionId,
            },
          })
        }
        break
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice
        const subscriptionId = invoice.subscription as string
        if (!subscriptionId) break

        const subscription = await stripe.subscriptions.retrieve(subscriptionId)
        const orgId = subscription.metadata?.org_id
        if (!orgId) break

        const periodEnd = new Date(subscription.current_period_end * 1000).toISOString()
        const priceId = subscription.items.data[0]?.price?.id || ''
        const plan = PRICE_TO_PLAN[priceId] || subscription.metadata?.plan || 'essentials'

        await supabase
          .from('organisations')
          .update({
            subscription_status: 'active',
            subscription_period_end: periodEnd,
            plan: plan,
          })
          .eq('id', orgId)

        await supabase
          .from('governance_certificates')
          .update({
            status: 'active',
            expires_at: periodEnd,
          })
          .eq('org_id', orgId)
          .eq('status', 'suspended')

        console.log('Invoice paid — renewed org:', orgId, 'until:', periodEnd)
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const subscriptionId = invoice.subscription as string
        if (!subscriptionId) break

        const subscription = await stripe.subscriptions.retrieve(subscriptionId)
        const orgId = subscription.metadata?.org_id
        if (!orgId) break

        await supabase
          .from('organisations')
          .update({ subscription_status: 'past_due' })
          .eq('id', orgId)

        await supabase.from('governance_alerts').insert({
          org_id: orgId,
          alert_type: 'payment_failed',
          severity: 'critical',
          title: 'Subscription Payment Failed',
          body: 'Your subscription payment could not be processed. Please update your payment method to avoid service interruption and certificate suspension.',
        })
        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const orgId = subscription.metadata?.org_id
        if (!orgId) break

        const priceId = subscription.items.data[0]?.price?.id || ''
        const plan = PRICE_TO_PLAN[priceId] || subscription.metadata?.plan || 'essentials'
        const periodEnd = new Date(subscription.current_period_end * 1000).toISOString()

        let status = 'active'
        if (subscription.status === 'past_due') status = 'past_due'
        else if (subscription.status === 'canceled') status = 'canceled'
        else if (subscription.status === 'unpaid') status = 'past_due'
        else if (subscription.cancel_at_period_end) status = 'canceling'

        await supabase
          .from('organisations')
          .update({
            plan: plan,
            subscription_status: status,
            subscription_period_end: periodEnd,
          })
          .eq('id', orgId)

        if (status === 'canceled') {
          await supabase
            .from('governance_certificates')
            .update({ status: 'suspended' })
            .eq('org_id', orgId)
            .eq('status', 'active')
        }

        await supabase.from('registry_audit_log').insert({
          org_id: orgId,
          user_id: null,
          action: 'subscription_updated',
          entity_type: 'organisation',
          entity_id: orgId,
          changes: {
            _actor_name: 'Stripe',
            _is_mla: false,
            plan: plan,
            status: status,
          },
        })
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const orgId = subscription.metadata?.org_id
        if (!orgId) break

        await supabase
          .from('organisations')
          .update({
            subscription_status: 'canceled',
            stripe_subscription_id: null,
          })
          .eq('id', orgId)

        await supabase
          .from('governance_certificates')
          .update({ status: 'expired' })
          .eq('org_id', orgId)
          .in('status', ['active', 'suspended'])

        await supabase.from('registry_audit_log').insert({
          org_id: orgId,
          user_id: null,
          action: 'subscription_canceled',
          entity_type: 'organisation',
          entity_id: orgId,
          changes: { _actor_name: 'Stripe', _is_mla: false },
        })

        await supabase.from('governance_alerts').insert({
          org_id: orgId,
          alert_type: 'subscription_canceled',
          severity: 'critical',
          title: 'Subscription Cancelled',
          body: 'Your RegAnchor subscription has ended. Your governance certificate has been expired and public verification is no longer active. Resubscribe to reinstate.',
        })
        break
      }

      default:
        console.log('Unhandled subscription event:', event.type)
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Subscription webhook error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
