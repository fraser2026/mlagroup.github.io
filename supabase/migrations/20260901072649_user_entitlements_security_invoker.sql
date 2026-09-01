-- Already applied live. Shared entitlements view must not expose all rows via the anon key.
CREATE OR REPLACE VIEW public.user_entitlements
WITH (security_invoker = true) AS
 SELECT e.id,
    e.created_at,
    e.user_id,
    e.customer_email,
    e.diagnostic_id,
    e.product,
    e.framework_version,
    e.stripe_payment_intent,
    e.amount_total,
    e.currency,
    e.status,
    d.organisation,
    d.risk_band,
    d.adjusted_score
   FROM entitlements e
     LEFT JOIN diagnostic_results d ON d.id = e.diagnostic_id
  WHERE e.status = 'active'::text;

REVOKE ALL ON TABLE public.user_entitlements FROM anon, authenticated;
