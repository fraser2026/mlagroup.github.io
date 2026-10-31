-- Reconciliation of gateway records against the provider's own usage and cost data.
-- One result row per organisation, provider API key and UTC day: provider token counts and
-- cost (list and billed) beside what the gateway recorded for the same key and day.
-- Writes go through the gateway-reconcile edge function (service role); members can read.

-- The provider API key that served each request, so reconciliation stays exact after a key
-- is rotated. Older events fall back to the asset's current runtime key.
ALTER TABLE public.gateway_request_events
  ADD COLUMN IF NOT EXISTS provider_api_key_id text;

COMMENT ON COLUMN public.gateway_request_events.provider_api_key_id IS
  'Provider API key id (for Anthropic, apikey_...) that authenticated the upstream request. Never the key itself.';

CREATE INDEX IF NOT EXISTS gateway_request_events_org_key_created_idx
  ON public.gateway_request_events (org_id, provider_api_key_id, created_at);

CREATE TABLE IF NOT EXISTS public.gateway_reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'anthropic',
  range_start date NOT NULL,
  range_end date NOT NULL,
  trigger text NOT NULL CHECK (trigger IN ('scheduled', 'manual')),
  triggered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
  data_refreshed_at timestamptz,
  summary jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CHECK (range_end > range_start)
);

CREATE INDEX IF NOT EXISTS gateway_reconciliation_runs_org_started_idx
  ON public.gateway_reconciliation_runs (org_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.gateway_reconciliation_days (
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'anthropic',
  api_key_id text NOT NULL,
  day date NOT NULL,
  asset_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN (
    'matched',
    'provider_higher',
    'recorded_higher',
    'cost_difference',
    'provider_pending'
  )),
  final boolean NOT NULL DEFAULT false,
  provider_usage jsonb NOT NULL,
  recorded_usage jsonb NOT NULL,
  provider_list_usd numeric(18, 8) NOT NULL DEFAULT 0,
  provider_billed_usd numeric(18, 8) NOT NULL DEFAULT 0,
  provider_other_list_usd numeric(18, 8) NOT NULL DEFAULT 0,
  provider_other_billed_usd numeric(18, 8) NOT NULL DEFAULT 0,
  recorded_usd numeric(18, 8) NOT NULL DEFAULT 0,
  recorded_priority_usd numeric(18, 8) NOT NULL DEFAULT 0,
  variance_usd numeric(18, 8) NOT NULL DEFAULT 0,
  tolerance_usd numeric(18, 8) NOT NULL DEFAULT 0,
  models jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  data_refreshed_at timestamptz,
  checked_at timestamptz NOT NULL DEFAULT now(),
  run_id uuid REFERENCES public.gateway_reconciliation_runs(id) ON DELETE SET NULL,
  PRIMARY KEY (org_id, provider, api_key_id, day)
);

COMMENT ON TABLE public.gateway_reconciliation_days IS
  'Provider-reported usage and cost per API key and UTC day beside gateway records. '
  'provider_list_usd and provider_billed_usd cover request charges (tokens and web search); '
  'provider_other_* covers charges billed outside requests (code execution hours, sessions). '
  'variance_usd = recorded_usd - recorded_priority_usd - provider_list_usd.';
COMMENT ON COLUMN public.gateway_reconciliation_days.final IS
  'True once the provider no longer revises the figures (about 7 days after the month ends).';

CREATE INDEX IF NOT EXISTS gateway_reconciliation_days_org_day_idx
  ON public.gateway_reconciliation_days (org_id, day DESC);

ALTER TABLE public.gateway_reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gateway_reconciliation_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gateway_reconciliation_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.gateway_reconciliation_days FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gateway_reconciliation_runs TO authenticated;
GRANT SELECT ON public.gateway_reconciliation_days TO authenticated;
GRANT ALL ON public.gateway_reconciliation_runs TO service_role;
GRANT ALL ON public.gateway_reconciliation_days TO service_role;

DROP POLICY IF EXISTS gateway_reconciliation_runs_member_read ON public.gateway_reconciliation_runs;
CREATE POLICY gateway_reconciliation_runs_member_read ON public.gateway_reconciliation_runs
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS gateway_reconciliation_days_member_read ON public.gateway_reconciliation_days;
CREATE POLICY gateway_reconciliation_days_member_read ON public.gateway_reconciliation_days
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

-- What the gateway recorded per provider key, UTC day, model and asset. Sums are returned as
-- text so the edge function can add them without floating point loss.
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
    AND e.created_at >= (p_start::timestamp AT TIME ZONE 'UTC')
    AND e.created_at < (p_end::timestamp AT TIME ZONE 'UTC')
  GROUP BY 1, 2, 3, 4
$$;

REVOKE ALL ON FUNCTION public.gateway_recorded_daily(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gateway_recorded_daily(uuid, date, date) TO authenticated, service_role;

-- Scheduled runs present a secret that only Vault holds; the edge function asks here.
CREATE OR REPLACE FUNCTION public.gateway_reconcile_cron_ok(p_secret text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_secret IS NULL OR length(p_secret) < 32 THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name = 'gateway_reconcile_cron' AND s.decrypted_secret = p_secret
  );
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_reconcile_cron_ok(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_reconcile_cron_ok(text) TO service_role;

-- Backfill the key on events recorded before the gateway stamped it.
UPDATE public.gateway_request_events e
SET provider_api_key_id = pc.runtime_api_key_id
FROM public.provider_connections pc
WHERE e.provider_api_key_id IS NULL
  AND pc.asset_id = e.asset_id
  AND pc.provider_slug = e.provider
  AND pc.status <> 'revoked'
  AND pc.runtime_api_key_id IS NOT NULL;
