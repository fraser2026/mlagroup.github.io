-- Guardrails: one switchboard for every runtime control on the gateway.
--
-- Each organisation switches guardrails off, flag or block in one place. Some are enforced by the
-- RegAnchor gateway itself (pause an agent, registered model only, blocked models, custom rules);
-- the rest by the organisation's own Cloudflare AI Gateway (data loss prevention, prompt injection,
-- harmful content, rate limit), which the gateway-guardrails edge function configures through the
-- Cloudflare API. Writes go through that function (owner/admin, audited); members can read.
--
-- Guardrail tests are real requests through the gateway marked is_check. They are shown in
-- activity but excluded from budgets, spend and summary totals. Reconciliation still counts them,
-- because the provider bills them.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.org_guardrails (
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  mode text NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'flag', 'block')),
  applies_to text NOT NULL DEFAULT 'prompt' CHECK (applies_to IN ('prompt', 'response', 'both')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (org_id, key)
);

COMMENT ON TABLE public.org_guardrails IS
  'Guardrail settings per organisation. No row means off. Keys are defined in the app (lib/guardrails.ts) and the gateway-guardrails edge function.';

CREATE TABLE IF NOT EXISTS public.gateway_agent_pauses (
  asset_id uuid PRIMARY KEY REFERENCES public.ai_systems(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  paused_at timestamptz NOT NULL DEFAULT now(),
  paused_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.gateway_agent_pauses IS
  'Agents whose gateway requests are all refused until resumed. Deleting the row resumes the agent.';

CREATE INDEX IF NOT EXISTS gateway_agent_pauses_org_idx ON public.gateway_agent_pauses (org_id);

CREATE TABLE IF NOT EXISTS public.gateway_blocked_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  model_key text NOT NULL CHECK (model_key ~ '^[a-z0-9][a-z0-9._-]*$' AND length(model_key) <= 120),
  model_id text NOT NULL CHECK (length(model_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (org_id, model_key)
);

COMMENT ON TABLE public.gateway_blocked_models IS
  'Models no agent in the organisation may use, by model family (gateway_model_key).';

CREATE TABLE IF NOT EXISTS public.gateway_custom_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 2 AND 80),
  match_type text NOT NULL DEFAULT 'phrase' CHECK (match_type IN ('phrase', 'pattern')),
  pattern text NOT NULL CHECK (length(pattern) BETWEEN 2 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.gateway_custom_rules IS
  'The organisation''s own rules, matched by the gateway on the prompt. phrase: case-insensitive text; pattern: a regular expression.';

CREATE INDEX IF NOT EXISTS gateway_custom_rules_org_idx ON public.gateway_custom_rules (org_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_guardrails', 'gateway_agent_pauses', 'gateway_blocked_models', 'gateway_custom_rules'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_member_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_org_member(org_id))', t || '_member_read', t);
  END LOOP;
END $$;

ALTER TABLE public.org_gateway_settings
  ADD COLUMN IF NOT EXISTS cf_gateway_id text CHECK (cf_gateway_id ~ '^[a-z0-9][a-z0-9-]{1,63}$');
COMMENT ON COLUMN public.org_gateway_settings.cf_gateway_id IS
  'The organisation''s own Cloudflare AI Gateway, created when a Cloudflare-enforced guardrail is first switched on. Null: the shared gateway.';

-- The approved-models setting from 20261102190000 becomes the registered model guardrail.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'org_gateway_settings' AND column_name = 'unapproved_model_action') THEN
    INSERT INTO public.org_guardrails (org_id, key, mode)
    SELECT DISTINCT a.org_id, 'registered_model', coalesce(s.unapproved_model_action, 'flag')
    FROM public.gateway_approved_models a
    LEFT JOIN public.org_gateway_settings s ON s.org_id = a.org_id
    ON CONFLICT DO NOTHING;
    ALTER TABLE public.org_gateway_settings DROP COLUMN unapproved_model_action;
  END IF;
END $$;

COMMENT ON TABLE public.gateway_approved_models IS
  'Extra models an agent may use besides its registered model, by model family (gateway_model_key). Checked when the registered model guardrail is on.';

-- ---------------------------------------------------------------------------
-- Request records
-- ---------------------------------------------------------------------------

ALTER TABLE public.gateway_request_events
  ADD COLUMN IF NOT EXISTS guardrail_hits jsonb,
  ADD COLUMN IF NOT EXISTS is_check boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.gateway_request_events.guardrail_hits IS
  'Guardrails that fired on this request: [{key, action FLAG|BLOCK, check REQUEST|RESPONSE, source reganchor|cloudflare}].';
COMMENT ON COLUMN public.gateway_request_events.is_check IS
  'A guardrail test sent from the Guardrails tab. Excluded from budgets, spend and summary totals.';
COMMENT ON COLUMN public.gateway_request_events.model_approved IS
  'Whether the requested model was within the agent''s registered and extra models. Null when the registered model guardrail was off, the agent had no registered model, or the check could not run.';

CREATE INDEX IF NOT EXISTS gateway_request_events_guardrail_idx
  ON public.gateway_request_events (org_id, created_at)
  WHERE guardrail_hits IS NOT NULL;

ALTER TABLE public.gateway_request_events DROP CONSTRAINT IF EXISTS gateway_request_events_outcome_check;
ALTER TABLE public.gateway_request_events ADD CONSTRAINT gateway_request_events_outcome_check CHECK (outcome IN (
  'success',
  'blocked_dlp_request',
  'blocked_dlp_response',
  'blocked_budget',
  'blocked_unpriced_model',
  'blocked_unapproved_model',
  'blocked_model_policy',
  'blocked_agent_paused',
  'blocked_custom_rule',
  'blocked_guardrail_prompt',
  'blocked_guardrail_response',
  'rate_limited',
  'provider_error',
  'gateway_error',
  'client_aborted',
  'stream_error'
));

-- Tests never count towards spend or the model and tool inventory.
DROP TRIGGER IF EXISTS gateway_request_events_spend ON public.gateway_request_events;
DROP TRIGGER IF EXISTS gateway_request_events_spend_write ON public.gateway_request_events;
DROP TRIGGER IF EXISTS gateway_request_events_spend_delete ON public.gateway_request_events;
CREATE TRIGGER gateway_request_events_spend_write
  AFTER INSERT OR UPDATE ON public.gateway_request_events
  FOR EACH ROW WHEN (NOT NEW.is_check)
  EXECUTE FUNCTION public.gateway_spend_counters_apply();
CREATE TRIGGER gateway_request_events_spend_delete
  AFTER DELETE ON public.gateway_request_events
  FOR EACH ROW WHEN (NOT OLD.is_check)
  EXECUTE FUNCTION public.gateway_spend_counters_apply();

DROP TRIGGER IF EXISTS gateway_request_events_inventory ON public.gateway_request_events;
CREATE TRIGGER gateway_request_events_inventory
  AFTER INSERT ON public.gateway_request_events
  FOR EACH ROW WHEN (NOT NEW.is_check)
  EXECUTE FUNCTION public.gateway_inventory_apply();

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
    AND NOT e.is_check
  GROUP BY e.org_id, e.asset_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_spend_counters_rebuild(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_spend_counters_rebuild(date) TO service_role;

-- ---------------------------------------------------------------------------
-- Enforcement: pause, blocked models, registered model, then budgets.
-- Custom rules are returned for the gateway to match, since prompts never reach the database.
-- ---------------------------------------------------------------------------

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
  v_key text := public.gateway_model_key(p_model);
  b record;
  spend numeric;
  enforced boolean := false;
  priced boolean;
  v_modes jsonb;
  v_mode text;
  v_allowed text[];
  v_model_approved boolean;
  v_hits jsonb := '[]'::jsonb;
  v_custom jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.gateway_agent_pauses p WHERE p.asset_id = p_asset_id AND p.org_id = p_org_id) THEN
    RETURN jsonb_build_object(
      'allowed', false, 'reason', 'agent_paused', 'model_approved', NULL,
      'hits', jsonb_build_array(jsonb_build_object('key', 'agent_pause', 'action', 'BLOCK', 'check', 'REQUEST', 'source', 'reganchor')));
  END IF;

  SELECT coalesce(jsonb_object_agg(g.key, g.mode), '{}'::jsonb) INTO v_modes
  FROM public.org_guardrails g
  WHERE g.org_id = p_org_id AND g.mode <> 'off';

  v_mode := v_modes ->> 'blocked_models';
  IF v_mode IS NOT NULL AND v_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.gateway_blocked_models m WHERE m.org_id = p_org_id AND m.model_key = v_key
  ) THEN
    IF v_mode = 'block' THEN
      RETURN jsonb_build_object(
        'allowed', false, 'reason', 'blocked_model', 'model_approved', NULL,
        'hits', jsonb_build_array(jsonb_build_object('key', 'blocked_models', 'action', 'BLOCK', 'check', 'REQUEST', 'source', 'reganchor')));
    END IF;
    v_hits := v_hits || jsonb_build_object('key', 'blocked_models', 'action', 'FLAG', 'check', 'REQUEST', 'source', 'reganchor');
  END IF;

  v_mode := v_modes ->> 'registered_model';
  IF v_mode IS NOT NULL THEN
    SELECT array_remove(array_agg(DISTINCT k), NULL) INTO v_allowed
    FROM (
      SELECT public.gateway_model_key(s.model_name) AS k
      FROM public.ai_systems s WHERE s.id = p_asset_id AND s.org_id = p_org_id
      UNION ALL
      SELECT a.model_key FROM public.gateway_approved_models a
      WHERE a.org_id = p_org_id AND a.asset_id = p_asset_id
    ) keys;
    IF cardinality(v_allowed) > 0 THEN
      v_model_approved := coalesce(v_key = ANY (v_allowed), false);
      IF NOT v_model_approved THEN
        IF v_mode = 'block' THEN
          RETURN jsonb_build_object(
            'allowed', false, 'reason', 'unregistered_model', 'model_approved', false,
            'hits', v_hits || jsonb_build_object('key', 'registered_model', 'action', 'BLOCK', 'check', 'REQUEST', 'source', 'reganchor'));
        END IF;
        v_hits := v_hits || jsonb_build_object('key', 'registered_model', 'action', 'FLAG', 'check', 'REQUEST', 'source', 'reganchor');
      END IF;
    END IF;
  END IF;

  v_mode := v_modes ->> 'custom_rules';
  IF v_mode IS NOT NULL THEN
    SELECT jsonb_build_object('mode', v_mode, 'rules', jsonb_agg(jsonb_build_object(
      'id', r.id, 'label', r.label, 'match_type', r.match_type, 'pattern', r.pattern) ORDER BY r.created_at))
    INTO v_custom
    FROM public.gateway_custom_rules r
    WHERE r.org_id = p_org_id
    HAVING count(*) > 0;
  END IF;

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
        'budget_id', b.id,
        'model_approved', v_model_approved,
        'hits', v_hits
      );
    END IF;
  END LOOP;

  IF enforced THEN
    priced := CASE WHEN p_infrastructure = 'aws_bedrock'
      THEN p_aws_region IS NOT NULL AND public.gateway_bedrock_model_priced(p_aws_region, p_model, p_at)
      ELSE public.gateway_model_price_id(p_provider, p_model, p_at) IS NOT NULL
    END;
    IF NOT priced THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'unpriced_model', 'model_approved', v_model_approved, 'hits', v_hits);
    END IF;
  END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'allowed', true,
    'enforced', enforced,
    'model_approved', v_model_approved,
    'hits', v_hits,
    'custom_rules', v_custom
  )) || jsonb_build_object('model_approved', v_model_approved);
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_enforcement_check(uuid, uuid, text, text, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_enforcement_check(uuid, uuid, text, text, timestamptz, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Guardrail activity per key, excluding tests
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.gateway_guardrail_counts(
  p_org_id uuid,
  p_since timestamptz DEFAULT now() - interval '30 days'
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_object_agg(k.key, jsonb_build_object('flagged', k.flagged, 'blocked', k.blocked, 'last_at', k.last_at)), '{}'::jsonb)
  FROM (
    SELECT
      h ->> 'key' AS key,
      count(*) FILTER (WHERE h ->> 'action' = 'FLAG') AS flagged,
      count(*) FILTER (WHERE h ->> 'action' = 'BLOCK') AS blocked,
      max(e.created_at) AS last_at
    FROM public.gateway_request_events e
    CROSS JOIN LATERAL jsonb_array_elements(e.guardrail_hits) h
    WHERE e.org_id = p_org_id
      AND e.created_at >= p_since
      AND e.guardrail_hits IS NOT NULL
      AND jsonb_typeof(e.guardrail_hits) = 'array'
      AND NOT e.is_check
    GROUP BY 1
  ) k
  WHERE k.key IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.gateway_guardrail_counts(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gateway_guardrail_counts(uuid, timestamptz) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Budgets and the summary leave tests out
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
      AND NOT e.is_check
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
    SELECT e.*, coalesce(e.contract_cost_usd, e.cost_usd) AS spend_usd,
      (e.guardrail_hits IS NOT NULL AND jsonb_typeof(e.guardrail_hits) = 'array' AND jsonb_array_length(e.guardrail_hits) > 0) AS has_hits
    FROM public.gateway_request_events e
    WHERE e.org_id = p_org_id
      AND e.created_at >= p_since
      AND (p_asset_id IS NULL OR e.asset_id = p_asset_id)
      AND NOT e.is_check
  )
  SELECT jsonb_build_object(
    'since', p_since,
    'totals', (
      SELECT jsonb_build_object(
        'requests', count(*),
        'success', count(*) FILTER (WHERE outcome = 'success'),
        'flagged', count(*) FILTER (WHERE dlp_action = 'FLAG'),
        'blocked', count(*) FILTER (WHERE outcome IN ('blocked_dlp_request', 'blocked_dlp_response')),
        'policy_blocked', count(*) FILTER (WHERE outcome IN ('blocked_budget', 'blocked_unpriced_model', 'blocked_unapproved_model',
          'blocked_model_policy', 'blocked_agent_paused', 'blocked_custom_rule', 'blocked_guardrail_prompt', 'blocked_guardrail_response')),
        'unapproved', count(*) FILTER (WHERE model_approved = false),
        'unapproved_blocked', count(*) FILTER (WHERE outcome IN ('blocked_unapproved_model', 'blocked_model_policy')),
        'guardrail_hits', count(*) FILTER (WHERE has_hits),
        'guardrail_blocked', count(*) FILTER (WHERE outcome IN ('blocked_model_policy', 'blocked_agent_paused', 'blocked_custom_rule',
          'blocked_guardrail_prompt', 'blocked_guardrail_response', 'blocked_dlp_request', 'blocked_dlp_response')),
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
          count(*) FILTER (WHERE model_approved = false) AS unapproved,
          count(*) FILTER (WHERE has_hits) AS guardrails,
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
          count(*) FILTER (WHERE ev.model_approved = false) AS unapproved,
          count(*) FILTER (WHERE ev.has_hits) AS guardrails,
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
