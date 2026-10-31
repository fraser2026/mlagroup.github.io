-- Budget enforcement and contracted (negotiated) pricing.
--
-- Contracted pricing: an organisation records the discount it has agreed with a provider. Every
-- request keeps its list-price cost (cost_usd, which reconciliation compares with the provider's list
-- price) and gains contract_cost_usd, the amount the organisation expects to be invoiced. Budgets and
-- spend use the contracted cost.
--
-- Enforcement: a budget set to block makes the gateway refuse new requests once spend reaches the
-- budget, unless an owner or admin lifts the block for the rest of the month. Spend is read from a
-- running counter per agent and month, kept by a trigger, so the check stays fast at any volume.

-- ---------------------------------------------------------------------------
-- Request outcomes refused by RegAnchor before reaching the provider
-- ---------------------------------------------------------------------------

ALTER TABLE public.gateway_request_events DROP CONSTRAINT IF EXISTS gateway_request_events_outcome_check;
ALTER TABLE public.gateway_request_events ADD CONSTRAINT gateway_request_events_outcome_check CHECK (outcome IN (
  'success',
  'blocked_dlp_request',
  'blocked_dlp_response',
  'blocked_budget',
  'blocked_unpriced_model',
  'rate_limited',
  'provider_error',
  'gateway_error',
  'client_aborted',
  'stream_error'
));

-- ---------------------------------------------------------------------------
-- Contracted pricing
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.gateway_price_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'anthropic' CHECK (provider ~ '^[a-z0-9_-]+$'),
  model_id text CHECK (model_id IS NULL OR model_id ~ '^[a-z0-9][a-z0-9-]*$'),
  discount_pct numeric(6, 3) NOT NULL CHECK (discount_pct > 0 AND discount_pct < 100),
  effective_from date NOT NULL,
  effective_to date,
  reference text CHECK (reference IS NULL OR char_length(reference) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

COMMENT ON TABLE public.gateway_price_agreements IS
  'Contracted discounts off provider list price. effective_from is inclusive and effective_to exclusive, both '
  'UTC dates. model_id NULL covers every model; an agreement for a specific model takes precedence.';

CREATE INDEX IF NOT EXISTS gateway_price_agreements_org_idx
  ON public.gateway_price_agreements (org_id, provider, effective_from);

ALTER TABLE public.gateway_price_agreements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gateway_price_agreements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gateway_price_agreements TO authenticated;
GRANT ALL ON public.gateway_price_agreements TO service_role;

DROP POLICY IF EXISTS gateway_price_agreements_member_read ON public.gateway_price_agreements;
CREATE POLICY gateway_price_agreements_member_read ON public.gateway_price_agreements
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

-- Two agreements for the same models may not cover the same day.
CREATE OR REPLACE FUNCTION public.gateway_price_agreements_no_overlap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('gateway_price_agreements:' || NEW.org_id::text));
  IF EXISTS (
    SELECT 1 FROM public.gateway_price_agreements a
    WHERE a.org_id = NEW.org_id
      AND a.provider = NEW.provider
      AND a.model_id IS NOT DISTINCT FROM NEW.model_id
      AND a.id <> NEW.id
      AND a.effective_from < coalesce(NEW.effective_to, 'infinity'::date)
      AND NEW.effective_from < coalesce(a.effective_to, 'infinity'::date)
  ) THEN
    RAISE EXCEPTION 'Another agreement for these models already covers part of this period.'
      USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS gateway_price_agreements_no_overlap ON public.gateway_price_agreements;
CREATE TRIGGER gateway_price_agreements_no_overlap
  BEFORE INSERT OR UPDATE ON public.gateway_price_agreements
  FOR EACH ROW
  EXECUTE FUNCTION public.gateway_price_agreements_no_overlap();

ALTER TABLE public.gateway_request_events
  ADD COLUMN IF NOT EXISTS contract_cost_usd numeric(18, 8),
  ADD COLUMN IF NOT EXISTS price_agreement_id uuid;

COMMENT ON COLUMN public.gateway_request_events.contract_cost_usd IS
  'Cost at the organisation''s contracted price: list cost less any agreed discount, or the list cost when no '
  'agreement applies. NULL whenever cost_usd is NULL.';
COMMENT ON COLUMN public.gateway_request_events.price_agreement_id IS
  'The gateway_price_agreements row applied, kept as a reference even if the agreement is later removed.';

