-- Approved models per agent, checked by the gateway on every request.
--
-- An owner or admin approves the models each agent may call. Approval is by model family, so
-- "claude-haiku-4-5" covers its dated snapshots and the same model on Amazon Bedrock
-- ("eu.anthropic.claude-haiku-4-5-20251001-v1:0"). Agents with no approved models are not checked.
-- A request for a model outside the list is flagged (sent and recorded) or blocked (refused before it
-- reaches the provider), per the organisation's setting. Writes go through the gateway-controls edge
-- function (owner/admin, audited); members can read.

-- ---------------------------------------------------------------------------
-- Model family key, mirrored by gatewayModelKey() in the app
-- ---------------------------------------------------------------------------

-- "eu.anthropic.claude-haiku-4-5-20251001-v1:0" -> "claude-haiku-4-5"
-- "claude-haiku-4-5-20251001" -> "claude-haiku-4-5"; "amazon.nova-2-pro" -> "nova-2-pro"
CREATE OR REPLACE FUNCTION public.gateway_model_key(p_model text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                lower(btrim(coalesce(p_model, ''))),
                '^(?:[a-z]{2,4}(?:-gov)?|global)\.(?=[a-z][a-z0-9]*\.)', ''),
              '^[a-z][a-z0-9]*\.(?=[a-z])', ''),
            ':\d+$', ''),
          '-v\d+$', ''),
        '-\d{8}$', ''),
      '-latest$', ''),
    '')
$$;

REVOKE ALL ON FUNCTION public.gateway_model_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gateway_model_key(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Approved models and the organisation's action
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.gateway_approved_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.ai_systems(id) ON DELETE CASCADE,
  model_key text NOT NULL CHECK (model_key ~ '^[a-z0-9][a-z0-9._-]*$' AND length(model_key) <= 120),
  model_id text NOT NULL CHECK (length(model_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (asset_id, model_key)
);

COMMENT ON TABLE public.gateway_approved_models IS
  'Models each agent may call through the gateway, by model family (gateway_model_key). No rows for an agent means its requests are not checked.';
COMMENT ON COLUMN public.gateway_approved_models.model_id IS
  'The model ID as the admin approved it, kept for display. Matching uses model_key.';

CREATE INDEX IF NOT EXISTS gateway_approved_models_org_idx ON public.gateway_approved_models (org_id);

ALTER TABLE public.gateway_approved_models ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gateway_approved_models FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gateway_approved_models TO authenticated;
GRANT ALL ON public.gateway_approved_models TO service_role;

DROP POLICY IF EXISTS gateway_approved_models_member_read ON public.gateway_approved_models;
CREATE POLICY gateway_approved_models_member_read ON public.gateway_approved_models
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

ALTER TABLE public.org_gateway_settings
  ADD COLUMN IF NOT EXISTS unapproved_model_action text NOT NULL DEFAULT 'flag';
ALTER TABLE public.org_gateway_settings DROP CONSTRAINT IF EXISTS org_gateway_settings_unapproved_model_action_check;
ALTER TABLE public.org_gateway_settings ADD CONSTRAINT org_gateway_settings_unapproved_model_action_check
  CHECK (unapproved_model_action IN ('flag', 'block'));
COMMENT ON COLUMN public.org_gateway_settings.unapproved_model_action IS
  'flag: send requests for models an agent is not approved for and record them. block: refuse them before they reach the provider.';

-- ---------------------------------------------------------------------------
-- Request records
-- ---------------------------------------------------------------------------

ALTER TABLE public.gateway_request_events
  ADD COLUMN IF NOT EXISTS model_approved boolean;
COMMENT ON COLUMN public.gateway_request_events.model_approved IS
  'Whether the requested model was on the agent''s approved list. Null when the agent had no approved models or the check could not run.';

CREATE INDEX IF NOT EXISTS gateway_request_events_unapproved_idx
  ON public.gateway_request_events (org_id, created_at)
  WHERE model_approved = false;

ALTER TABLE public.gateway_request_events DROP CONSTRAINT IF EXISTS gateway_request_events_outcome_check;
ALTER TABLE public.gateway_request_events ADD CONSTRAINT gateway_request_events_outcome_check CHECK (outcome IN (
  'success',
  'blocked_dlp_request',
  'blocked_dlp_response',
  'blocked_budget',
  'blocked_unpriced_model',
  'blocked_unapproved_model',
  'rate_limited',
  'provider_error',
  'gateway_error',
  'client_aborted',
  'stream_error'
));

-- ---------------------------------------------------------------------------
-- Enforcement: approved models first, then budgets
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
  b record;
  spend numeric;
  enforced boolean := false;
  priced boolean;
  v_approved text[];
  v_model_approved boolean;
  v_action text;
BEGIN
  SELECT array_agg(a.model_key) INTO v_approved
  FROM public.gateway_approved_models a
  WHERE a.org_id = p_org_id AND a.asset_id = p_asset_id;

  IF v_approved IS NOT NULL THEN
    v_model_approved := coalesce(public.gateway_model_key(p_model) = ANY (v_approved), false);
    IF NOT v_model_approved THEN
      SELECT s.unapproved_model_action INTO v_action
      FROM public.org_gateway_settings s
      WHERE s.org_id = p_org_id;
      IF v_action = 'block' THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'unapproved_model', 'model_approved', false);
      END IF;
    END IF;
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
        'model_approved', v_model_approved
      );
    END IF;
  END LOOP;

  IF enforced THEN
    priced := CASE WHEN p_infrastructure = 'aws_bedrock'
      THEN p_aws_region IS NOT NULL AND public.gateway_bedrock_model_priced(p_aws_region, p_model, p_at)
      ELSE public.gateway_model_price_id(p_provider, p_model, p_at) IS NOT NULL
    END;
    IF NOT priced THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'unpriced_model', 'model_approved', v_model_approved);
    END IF;
  END IF;

  RETURN jsonb_build_object('allowed', true, 'enforced', enforced, 'model_approved', v_model_approved);
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_enforcement_check(uuid, uuid, text, text, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_enforcement_check(uuid, uuid, text, text, timestamptz, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Summary: requests for models outside the approved list, and refusals by policy
-- ---------------------------------------------------------------------------

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
        'policy_blocked', count(*) FILTER (WHERE outcome IN ('blocked_budget', 'blocked_unpriced_model', 'blocked_unapproved_model')),
        'unapproved', count(*) FILTER (WHERE model_approved = false),
        'unapproved_blocked', count(*) FILTER (WHERE outcome = 'blocked_unapproved_model'),
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
