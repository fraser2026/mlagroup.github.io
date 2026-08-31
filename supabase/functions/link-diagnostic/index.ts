/**
 * RegAnchor — Link Diagnostic
 *
 * Called by payment-success.html AFTER account creation / sign-in.
 * Proves payment via Stripe session, binds to the JWT user (never body user_id),
 * requires Stripe customer email to match the signed-in user email.
 *
 * verify_jwt: true (gateway). Unauthenticated calls → 401.
 *
 * DEPLOY (after merge — Pages does not ship Edge Functions):
 *   supabase functions deploy link-diagnostic --project-ref hueftewwenjaiagdoqmb
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

function sbFetch(path: string, method: string, body?: unknown) {
  const url = Deno.env.get('SUPABASE_URL') + '/rest/v1/' + path
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return fetch(url, {
    method,
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Prefer': method === 'PATCH' ? 'return=minimal' : 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
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
    const userId = user.id
    const userEmail = (user.email || '').toLowerCase().trim()
    if (!userEmail) return json({ error: 'Account email is required' }, 400)

    const body = await req.json().catch(() => ({}))
    const session_id = body?.session_id
    const clientResultId = body?.result_id || null

    if (!session_id) {
      return json({ error: 'session_id is required' }, 400)
    }

    let stripeSession
    try {
      stripeSession = await stripe.checkout.sessions.retrieve(session_id)
    } catch (e) {
      console.error('[link-diagnostic] Stripe retrieve failed:', (e as Error).message)
      return json({ error: 'Invalid session_id' }, 400)
    }

    const ps = stripeSession.payment_status
    if (ps !== 'paid' && ps !== 'no_payment_required') {
      console.log('[link-diagnostic] Payment not confirmed:', ps)
      return json({ error: 'Payment not confirmed', payment_status: ps }, 402)
    }

    const stripeEmail = (
      stripeSession.customer_details?.email ||
      stripeSession.customer_email ||
      ''
    ).toLowerCase().trim()

    if (!stripeEmail || stripeEmail !== userEmail) {
      console.warn('[link-diagnostic] email mismatch', { stripeEmail, userEmail })
      return json({ error: 'Checkout email does not match signed-in account' }, 403)
    }

    // Prefer Stripe metadata result_id; ignore client result_id unless it equals metadata.
    const metaResultId = stripeSession.metadata?.result_id || null
    let diagnosticId: string | null = metaResultId
    if (clientResultId && metaResultId && clientResultId === metaResultId) {
      diagnosticId = metaResultId
    } else if (clientResultId && !metaResultId) {
      // Client-only result_id is not trusted.
      diagnosticId = null
    }

    console.log('[link-diagnostic] user:', userId, '| diagnostic:', diagnosticId, '| email:', stripeEmail)

    if (diagnosticId) {
      const linkRes = await sbFetch(
        `diagnostic_results?id=eq.${diagnosticId}`,
        'PATCH',
        { user_id: userId },
      )
      console.log('[link-diagnostic] diagnostic link:', linkRes.status)
    } else if (stripeEmail) {
      const findRes = await sbFetch(
        `diagnostic_results?respondent_email=eq.${encodeURIComponent(stripeEmail)}&user_id=is.null&order=created_at.desc&limit=1&select=id`,
        'GET',
      )
      if (findRes.ok) {
        const rows = await findRes.json()
        if (rows.length > 0) {
          diagnosticId = rows[0].id
          await sbFetch(
            `diagnostic_results?id=eq.${rows[0].id}`,
            'PATCH',
            { user_id: userId },
          )
          console.log('[link-diagnostic] fallback linked:', rows[0].id)
        }
      }
    }

    await sbFetch(
      `profiles?id=eq.${userId}`,
      'PATCH',
      { paid: true },
    )
    console.log('[link-diagnostic] profile paid set')

    const entUpdateRes = await sbFetch(
      `entitlements?stripe_session_id=eq.${session_id}`,
      'PATCH',
      { user_id: userId, diagnostic_id: diagnosticId },
    )
    console.log('[link-diagnostic] entitlement update:', entUpdateRes.status)

    const entCheckRes = await sbFetch(
      `entitlements?stripe_session_id=eq.${session_id}&select=id`,
      'GET',
    )
    if (entCheckRes.ok) {
      const existing = await entCheckRes.json()
      if (existing.length === 0) {
        await sbFetch('entitlements', 'POST', {
          user_id: userId,
          customer_email: stripeEmail,
          diagnostic_id: diagnosticId,
          product: 'premium_report',
          framework_version: '2.0.0',
          stripe_session_id: stripeSession.id,
          stripe_payment_intent: stripeSession.payment_intent,
          stripe_customer_id: stripeSession.customer,
          amount_total: stripeSession.amount_total,
          currency: stripeSession.currency ?? 'gbp',
          status: 'active',
          metadata: { source: 'link-diagnostic' },
        })
        console.log('[link-diagnostic] entitlement created (webhook pending)')
      } else {
        console.log('[link-diagnostic] entitlement already exists, updated user_id')
      }
    }

    if (stripeEmail) {
      await sbFetch(
        `entitlements?customer_email=eq.${encodeURIComponent(stripeEmail)}&user_id=is.null`,
        'PATCH',
        { user_id: userId },
      )
    }

    return json({ success: true, diagnostic_id: diagnosticId })
  } catch (err) {
    console.error('[link-diagnostic] Error:', (err as Error).message)
    return json({ error: (err as Error).message }, 500)
  }
})
