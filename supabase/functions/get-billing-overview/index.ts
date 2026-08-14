// get-billing-overview — Stripe snapshot for the authenticated organisation
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

function brandLabel(brand: string | null | undefined) {
  if (!brand) return 'Card'
  return brand.charAt(0).toUpperCase() + brand.slice(1)
}

function formatAmount(amount: number | null | undefined, currency: string | null | undefined) {
  if (amount == null) return null
  const cur = (currency || 'gbp').toUpperCase()
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur }).format(amount / 100)
  } catch {
    return (cur === 'GBP' ? '£' : cur + ' ') + (amount / 100).toFixed(2)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Sign in to view billing.' }, 401)

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

    const { data: org } = await supabase
      .from('organisations')
      .select('id, name, plan, subscription_status, stripe_customer_id, stripe_subscription_id, subscription_period_end')
      .eq('id', membership.org_id)
      .maybeSingle()

    if (!org) return json({ error: 'Organisation not found.' }, 404)

    const canManage = membership.role === 'owner' || membership.role === 'admin'
    const base = {
      orgId: org.id,
      orgName: org.name,
      plan: org.plan || null,
      status: org.subscription_status || null,
      periodEnd: org.subscription_period_end || null,
      hasCustomer: !!org.stripe_customer_id,
      hasSubscription: !!org.stripe_subscription_id,
      canManage,
      amount: null as string | null,
      interval: null as string | null,
      paymentMethod: null as null | { brand: string; last4: string; expMonth: number | null; expYear: number | null },
      invoices: [] as Array<{ id: string; date: string | null; description: string; amount: string | null; url: string | null }>,
    }

    if (!org.stripe_customer_id || !stripeKey) {
      return json(base)
    }

    let subscription: Stripe.Subscription | null = null
    if (org.stripe_subscription_id) {
      try {
        subscription = await stripe.subscriptions.retrieve(org.stripe_subscription_id, {
          expand: ['default_payment_method', 'items.data.price'],
        })
      } catch {
        subscription = null
      }
    }
    if (!subscription) {
      const listed = await stripe.subscriptions.list({
        customer: org.stripe_customer_id,
        status: 'all',
        limit: 1,
        expand: ['data.default_payment_method', 'data.items.data.price'],
      })
      subscription = listed.data[0] || null
    }

    if (subscription) {
      const price = subscription.items.data[0]?.price
      const unit = typeof price?.unit_amount === 'number' ? price.unit_amount : null
      base.amount = formatAmount(unit, price?.currency)
      const interval = price?.recurring?.interval || null
      base.interval = interval === 'year' ? 'year' : interval === 'month' ? 'month' : interval
      if (subscription.current_period_end) {
        base.periodEnd = new Date(subscription.current_period_end * 1000).toISOString()
      }
      if (subscription.cancel_at_period_end && subscription.status === 'active') {
        base.status = 'canceling'
      } else if (subscription.status === 'unpaid') {
        base.status = 'past_due'
      } else if (subscription.status) {
        base.status = subscription.status
      }
      base.hasSubscription = true
    }

    let pm: Stripe.PaymentMethod | Stripe.Card | null = null
    const subPm = subscription?.default_payment_method
    if (subPm && typeof subPm !== 'string') pm = subPm as Stripe.PaymentMethod
    if (!pm) {
      const customer = await stripe.customers.retrieve(org.stripe_customer_id, {
        expand: ['invoice_settings.default_payment_method'],
      })
      if (!customer.deleted) {
        const def = customer.invoice_settings?.default_payment_method
        if (def && typeof def !== 'string') pm = def as Stripe.PaymentMethod
      }
    }
    if (pm && 'card' in pm && pm.card) {
      base.paymentMethod = {
        brand: brandLabel(pm.card.brand),
        last4: pm.card.last4,
        expMonth: pm.card.exp_month ?? null,
        expYear: pm.card.exp_year ?? null,
      }
    }

    const invoices = await stripe.invoices.list({
      customer: org.stripe_customer_id,
      limit: 5,
    })
    base.invoices = invoices.data.map((inv) => ({
      id: inv.id,
      date: inv.created ? new Date(inv.created * 1000).toISOString() : null,
      description: inv.lines?.data?.[0]?.description || inv.description || 'RegAnchor subscription',
      amount: formatAmount(inv.amount_paid ?? inv.total, inv.currency),
      url: inv.hosted_invoice_url || inv.invoice_pdf || null,
    }))

    return json(base)
  } catch (err) {
    console.error('Billing overview error:', err)
    return json({ error: 'Billing details could not be loaded.' }, 500)
  }
})
