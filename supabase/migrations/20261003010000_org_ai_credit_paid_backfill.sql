-- One-shot + reusable backfill: paid Essentials/Professional/Enterprise orgs with
-- live subscription that never received a subscription credit grant (or have no
-- balance row / $0 balance) get refill-to-cap via org_ai_credit_refill_subscription.
-- Idempotent: stripe_event_id = 'backfill:paid_v1:{org_id}'.

CREATE OR REPLACE FUNCTION public.org_ai_credit_backfill_paid_orgs(
  p_allowance_cents integer DEFAULT 500
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_count integer := 0;
  v_event_id text;
  v_has_grant boolean;
  v_bal integer;
BEGIN
  IF p_allowance_cents IS NULL OR p_allowance_cents < 0 THEN
    RAISE EXCEPTION 'invalid allowance';
  END IF;

  FOR r IN
    SELECT o.id AS org_id
    FROM public.organisations o
    LEFT JOIN public.org_ai_credit_balances b ON b.org_id = o.id
    WHERE lower(coalesce(o.plan, '')) IN ('essentials', 'professional', 'enterprise')
      AND lower(coalesce(o.subscription_status, '')) IN ('active', 'trialing')
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM public.org_ai_credit_ledger l
      WHERE l.org_id = r.org_id
        AND l.entry_type = 'grant_subscription'
        AND l.amount_cents > 0
    ) INTO v_has_grant;

    SELECT coalesce(
      (SELECT b.balance_cents FROM public.org_ai_credit_balances b WHERE b.org_id = r.org_id),
      0
    ) INTO v_bal;

    -- Prior positive subscription grant means cycle already started (possibly spent to $0).
    -- Leave those until the next invoice.paid / checkout refill.
    IF v_has_grant THEN
      CONTINUE;
    END IF;

    -- Already at a positive balance without a grant row (manual/legacy) — skip.
    IF v_bal > 0 THEN
      CONTINUE;
    END IF;

    v_event_id := 'backfill:paid_v1:' || r.org_id::text;
    PERFORM public.org_ai_credit_refill_subscription(
      r.org_id,
      v_event_id,
      p_allowance_cents,
      jsonb_build_object('source', 'org_ai_credit_backfill_paid_orgs')
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.org_ai_credit_backfill_paid_orgs FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_ai_credit_backfill_paid_orgs TO service_role;

-- Apply once for existing live paid orgs missing credits.
SELECT public.org_ai_credit_backfill_paid_orgs(500);
