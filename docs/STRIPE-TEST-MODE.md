# Stripe test mode cutover

## Why both keys must match

| Layer | Test | Live |
|---|---|---|
| Browser (`js/stripe-config.js`) | `pk_test_…` | `pk_live_…` |
| Supabase `STRIPE_SECRET_KEY` | `sk_test_…` | `sk_live_…` |
| Webhook signing secret | Test endpoint secret | Live endpoint secret |

If the publishable and secret keys are from different modes, Checkout fails.

## Enable test mode (now)

1. Open [Stripe Dashboard → API keys (Test mode)](https://dashboard.stripe.com/test/apikeys).
2. Copy **Publishable key** (`pk_test_…`) into `js/stripe-config.js`:

```js
var TEST_PK = 'pk_test_…'; // paste here
// mode is already 'test'
```

3. In **Supabase → Project Settings → Edge Functions → Secrets**, set:

- `STRIPE_SECRET_KEY` = `sk_test_…` (from the same Test API keys page)

4. Stripe webhooks (Test mode): add/endpoint

- URL: `https://hueftewwenjaiagdoqmb.supabase.co/functions/v1/subscription-webhook`
- Events: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`
- Copy signing secret → `STRIPE_SUBSCRIPTION_WEBHOOK_SECRET` (or keep a separate secret name if you already use one for live)

5. Deploy/push the frontend. You should see a black **Stripe test mode** bar on pricing.

## Test cards

- Success: `4242 4242 4242 4242`
- Any future expiry, any CVC, any postcode

## How prices work in test

Edge functions detect `sk_test` and build one-off catalog prices (Essentials £129 / Professional £249 / Report £295). No need to duplicate live Price IDs in the Dashboard unless you want them.

## Pay-first journey (public)

1. `/pricing.html` → Get started (guest) → embedded Checkout  
2. Pay with test card  
3. → `/subscription-success.html` modal: name, work email, company, role, password  
4. Account created → plan claimed → portal

## Flip back to live

1. `js/stripe-config.js` → `mode: 'live'`
2. Supabase `STRIPE_SECRET_KEY` → `sk_live_…`
3. Restore live webhook secret if you overwrote it
