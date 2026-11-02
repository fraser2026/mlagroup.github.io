-- Amazon Bedrock through the governed gateway.
--
-- The model provider stays Anthropic; infrastructure records where the request ran (Anthropic's API
-- or Amazon Bedrock in the client's AWS account), with the AWS account and region. Bedrock requests
-- are priced from bedrock_prices at the rate in force for that region, model and scope (in-region or
-- geographic profile versus global profile). Anthropic discount agreements and the Anthropic cost
-- report comparison apply to Anthropic API traffic only.

ALTER TABLE public.gateway_request_events
  ADD COLUMN IF NOT EXISTS infrastructure text NOT NULL DEFAULT 'anthropic_api',
  ADD COLUMN IF NOT EXISTS org_aws_account_id uuid,
  ADD COLUMN IF NOT EXISTS aws_region text;

ALTER TABLE public.gateway_request_events DROP CONSTRAINT IF EXISTS gateway_request_events_infrastructure_check;
ALTER TABLE public.gateway_request_events ADD CONSTRAINT gateway_request_events_infrastructure_check CHECK (
  (infrastructure = 'anthropic_api' AND org_aws_account_id IS NULL AND aws_region IS NULL)
  OR (infrastructure = 'aws_bedrock' AND aws_region IS NOT NULL AND aws_region ~ '^[a-z]{2}(-[a-z]+)+-\d$')
);

COMMENT ON COLUMN public.gateway_request_events.infrastructure IS
  'Where the request ran: anthropic_api (Anthropic directly) or aws_bedrock (Amazon Bedrock in the client''s AWS account).';
COMMENT ON COLUMN public.gateway_request_events.org_aws_account_id IS
  'aws_bedrock only: the org_aws_accounts row used, kept as a reference after the account is disconnected.';
COMMENT ON COLUMN public.gateway_request_events.aws_region IS
  'aws_bedrock only: the AWS Region the request was sent to. Prices are read for this Region.';

CREATE INDEX IF NOT EXISTS gateway_request_events_bedrock_region_idx
  ON public.gateway_request_events (aws_region, created_at)
  WHERE infrastructure = 'aws_bedrock';

-- Bedrock model ID to price list key, mirroring bedrockModelKey() in the edge functions.
-- "eu.anthropic.claude-haiku-4-5-20251001-v1:0" -> anthropic, claude-haiku-4-5, regional, eu.
CREATE OR REPLACE FUNCTION public.gateway_bedrock_model_key(p_model text)
RETURNS TABLE (provider text, model_key text, scope text, profile text)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  s text := lower(btrim(coalesce(p_model, '')));
  parts text[];
BEGIN
  s := regexp_replace(s, ':\d+$', '');
  s := regexp_replace(s, '-v\d+$', '');
  s := regexp_replace(s, '-\d{8}$', '');
  parts := string_to_array(s, '.');
  IF coalesce(array_length(parts, 1), 0) = 3 THEN
    profile := parts[1];
    provider := parts[2];
    model_key := parts[3];
  ELSIF coalesce(array_length(parts, 1), 0) = 2 THEN
    profile := NULL;
    provider := parts[1];
    model_key := parts[2];
  ELSE
    RETURN;
  END IF;
  IF provider !~ '^[a-z0-9][a-z0-9-]*$' OR model_key !~ '^[a-z0-9][a-z0-9-]*$'
     OR (profile IS NOT NULL AND profile !~ '^[a-z][a-z-]*$') THEN
    RETURN;
  END IF;
  scope := CASE WHEN profile = 'global' THEN 'global' ELSE 'regional' END;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_bedrock_model_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gateway_bedrock_model_key(text) TO authenticated, service_role;

-- True when Bedrock lists standard input and output prices for the model in the region at that moment.
CREATE OR REPLACE FUNCTION public.gateway_bedrock_model_priced(p_region text, p_model text, p_at timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT count(DISTINCT p.dimension) = 2
  FROM public.gateway_bedrock_model_key(p_model) k
  CROSS JOIN LATERAL public.bedrock_price_at(p_region, k.provider, k.model_key, k.scope, 'on_demand', false, p_at) p
  WHERE p.dimension IN ('input', 'output');
$$;

REVOKE ALL ON FUNCTION public.gateway_bedrock_model_priced(text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gateway_bedrock_model_priced(text, text, timestamptz) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Pricing: Anthropic API rows as before, Amazon Bedrock rows from bedrock_prices
-- ---------------------------------------------------------------------------

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
  b_provider text;
  b_key text;
  b_scope text;
  b_long boolean := false;
  b_threshold integer;
  b_rates jsonb;
  b_ids jsonb;
  b_missing text[] := ARRAY[]::text[];
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

  prompt_tokens := NEW.input_tokens::bigint + NEW.cache_write_5m_tokens + NEW.cache_write_1h_tokens + NEW.cache_read_tokens;

  IF NEW.infrastructure = 'aws_bedrock' THEN
    SELECT k.provider, k.model_key, k.scope INTO b_provider, b_key, b_scope
    FROM public.gateway_bedrock_model_key(coalesce(NEW.request_model, NEW.model)) k;

    IF b_key IS NULL THEN
      NEW.cost_usd := NULL;
      NEW.cost_status := 'unpriced';
      NEW.cost_breakdown := jsonb_build_object('notes', jsonb_build_array(
        format('%s is not an Amazon Bedrock model ID RegAnchor can price.', coalesce(NEW.request_model, NEW.model, 'This model'))));
      RETURN NEW;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.bedrock_price_at(NEW.aws_region, b_provider, b_key, b_scope, 'on_demand', true, NEW.created_at)
    ) THEN
      SELECT mp.long_context_threshold_tokens INTO b_threshold
      FROM public.model_prices mp
      WHERE mp.id = public.gateway_model_price_id(b_provider, b_key, NEW.created_at);
      IF b_threshold IS NULL THEN
        status := 'needs_reconciliation';
        notes := notes || 'AWS lists long context rates for this model, but RegAnchor has no threshold on record.'::text;
      ELSIF prompt_tokens > b_threshold THEN
        b_long := true;
        rate_basis := 'long_context';
      END IF;
    END IF;

    SELECT jsonb_object_agg(x.dimension, x.usd_per_mtok), jsonb_agg(x.price_id ORDER BY x.price_id)
    INTO b_rates, b_ids
    FROM public.bedrock_price_at(NEW.aws_region, b_provider, b_key, b_scope, 'on_demand', b_long, NEW.created_at) x;
    b_rates := coalesce(b_rates, '{}'::jsonb);

    IF NOT b_rates ? 'input' THEN b_missing := b_missing || 'input'::text; END IF;
    IF NOT b_rates ? 'output' THEN b_missing := b_missing || 'output'::text; END IF;
    IF NEW.cache_read_tokens > 0 AND NOT b_rates ? 'cache_read' THEN b_missing := b_missing || 'cache read'::text; END IF;
    IF NEW.cache_write_5m_tokens > 0 AND NOT b_rates ? 'cache_write_5m' THEN b_missing := b_missing || '5-minute cache write'::text; END IF;
    IF NEW.cache_write_1h_tokens > 0 AND NOT b_rates ? 'cache_write_1h' THEN b_missing := b_missing || '1-hour cache write'::text; END IF;

    IF cardinality(b_missing) > 0 THEN
      NEW.cost_usd := NULL;
      NEW.cost_status := 'unpriced';
      NEW.cost_breakdown := jsonb_build_object(
        'source', 'aws_bedrock',
        'region', NEW.aws_region,
        'scope', b_scope,
        'model_key', b_key,
        'notes', jsonb_build_array(format('No Amazon Bedrock %s price on record for %s (%s, %s).',
          array_to_string(b_missing, ', '), b_key, NEW.aws_region, b_scope))
      );
      RETURN NEW;
    END IF;

    IF NEW.service_tier IS NOT NULL AND NEW.service_tier NOT IN ('standard') THEN
      status := 'needs_reconciliation';
      notes := notes || format('Service tier %s on Amazon Bedrock is priced differently and is not on record.', NEW.service_tier);
    END IF;
    IF NEW.speed IS NOT NULL AND NEW.speed NOT IN ('standard') THEN
      status := 'needs_reconciliation';
      notes := notes || format('Speed %s on Amazon Bedrock has no price on record.', NEW.speed);
    END IF;
    IF NEW.outcome IN ('client_aborted', 'stream_error', 'blocked_dlp_response') THEN
      status := 'needs_reconciliation';
      notes := notes || 'Usage may be incomplete because the response did not finish normally.'::text;
    END IF;
    IF (NEW.web_search_requests > 0 OR NEW.code_execution_requests > 0) AND status = 'priced' THEN
      status := 'partial';
      notes := notes || 'Server tool charges are billed separately by AWS.'::text;
    END IF;

    in_rate := (b_rates->>'input')::numeric;
    out_rate := (b_rates->>'output')::numeric;
    c_input    := NEW.input_tokens          * in_rate                                           / 1000000;
    c_write_5m := NEW.cache_write_5m_tokens * coalesce((b_rates->>'cache_write_5m')::numeric, 0) / 1000000;
    c_write_1h := NEW.cache_write_1h_tokens * coalesce((b_rates->>'cache_write_1h')::numeric, 0) / 1000000;
    c_read     := NEW.cache_read_tokens     * coalesce((b_rates->>'cache_read')::numeric, 0)     / 1000000;
    c_output   := NEW.output_tokens         * out_rate                                          / 1000000;

    NEW.cost_usd := round(c_input + c_write_5m + c_write_1h + c_read + c_output, 8);
    NEW.contract_cost_usd := NEW.cost_usd;
    NEW.cost_status := status;
    NEW.cost_breakdown := jsonb_build_object(
      'currency', 'USD',
      'source', 'aws_bedrock',
      'region', NEW.aws_region,
      'scope', b_scope,
      'model_key', b_key,
      'rate_basis', rate_basis,
      'input_per_mtok', in_rate,
      'output_per_mtok', out_rate,
      'region_multiplier', 1,
      'rates', b_rates,
      'bedrock_price_ids', b_ids,
      'lines', jsonb_build_object(
        'input', round(c_input, 8),
        'cache_write_5m', round(c_write_5m, 8),
        'cache_write_1h', round(c_write_1h, 8),
        'cache_read', round(c_read, 8),
        'output', round(c_output, 8),
        'web_search', 0
      ),
      'notes', to_jsonb(notes)
    );
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

-- When AWS prices arrive or change, re-price Bedrock requests they cover (last 35 days at most), so a
-- request made before the daily sync picked up a price is not left unpriced or at the old rate.
CREATE OR REPLACE FUNCTION public.gateway_events_reprice_bedrock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.tier <> 'on_demand' THEN
    RETURN NULL;
  END IF;
  UPDATE public.gateway_request_events e
  SET cost_status = 'pending'
  WHERE e.infrastructure = 'aws_bedrock'
    AND e.aws_region = NEW.region
    AND e.created_at >= greatest(NEW.effective_from, now() - interval '35 days')
    AND e.cost_status <> 'not_billable'
    AND EXISTS (
      SELECT 1 FROM public.gateway_bedrock_model_key(coalesce(e.request_model, e.model)) k
      WHERE k.provider = NEW.provider AND k.model_key = NEW.model_key AND k.scope = NEW.scope
    );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_events_reprice_bedrock() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bedrock_prices_reprice_events ON public.bedrock_prices;
CREATE TRIGGER bedrock_prices_reprice_events
  AFTER INSERT ON public.bedrock_prices
  FOR EACH ROW
  EXECUTE FUNCTION public.gateway_events_reprice_bedrock();

-- ---------------------------------------------------------------------------
-- Enforcement: Bedrock requests check the Bedrock price for their region
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.gateway_enforcement_check(uuid, uuid, text, text, timestamptz);

CREATE OR REPLACE FUNCTION public.gateway_enforcement_check(
  p_org_id uuid,
  p_asset_id uuid,
  p_model text,
  p_provider text DEFAULT 'anthropic',
  p_at timestamptz DEFAULT now(),
  p_infrastructure text DEFAULT 'anthropic_api',
  p_aws_region text DEFAULT NULL
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
  priced boolean;
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

  IF enforced THEN
    priced := CASE WHEN p_infrastructure = 'aws_bedrock'
      THEN p_aws_region IS NOT NULL AND public.gateway_bedrock_model_priced(p_aws_region, p_model, p_at)
      ELSE public.gateway_model_price_id(p_provider, p_model, p_at) IS NOT NULL
    END;
    IF NOT priced THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'unpriced_model');
    END IF;
  END IF;

  RETURN jsonb_build_object('allowed', true, 'enforced', enforced);
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_enforcement_check(uuid, uuid, text, text, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_enforcement_check(uuid, uuid, text, text, timestamptz, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Anthropic reconciliation compares Anthropic API traffic only
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.gateway_recorded_daily(
  p_org_id uuid,
  p_start date,
  p_end date
)
RETURNS TABLE (
  api_key_id text,
  day date,
  model text,
  asset_id uuid,
  events bigint,
  requests bigint,
  uncached_input bigint,
  cache_write_5m bigint,
  cache_write_1h bigint,
  cache_read bigint,
  output bigint,
  web_search bigint,
  cost_usd text,
  priority_cost_usd text,
  unpriced bigint,
  open_cost bigint,
  incomplete bigint,
  priority bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    coalesce(e.provider_api_key_id, pc.runtime_api_key_id) AS api_key_id,
    (e.created_at AT TIME ZONE 'UTC')::date AS day,
    coalesce(e.model, e.request_model, '') AS model,
    e.asset_id,
    count(*) AS events,
    count(*) FILTER (WHERE e.cost_status <> 'not_billable') AS requests,
    coalesce(sum(e.input_tokens), 0)::bigint,
    coalesce(sum(e.cache_write_5m_tokens), 0)::bigint,
    coalesce(sum(e.cache_write_1h_tokens), 0)::bigint,
    coalesce(sum(e.cache_read_tokens), 0)::bigint,
    coalesce(sum(e.output_tokens), 0)::bigint,
    coalesce(sum(e.web_search_requests), 0)::bigint,
    coalesce(sum(e.cost_usd), 0)::numeric(18, 8)::text,
    coalesce(sum(e.cost_usd) FILTER (WHERE e.service_tier = 'priority'), 0)::numeric(18, 8)::text,
    count(*) FILTER (WHERE e.cost_usd IS NULL AND e.cost_status <> 'not_billable'),
    count(*) FILTER (WHERE e.cost_status IN ('needs_reconciliation', 'partial', 'pending')),
    count(*) FILTER (WHERE e.outcome IN ('client_aborted', 'stream_error', 'blocked_dlp_response')),
    count(*) FILTER (WHERE e.service_tier = 'priority')
  FROM public.gateway_request_events e
  LEFT JOIN LATERAL (
    SELECT c.runtime_api_key_id
    FROM public.provider_connections c
    WHERE e.provider_api_key_id IS NULL
      AND c.asset_id = e.asset_id
      AND c.provider_slug = e.provider
      AND c.status <> 'revoked'
    LIMIT 1
  ) pc ON true
  WHERE e.org_id = p_org_id
    AND e.provider = 'anthropic'
    AND e.infrastructure = 'anthropic_api'
    AND e.created_at >= (p_start::timestamp AT TIME ZONE 'UTC')
    AND e.created_at < (p_end::timestamp AT TIME ZONE 'UTC')
  GROUP BY 1, 2, 3, 4
$$;

REVOKE ALL ON FUNCTION public.gateway_recorded_daily(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gateway_recorded_daily(uuid, date, date) TO authenticated, service_role;
