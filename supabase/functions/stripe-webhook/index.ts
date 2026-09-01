// MLA GROUP — Stripe Webhook Handler
// Zero external imports — pure Deno built-ins only

// Verify Stripe webhook signature using built-in crypto
async function verifySignature(body: string, signature: string, secret: string): Promise<boolean> {
  try {
    const parts: Record<string, string> = {}
    signature.split(',').forEach(p => {
      const [k, v] = p.split('=')
      parts[k] = v
    })
    const t = parts['t']
    const v1 = parts['v1']
    if (!t || !v1) return false

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const signed = await crypto.subtle.sign(
      'HMAC', key,
      new TextEncoder().encode(`${t}.${body}`)
    )
    const computed = Array.from(new Uint8Array(signed))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    return computed === v1
  } catch {
    return false
  }
}

// Supabase REST helper — no SDK needed
function sbFetch(path: string, method: string, body?: unknown) {
  const url = Deno.env.get('SUPABASE_URL') + '/rest/v1/' + path
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return fetch(url, {
    method,
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal'
    },
    body: body ? JSON.stringify(body) : undefined
  })
}

// Find user by email via auth admin API
async function findUserByEmail(email: string): Promise<string | null> {
  const url = Deno.env.get('SUPABASE_URL') + '/auth/v1/admin/users?page=1&per_page=1000'
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const res = await fetch(url, {
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key
    }
  })
  if (!res.ok) return null
  const data = await res.json()
  const users = data.users ?? []
  const found = users.find((u: Record<string, unknown>) =>
    (u.email as string)?.toLowerCase() === email.toLowerCase()
  )
  return found ? found.id as string : null
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const sig = req.headers.get('stripe-signature') ?? ''
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''
  const body = await req.text()

  const valid = await verifySignature(body, sig, secret)
  if (!valid) {
    console.error('Invalid Stripe signature')
    return new Response('Invalid signature', { status: 400 })
  }

  let event: Record<string, unknown>
  try {
    event = JSON.parse(body)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  console.log('Event:', event.type, event.id)

  // ── checkout.session.completed ──────────────────────────
  if (event.type === 'checkout.session.completed') {
    const session = (event.data as Record<string, unknown>)?.object as Record<string, unknown>

    if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
      return new Response(JSON.stringify({ received: true }), { status: 200 })
    }

    const details = session.customer_details as Record<string, unknown> ?? {}
    const email = ((details.email ?? session.customer_email) as string ?? '').toLowerCase().trim()

    if (!email) {
      return new Response('No email', { status: 400 })
    }

    // Read result_id from Stripe session metadata — set by create-checkout-session
    const metadata = session.metadata as Record<string, string> ?? {}
    const resultId = metadata.result_id || null

    console.log('Payment for:', email, '| result_id:', resultId ?? 'none')

    // Find user
    const userId = await findUserByEmail(email)
    console.log('User ID:', userId ?? 'not found — saving by email only')

    // Set paid=true on profile
    if (userId) {
      await sbFetch(
        `profiles?id=eq.${userId}`,
        'PATCH',
        { paid: true }
      )
    }

    // Link diagnostic to user
    // Priority 1: use result_id from Stripe metadata — survives any redirect/sessionStorage wipe
    let diagnosticId: string | null = resultId

    if (resultId && userId) {
      await sbFetch(
        `diagnostic_results?id=eq.${resultId}`,
        'PATCH',
        { user_id: userId }
      )
      console.log('Linked diagnostic:', resultId, 'to user:', userId)
    } else if (userId && !resultId) {
      // Priority 2: fallback — find most recent unlinked diagnostic by email
      const r = await sbFetch(
        `diagnostic_results?respondent_email=eq.${email}&user_id=is.null&order=created_at.desc&limit=1&select=id`,
        'GET'
      )
      if (r.ok) {
        const rows = await r.json()
        diagnosticId = rows[0]?.id ?? null
        if (diagnosticId) {
          await sbFetch(
            `diagnostic_results?id=eq.${diagnosticId}`,
            'PATCH',
            { user_id: userId }
          )
          console.log('Fallback linked diagnostic:', diagnosticId, 'to user:', userId)
        }
      }
    }

    // Insert entitlement
    await sbFetch('entitlements', 'POST', {
      user_id:               userId,
      customer_email:        email,
      diagnostic_id:         diagnosticId,
      product:               'premium_report',
      framework_version:     '2.0.0',
      stripe_session_id:     session.id,
      stripe_payment_intent: session.payment_intent,
      stripe_customer_id:    session.customer,
      amount_total:          session.amount_total,
      currency:              session.currency ?? 'gbp',
      status:                'active',
      metadata:              { event_id: event.id }
    })

    console.log('Entitlement created for:', email)
  }

  // ── charge.refunded ─────────────────────────────────────
  if (event.type === 'charge.refunded') {
    const charge = (event.data as Record<string, unknown>)?.object as Record<string, unknown>
    const pi = charge.payment_intent as string
    if (pi) {
      await sbFetch(
        `entitlements?stripe_payment_intent=eq.${pi}`,
        'PATCH',
        { status: 'refunded' }
      )
      console.log('Refunded PI:', pi)
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
})