-- The list price row for a provider model at a moment. Dated snapshots (<model>-YYYYMMDD) match their base model.
CREATE OR REPLACE FUNCTION public.gateway_model_price_id(p_provider text, p_model text, p_at timestamptz)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT mp.id
  FROM public.model_prices mp
  WHERE mp.provider = p_provider
    AND (
      p_model = mp.model_id
      OR (
        left(p_model, length(mp.model_id) + 1) = mp.model_id || '-'
        AND substr(p_model, length(mp.model_id) + 2) ~ '^[0-9]{8}$'
      )
    )
    AND mp.effective_from <= p_at
    AND (mp.effective_to IS NULL OR mp.effective_to > p_at)
  ORDER BY mp.effective_from DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.gateway_model_price_id(text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gateway_model_price_id(text, text, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.gateway_events_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p public.model_prices%ROWTYPE;
  prompt_tokens bigint;
  in_rate numeric;
  out_rate numeric;
  rate_basis text := 'standard';
  geo numeric := 1;
  status text := 'priced';
  notes text[] := ARRAY[]::text[];
  c_input numeric;
  c_write_5m numeric;
  c_write_1h numeric;
  c_read numeric;
  c_output numeric;
  c_search numeric;
  ag_id uuid;
  ag_pct numeric;
BEGIN
  IF NEW.cost_status <> 'pending' THEN
    RETURN NEW;
  END IF;

  NEW.cost_breakdown := NULL;
  NEW.price_id := NULL;
  NEW.contract_cost_usd := NULL;
  NEW.price_agreement_id := NULL;

  IF NEW.input_tokens + NEW.output_tokens + NEW.cache_write_5m_tokens + NEW.cache_write_1h_tokens
     + NEW.cache_read_tokens + NEW.web_search_requests + NEW.code_execution_requests = 0 THEN
    IF NEW.outcome IN ('success', 'blocked_dlp_response', 'client_aborted', 'stream_error') THEN
      NEW.cost_usd := NULL;
      NEW.cost_status := 'needs_reconciliation';
      NEW.cost_breakdown := jsonb_build_object('notes', jsonb_build_array(
        'The provider may have billed this request but did not report usage to the gateway.'));
    ELSE
      NEW.cost_usd := 0;
      NEW.contract_cost_usd := 0;
      NEW.cost_status := 'not_billable';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO p
  FROM public.model_prices mp
  WHERE mp.id = public.gateway_model_price_id(NEW.provider, NEW.model, NEW.created_at);

  IF NOT FOUND THEN
    NEW.cost_usd := NULL;
    NEW.cost_status := 'unpriced';
    NEW.cost_breakdown := jsonb_build_object('notes', jsonb_build_array(
      format('No list price on record for model %s.', coalesce(NEW.model, 'unknown'))));
    RETURN NEW;
  END IF;

  prompt_tokens := NEW.input_tokens::bigint + NEW.cache_write_5m_tokens + NEW.cache_write_1h_tokens + NEW.cache_read_tokens;

  IF NEW.speed = 'fast' THEN
    IF p.fast_input_per_mtok IS NULL THEN
      NEW.cost_usd := NULL;
      NEW.cost_status := 'unpriced';
      NEW.price_id := p.id;
      NEW.cost_breakdown := jsonb_build_object('notes', jsonb_build_array(
        format('No fast mode price on record for model %s.', NEW.model)));
      RETURN NEW;
    END IF;
    in_rate := p.fast_input_per_mtok;
    out_rate := p.fast_output_per_mtok;
    rate_basis := 'fast';
  ELSIF p.long_context_threshold_tokens IS NOT NULL AND prompt_tokens > p.long_context_threshold_tokens THEN
    in_rate := p.long_input_per_mtok;
    out_rate := p.long_output_per_mtok;
    rate_basis := 'long_context';
  ELSE
    in_rate := p.input_per_mtok;
    out_rate := p.output_per_mtok;
  END IF;

  IF NEW.inference_geo IS NULL OR NEW.inference_geo IN ('', 'global') THEN
    geo := 1;
  ELSIF NEW.inference_geo = 'us' AND p.us_inference_multiplier IS NOT NULL THEN
    geo := p.us_inference_multiplier;
  ELSE
    status := 'needs_reconciliation';
    notes := notes || format('Inference region %s has no list multiplier on record.', NEW.inference_geo);
  END IF;

  IF NEW.service_tier IS NOT NULL AND NEW.service_tier NOT IN ('standard') THEN
    status := 'needs_reconciliation';
    notes := notes || format('Service tier %s is billed on contract terms.', NEW.service_tier);
  END IF;

  IF NEW.outcome IN ('client_aborted', 'stream_error', 'blocked_dlp_response') THEN
    status := 'needs_reconciliation';
    notes := notes || 'Usage may be incomplete because the response did not finish normally.'::text;
  END IF;

  IF NEW.code_execution_requests > 0 AND status = 'priced' THEN
    status := 'partial';
    notes := notes || 'Code execution container hours are billed separately by the provider.'::text;
  END IF;

  c_input    := NEW.input_tokens          * in_rate                                 / 1000000 * geo;
  c_write_5m := NEW.cache_write_5m_tokens * in_rate * p.cache_write_5m_multiplier   / 1000000 * geo;
  c_write_1h := NEW.cache_write_1h_tokens * in_rate * p.cache_write_1h_multiplier   / 1000000 * geo;
  c_read     := NEW.cache_read_tokens     * in_rate * p.cache_read_multiplier       / 1000000 * geo;
  c_output   := NEW.output_tokens         * out_rate                                / 1000000 * geo;
  c_search   := NEW.web_search_requests   * p.web_search_per_request;

  NEW.cost_usd := round(c_input + c_write_5m + c_write_1h + c_read + c_output + c_search, 8);
  NEW.cost_status := status;
  NEW.price_id := p.id;

  SELECT a.id, a.discount_pct INTO ag_id, ag_pct
  FROM public.gateway_price_agreements a
  WHERE a.org_id = NEW.org_id
    AND a.provider = NEW.provider
    AND (a.model_id IS NULL OR a.model_id = p.model_id)
    AND a.effective_from <= (NEW.created_at AT TIME ZONE 'UTC')::date
    AND (a.effective_to IS NULL OR a.effective_to > (NEW.created_at AT TIME ZONE 'UTC')::date)
  ORDER BY a.model_id IS NULL, a.effective_from DESC
  LIMIT 1;

  IF ag_id IS NULL THEN
    NEW.contract_cost_usd := NEW.cost_usd;
  ELSE
    NEW.contract_cost_usd := round(NEW.cost_usd * (100 - ag_pct) / 100, 8);
    NEW.price_agreement_id := ag_id;
  END IF;

  NEW.cost_breakdown := jsonb_build_object(
    'currency', p.currency,
    'rate_basis', rate_basis,
    'input_per_mtok', in_rate,
    'output_per_mtok', out_rate,
    'region_multiplier', geo,
    'lines', jsonb_build_object(
      'input', round(c_input, 8),
      'cache_write_5m', round(c_write_5m, 8),
      'cache_write_1h', round(c_write_1h, 8),
      'cache_read', round(c_read, 8),
      'output', round(c_output, 8),
      'web_search', round(c_search, 8)
    ),
    'notes', to_jsonb(notes)
  ) || CASE WHEN ag_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
    'agreement', jsonb_build_object('id', ag_id, 'discount_pct', ag_pct, 'contract_usd', NEW.contract_cost_usd)
  ) END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_events_price() FROM PUBLIC, anon, authenticated;

UPDATE public.gateway_request_events
SET contract_cost_usd = cost_usd
WHERE contract_cost_usd IS NULL AND cost_usd IS NOT NULL;

-- Re-price one organisation's requests after its contracted pricing changes.
CREATE OR REPLACE FUNCTION public.gateway_events_reprice_org(p_org_id uuid, p_from timestamptz, p_to timestamptz DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE public.gateway_request_events
  SET cost_status = 'pending'
  WHERE org_id = p_org_id
    AND created_at >= p_from
    AND (p_to IS NULL OR created_at < p_to)
    AND cost_status <> 'not_billable';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_events_reprice_org(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_events_reprice_org(uuid, timestamptz, timestamptz) TO service_role;

-- Discount Anthropic actually billed, from reconciliation, so a client can confirm or set their agreement
-- without finding the contract.
CREATE OR REPLACE FUNCTION public.gateway_price_agreement_suggestion(p_org_id uuid, p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'days', count(DISTINCT d.day),
    'from', min(d.day),
    'to', max(d.day),
    'list_usd', coalesce(sum(d.provider_list_usd), 0),
    'billed_usd', coalesce(sum(d.provider_billed_usd), 0),
    'discount_pct', CASE WHEN sum(d.provider_list_usd) > 0
      THEN round((1 - sum(d.provider_billed_usd) / sum(d.provider_list_usd)) * 100, 2) END
  )
  INTO result
  FROM public.gateway_reconciliation_days d
  WHERE d.org_id = p_org_id
    AND d.provider = 'anthropic'
    AND d.day >= (now() AT TIME ZONE 'UTC')::date - greatest(1, least(p_days, 92))
    AND d.status <> 'provider_pending'
    AND d.provider_list_usd > 0;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_price_agreement_suggestion(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gateway_price_agreement_suggestion(uuid, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Running spend per agent and month
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.gateway_spend_counters (
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL,
  period_start date NOT NULL,
  spend_usd numeric(20, 8) NOT NULL DEFAULT 0,
  unpriced_requests integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, asset_id, period_start)
);

COMMENT ON TABLE public.gateway_spend_counters IS
  'Contracted spend and unpriced request count per agent and UTC month, maintained by trigger on '
  'gateway_request_events with the same rules as gateway_budget_status. Read by the enforcement check.';

ALTER TABLE public.gateway_spend_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gateway_spend_counters FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.gateway_spend_counters TO service_role;

CREATE OR REPLACE FUNCTION public.gateway_spend_counters_apply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  old_spend numeric := 0;
  old_unpriced integer := 0;
  new_spend numeric := 0;
  new_unpriced integer := 0;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    old_spend := CASE WHEN OLD.cost_status IN ('priced', 'needs_reconciliation', 'partial', 'pending')
      THEN coalesce(OLD.contract_cost_usd, OLD.cost_usd, 0) ELSE 0 END;
    old_unpriced := CASE WHEN OLD.cost_usd IS NULL AND OLD.cost_status <> 'not_billable' THEN 1 ELSE 0 END;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    new_spend := CASE WHEN NEW.cost_status IN ('priced', 'needs_reconciliation', 'partial', 'pending')
      THEN coalesce(NEW.contract_cost_usd, NEW.cost_usd, 0) ELSE 0 END;
    new_unpriced := CASE WHEN NEW.cost_usd IS NULL AND NEW.cost_status <> 'not_billable' THEN 1 ELSE 0 END;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.org_id = NEW.org_id AND OLD.asset_id = NEW.asset_id
     AND date_trunc('month', OLD.created_at AT TIME ZONE 'UTC') = date_trunc('month', NEW.created_at AT TIME ZONE 'UTC') THEN
    IF new_spend = old_spend AND new_unpriced = old_unpriced THEN
      RETURN NULL;
    END IF;
    INSERT INTO public.gateway_spend_counters AS c (org_id, asset_id, period_start, spend_usd, unpriced_requests)
    VALUES (NEW.org_id, NEW.asset_id, date_trunc('month', NEW.created_at AT TIME ZONE 'UTC')::date,
            new_spend - old_spend, new_unpriced - old_unpriced)
    ON CONFLICT (org_id, asset_id, period_start) DO UPDATE
      SET spend_usd = c.spend_usd + EXCLUDED.spend_usd,
          unpriced_requests = c.unpriced_requests + EXCLUDED.unpriced_requests,
          updated_at = now();
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND (old_spend <> 0 OR old_unpriced <> 0) THEN
    INSERT INTO public.gateway_spend_counters AS c (org_id, asset_id, period_start, spend_usd, unpriced_requests)
    VALUES (OLD.org_id, OLD.asset_id, date_trunc('month', OLD.created_at AT TIME ZONE 'UTC')::date, -old_spend, -old_unpriced)
    ON CONFLICT (org_id, asset_id, period_start) DO UPDATE
      SET spend_usd = c.spend_usd + EXCLUDED.spend_usd,
          unpriced_requests = c.unpriced_requests + EXCLUDED.unpriced_requests,
          updated_at = now();
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND (new_spend <> 0 OR new_unpriced <> 0) THEN
    INSERT INTO public.gateway_spend_counters AS c (org_id, asset_id, period_start, spend_usd, unpriced_requests)
    VALUES (NEW.org_id, NEW.asset_id, date_trunc('month', NEW.created_at AT TIME ZONE 'UTC')::date, new_spend, new_unpriced)
    ON CONFLICT (org_id, asset_id, period_start) DO UPDATE
      SET spend_usd = c.spend_usd + EXCLUDED.spend_usd,
          unpriced_requests = c.unpriced_requests + EXCLUDED.unpriced_requests,
          updated_at = now();
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_spend_counters_apply() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS gateway_request_events_spend ON public.gateway_request_events;
CREATE TRIGGER gateway_request_events_spend
  AFTER INSERT OR UPDATE OR DELETE ON public.gateway_request_events
  FOR EACH ROW
  EXECUTE FUNCTION public.gateway_spend_counters_apply();

-- Recount one month from the request records. Runs daily as a safeguard and after this migration.
CREATE OR REPLACE FUNCTION public.gateway_spend_counters_rebuild(p_period_start date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period date := date_trunc('month', coalesce(p_period_start, (now() AT TIME ZONE 'UTC')::date))::date;
  n integer;
BEGIN
  LOCK TABLE public.gateway_spend_counters IN EXCLUSIVE MODE;
  DELETE FROM public.gateway_spend_counters WHERE period_start = v_period;
  INSERT INTO public.gateway_spend_counters (org_id, asset_id, period_start, spend_usd, unpriced_requests)
  SELECT
    e.org_id,
    e.asset_id,
    v_period,
    coalesce(sum(coalesce(e.contract_cost_usd, e.cost_usd, 0))
      FILTER (WHERE e.cost_status IN ('priced', 'needs_reconciliation', 'partial', 'pending')), 0),
    count(*) FILTER (WHERE e.cost_usd IS NULL AND e.cost_status <> 'not_billable')
  FROM public.gateway_request_events e
  WHERE e.created_at >= (v_period::timestamp AT TIME ZONE 'UTC')
    AND e.created_at < ((v_period + interval '1 month')::timestamp AT TIME ZONE 'UTC')
  GROUP BY e.org_id, e.asset_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_spend_counters_rebuild(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_spend_counters_rebuild(date) TO service_role;

SELECT public.gateway_spend_counters_rebuild(date_trunc('month', now() AT TIME ZONE 'UTC')::date);
SELECT public.gateway_spend_counters_rebuild((date_trunc('month', now() AT TIME ZONE 'UTC') - interval '1 month')::date);

-- ---------------------------------------------------------------------------
-- Enforcement
-- ---------------------------------------------------------------------------

ALTER TABLE public.gateway_budgets DROP CONSTRAINT IF EXISTS gateway_budgets_enforcement_check;
ALTER TABLE public.gateway_budgets ADD CONSTRAINT gateway_budgets_enforcement_check
  CHECK (enforcement IN ('monitor', 'block'));

CREATE TABLE IF NOT EXISTS public.gateway_budget_lifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id uuid NOT NULL REFERENCES public.gateway_budgets(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  period_start date NOT NULL CHECK (extract(day FROM period_start) = 1),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 10 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text,
  ended_at timestamptz,
  ended_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.gateway_budget_lifts IS
  'A block lifted by an owner or admin for the rest of one UTC month, with the reason given. Ending the '
  'lift reinstates the block. Every lift and reinstatement is also written to the audit log.';

CREATE UNIQUE INDEX IF NOT EXISTS gateway_budget_lifts_active_key
  ON public.gateway_budget_lifts (budget_id, period_start) WHERE ended_at IS NULL;

ALTER TABLE public.gateway_budget_lifts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gateway_budget_lifts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gateway_budget_lifts TO authenticated;
GRANT ALL ON public.gateway_budget_lifts TO service_role;

DROP POLICY IF EXISTS gateway_budget_lifts_member_read ON public.gateway_budget_lifts;
CREATE POLICY gateway_budget_lifts_member_read ON public.gateway_budget_lifts
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

-- Called by the gateway before every request. Agent budgets are checked before the organisation budget.
CREATE OR REPLACE FUNCTION public.gateway_enforcement_check(
  p_org_id uuid,
  p_asset_id uuid,
  p_model text,
  p_provider text DEFAULT 'anthropic',
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period date := date_trunc('month', p_at AT TIME ZONE 'UTC')::date;
  b record;
  spend numeric;
  enforced boolean := false;
BEGIN
  FOR b IN
    SELECT g.id, g.asset_id, g.amount_usd
    FROM public.gateway_budgets g
    WHERE g.org_id = p_org_id
      AND g.enforcement = 'block'
      AND (g.asset_id IS NULL OR g.asset_id = p_asset_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.gateway_budget_lifts l
        WHERE l.budget_id = g.id AND l.period_start = v_period AND l.ended_at IS NULL
      )
    ORDER BY g.asset_id IS NULL
  LOOP
    enforced := true;
    SELECT coalesce(sum(c.spend_usd), 0) INTO spend
    FROM public.gateway_spend_counters c
    WHERE c.org_id = p_org_id
      AND c.period_start = v_period
      AND (b.asset_id IS NULL OR c.asset_id = b.asset_id);
    IF spend >= b.amount_usd THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', 'budget_reached',
        'scope', CASE WHEN b.asset_id IS NULL THEN 'organisation' ELSE 'agent' END,
        'budget_id', b.id
      );
    END IF;
  END LOOP;

  IF enforced AND public.gateway_model_price_id(p_provider, p_model, p_at) IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'unpriced_model');
  END IF;

  RETURN jsonb_build_object('allowed', true, 'enforced', enforced);
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_enforcement_check(uuid, uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_enforcement_check(uuid, uuid, text, text, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- Read models: contracted spend, list spend, enforcement state
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.gateway_budget_status(p_org_id uuid, p_at timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT
      date_trunc('month', p_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS period_start,
      (date_trunc('month', p_at AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC' AS period_end,
      date_trunc('month', p_at AT TIME ZONE 'UTC')::date AS period_day
  ),
  elapsed AS (
    SELECT
      b.*,
      LEAST(1.0, GREATEST(0.0,
        extract(epoch FROM (p_at - b.period_start)) / extract(epoch FROM (b.period_end - b.period_start))
      ))::numeric AS fraction,
      -- Projections start once three full days of the month have elapsed.
      (p_at - b.period_start) >= interval '3 days' AS can_project
    FROM bounds b
  ),
  ev AS (
    SELECT e.asset_id, e.cost_status, e.cost_usd, coalesce(e.contract_cost_usd, e.cost_usd) AS spend_usd
    FROM public.gateway_request_events e, bounds b
    WHERE e.org_id = p_org_id
      AND e.created_at >= b.period_start
      AND e.created_at < LEAST(b.period_end, p_at + interval '1 second')
  ),
  spend AS (
    SELECT
      CASE WHEN grouping(asset_id) = 1 THEN NULL ELSE asset_id END AS asset_id,
      grouping(asset_id) = 1 AS is_total,
      count(*) AS requests,
      coalesce(sum(spend_usd) FILTER (WHERE cost_status = 'priced'), 0) AS exact_usd,
      coalesce(sum(spend_usd) FILTER (WHERE cost_status IN ('needs_reconciliation', 'partial', 'pending')), 0) AS estimated_usd,
      coalesce(sum(cost_usd) FILTER (WHERE cost_status IN ('priced', 'needs_reconciliation', 'partial', 'pending')), 0) AS list_usd,
      count(*) FILTER (WHERE cost_usd IS NULL AND cost_status <> 'not_billable') AS unpriced_requests
    FROM ev
    GROUP BY GROUPING SETS ((asset_id), ())
  ),
  rows AS (
    SELECT
      g.id,
      g.asset_id,
      s.name AS asset_name,
      g.amount_usd,
      g.warn_at_pct,
      g.enforcement,
      g.updated_at,
      coalesce(sp.requests, 0) AS requests,
      coalesce(sp.exact_usd, 0) AS exact_usd,
      coalesce(sp.estimated_usd, 0) AS estimated_usd,
      coalesce(sp.exact_usd, 0) + coalesce(sp.estimated_usd, 0) AS spend_usd,
      coalesce(sp.unpriced_requests, 0) AS unpriced_requests,
      lift.lift
    FROM public.gateway_budgets g
    CROSS JOIN bounds bd
    LEFT JOIN public.ai_systems s ON s.id = g.asset_id
    LEFT JOIN spend sp
      ON (g.asset_id IS NULL AND sp.is_total) OR (g.asset_id IS NOT NULL AND sp.asset_id = g.asset_id)
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'id', l.id,
        'reason', l.reason,
        'created_at', l.created_at,
        'created_by_name', l.created_by_name
      ) AS lift
      FROM public.gateway_budget_lifts l
      WHERE l.budget_id = g.id AND l.period_start = bd.period_day AND l.ended_at IS NULL
      LIMIT 1
    ) lift ON true
    WHERE g.org_id = p_org_id
  )
  SELECT jsonb_build_object(
    'as_of', p_at,
    'period_start', e.period_start,
    'period_end', e.period_end,
    'elapsed_fraction', round(e.fraction, 6),
    'currency', 'USD',
    'org_spend', (
      SELECT jsonb_build_object(
        'requests', coalesce(sp.requests, 0),
        'exact_usd', coalesce(sp.exact_usd, 0),
        'estimated_usd', coalesce(sp.estimated_usd, 0),
        'spend_usd', coalesce(sp.exact_usd, 0) + coalesce(sp.estimated_usd, 0),
        'list_usd', coalesce(sp.list_usd, 0),
        'unpriced_requests', coalesce(sp.unpriced_requests, 0),
        'projected_usd', CASE WHEN e.can_project
          THEN round((coalesce(sp.exact_usd, 0) + coalesce(sp.estimated_usd, 0)) / e.fraction, 8) END
      )
      FROM (SELECT 1) one
      LEFT JOIN spend sp ON sp.is_total
    ),
    'budgets', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id,
        'asset_id', r.asset_id,
        'asset_name', r.asset_name,
        'amount_usd', r.amount_usd,
        'warn_at_pct', r.warn_at_pct,
        'enforcement', r.enforcement,
        'updated_at', r.updated_at,
        'requests', r.requests,
        'exact_usd', r.exact_usd,
        'estimated_usd', r.estimated_usd,
        'spend_usd', r.spend_usd,
        'unpriced_requests', r.unpriced_requests,
        'used_pct', round(r.spend_usd / r.amount_usd * 100, 2),
        'remaining_usd', r.amount_usd - r.spend_usd,
        'projected_usd', CASE WHEN e.can_project THEN round(r.spend_usd / e.fraction, 8) END,
        'state', CASE
          WHEN r.spend_usd >= r.amount_usd THEN 'over'
          WHEN r.spend_usd * 100 >= r.amount_usd * r.warn_at_pct THEN 'warn'
          WHEN e.can_project AND r.spend_usd / e.fraction > r.amount_usd THEN 'projected_over'
          ELSE 'ok'
        END,
        'lift', r.lift,
        'blocking', r.enforcement = 'block' AND r.lift IS NULL AND r.spend_usd >= r.amount_usd
      ) ORDER BY r.asset_id IS NOT NULL, r.spend_usd DESC), '[]'::jsonb)
      FROM rows r
    )
  )
  FROM elapsed e;
$$;

REVOKE ALL ON FUNCTION public.gateway_budget_status(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gateway_budget_status(uuid, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.gateway_usage_summary(
  p_org_id uuid,
  p_asset_id uuid DEFAULT NULL,
  p_since timestamptz DEFAULT now() - interval '30 days'
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH ev AS (
    SELECT e.*, coalesce(e.contract_cost_usd, e.cost_usd) AS spend_usd
    FROM public.gateway_request_events e
    WHERE e.org_id = p_org_id
      AND e.created_at >= p_since
      AND (p_asset_id IS NULL OR e.asset_id = p_asset_id)
  )
  SELECT jsonb_build_object(
    'since', p_since,
    'totals', (
      SELECT jsonb_build_object(
        'requests', count(*),
        'success', count(*) FILTER (WHERE outcome = 'success'),
        'flagged', count(*) FILTER (WHERE dlp_action = 'FLAG'),
        'blocked', count(*) FILTER (WHERE outcome IN ('blocked_dlp_request', 'blocked_dlp_response')),
        'policy_blocked', count(*) FILTER (WHERE outcome IN ('blocked_budget', 'blocked_unpriced_model')),
        'rate_limited', count(*) FILTER (WHERE outcome = 'rate_limited'),
        'errors', count(*) FILTER (WHERE outcome IN ('provider_error', 'gateway_error', 'stream_error')),
        'aborted', count(*) FILTER (WHERE outcome = 'client_aborted'),
        'fallback', count(*) FILTER (WHERE route = 'direct_fallback'),
        'cost_usd', coalesce(sum(spend_usd), 0),
        'list_cost_usd', coalesce(sum(cost_usd), 0),
        'cost_open', count(*) FILTER (WHERE cost_status IN ('pending', 'partial', 'unpriced', 'needs_reconciliation')),
        'input_tokens', coalesce(sum(input_tokens), 0),
        'output_tokens', coalesce(sum(output_tokens), 0),
        'cache_read_tokens', coalesce(sum(cache_read_tokens), 0),
        'cache_write_tokens', coalesce(sum(coalesce(cache_write_5m_tokens, 0) + coalesce(cache_write_1h_tokens, 0)), 0),
        'latency_p50_ms', percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE outcome = 'success'),
        'latency_p95_ms', percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE outcome = 'success'),
        'last_request_at', max(created_at)
      )
      FROM ev
    ),
    'daily', (
      SELECT coalesce(jsonb_agg(d ORDER BY d.day), '[]'::jsonb)
      FROM (
        SELECT
          (created_at AT TIME ZONE 'UTC')::date AS day,
          count(*) AS requests,
          coalesce(sum(spend_usd), 0) AS cost_usd,
          count(*) FILTER (WHERE dlp_action IS NOT NULL) AS dlp,
          count(*) FILTER (WHERE outcome IN ('provider_error', 'gateway_error', 'stream_error', 'rate_limited')) AS issues
        FROM ev
        GROUP BY 1
      ) d
    ),
    'models', (
      SELECT coalesce(jsonb_agg(m ORDER BY m.cost_usd DESC, m.requests DESC), '[]'::jsonb)
      FROM (
        SELECT
          coalesce(model, request_model, 'unknown') AS model,
          count(*) AS requests,
          coalesce(sum(spend_usd), 0) AS cost_usd,
          coalesce(sum(input_tokens), 0) AS input_tokens,
          coalesce(sum(output_tokens), 0) AS output_tokens
        FROM ev
        GROUP BY 1
        ORDER BY 3 DESC, 2 DESC
        LIMIT 20
      ) m
    ),
    'assets', (
      SELECT coalesce(jsonb_agg(a ORDER BY a.cost_usd DESC, a.requests DESC), '[]'::jsonb)
      FROM (
        SELECT
          ev.asset_id,
          s.name,
          count(*) AS requests,
          coalesce(sum(ev.spend_usd), 0) AS cost_usd,
          count(*) FILTER (WHERE ev.dlp_action IS NOT NULL) AS dlp,
          count(*) FILTER (WHERE ev.outcome IN ('provider_error', 'gateway_error', 'stream_error', 'rate_limited')) AS issues,
          max(ev.created_at) AS last_request_at
        FROM ev
        LEFT JOIN public.ai_systems s ON s.id = ev.asset_id
        GROUP BY ev.asset_id, s.name
        ORDER BY 4 DESC, 3 DESC
        LIMIT 100
      ) a
    ),
    'tokens', (
      SELECT coalesce(jsonb_agg(t), '[]'::jsonb)
      FROM (
        SELECT token_id, count(*) AS requests, max(created_at) AS last_request_at
        FROM ev
        WHERE token_id IS NOT NULL
        GROUP BY token_id
      ) t
    ),
    'outcomes', (
      SELECT coalesce(jsonb_object_agg(outcome, n), '{}'::jsonb)
      FROM (SELECT outcome, count(*) AS n FROM ev GROUP BY outcome) o
    )
  );
$$;

REVOKE ALL ON FUNCTION public.gateway_usage_summary(uuid, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gateway_usage_summary(uuid, uuid, timestamptz) TO authenticated, service_role;

-- Over-budget alerts say whether requests are now refused.
CREATE OR REPLACE FUNCTION public.gateway_budget_alerts_sync(p_org_id uuid DEFAULT NULL, p_at timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  o record;
  s jsonb;
  b jsonb;
  lvl text;
  scope text;
  org_name text;
  inserted integer;
  new_alert uuid;
  created integer := 0;
  period date;
  over_tail text;
BEGIN
  FOR o IN
    SELECT DISTINCT gb.org_id FROM public.gateway_budgets gb
    WHERE p_org_id IS NULL OR gb.org_id = p_org_id
  LOOP
    s := public.gateway_budget_status(o.org_id, p_at);
    period := (s->>'period_start')::timestamptz AT TIME ZONE 'UTC';
    SELECT coalesce(nullif(trim(name), ''), 'Your organisation') INTO org_name
    FROM public.organisations WHERE id = o.org_id;

    FOR b IN SELECT * FROM jsonb_array_elements(coalesce(s->'budgets', '[]'::jsonb)) LOOP
      lvl := CASE b->>'state' WHEN 'over' THEN 'over' WHEN 'warn' THEN 'warn' WHEN 'projected_over' THEN 'projected' END;
      CONTINUE WHEN lvl IS NULL;

      INSERT INTO public.gateway_budget_alert_log (budget_id, period_start, level, amount_usd)
      VALUES ((b->>'id')::uuid, period, lvl, (b->>'amount_usd')::numeric)
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS inserted = ROW_COUNT;
      CONTINUE WHEN inserted = 0;

      scope := coalesce(nullif(b->>'asset_name', ''), org_name);
      over_tail := CASE
        WHEN (b->>'blocking')::boolean THEN
          'New requests are now refused until the budget is raised, the block is lifted, or the month ends.'
        WHEN b->>'enforcement' = 'block' THEN
          'The block has been lifted for this month, so requests continue.'
        ELSE 'This budget monitors spend and does not block requests.'
      END;
      INSERT INTO public.governance_alerts (org_id, system_id, alert_type, severity, title, body, ref_id, ref_type)
      VALUES (
        o.org_id,
        nullif(b->>'asset_id', '')::uuid,
        CASE lvl WHEN 'over' THEN 'budget_over' WHEN 'warn' THEN 'budget_warning' ELSE 'budget_projected' END,
        CASE lvl WHEN 'over' THEN 'critical' ELSE 'warning' END,
        CASE lvl
          WHEN 'over' THEN format('Over budget: %s', scope)
          WHEN 'warn' THEN format('Budget warning: %s', scope)
          ELSE format('Projected over budget: %s', scope)
        END,
        CASE lvl
          WHEN 'over' THEN format(
            '%s has spent %s this month, %s%% of its %s monthly budget. %s Months run in UTC.',
            scope, public.gateway_fmt_usd((b->>'spend_usd')::numeric), b->>'used_pct', public.gateway_fmt_usd((b->>'amount_usd')::numeric), over_tail)
          WHEN 'warn' THEN format(
            '%s has spent %s this month, %s%% of its %s monthly budget. The warning level is %s%%.%s Months run in UTC.',
            scope, public.gateway_fmt_usd((b->>'spend_usd')::numeric), b->>'used_pct', public.gateway_fmt_usd((b->>'amount_usd')::numeric), b->>'warn_at_pct',
            CASE WHEN b->>'enforcement' = 'block' THEN ' Requests will be refused at 100%.' ELSE '' END)
          ELSE format(
            'At the average daily rate so far, %s will spend about %s by the end of the month, above its %s monthly budget. Spent so far: %s.%s Months run in UTC.',
            scope, public.gateway_fmt_usd((b->>'projected_usd')::numeric), public.gateway_fmt_usd((b->>'amount_usd')::numeric), public.gateway_fmt_usd((b->>'spend_usd')::numeric),
            CASE WHEN b->>'enforcement' = 'block' THEN ' Requests will be refused at 100%.' ELSE '' END)
        END,
        (b->>'id')::uuid,
        'gateway_budget'
      )
      RETURNING id INTO new_alert;

      UPDATE public.gateway_budget_alert_log
      SET alert_id = new_alert
      WHERE budget_id = (b->>'id')::uuid AND period_start = period AND level = lvl AND amount_usd = (b->>'amount_usd')::numeric;

      PERFORM public.gateway_budget_alert_dispatch(new_alert, o.org_id);
      created := created + 1;
    END LOOP;
  END LOOP;

  RETURN created;
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_budget_alerts_sync(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_budget_alerts_sync(uuid, timestamptz) TO service_role;
