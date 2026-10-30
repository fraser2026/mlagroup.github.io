-- Gateway monitoring read models: token last use and a scoped usage summary.
-- The summary runs as the caller, so gateway_request_events RLS (org members only) applies.

ALTER TABLE public.asset_gateway_tokens
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

UPDATE public.asset_gateway_tokens t
SET last_used_at = s.last_used_at
FROM (
  SELECT token_id, max(created_at) AS last_used_at
  FROM public.gateway_request_events
  WHERE token_id IS NOT NULL
  GROUP BY token_id
) s
WHERE s.token_id = t.id
  AND (t.last_used_at IS NULL OR t.last_used_at < s.last_used_at);

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
    SELECT *
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
        'rate_limited', count(*) FILTER (WHERE outcome = 'rate_limited'),
        'errors', count(*) FILTER (WHERE outcome IN ('provider_error', 'gateway_error', 'stream_error')),
        'aborted', count(*) FILTER (WHERE outcome = 'client_aborted'),
        'fallback', count(*) FILTER (WHERE route = 'direct_fallback'),
        'cost_usd', coalesce(sum(cost_usd), 0),
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
          coalesce(sum(cost_usd), 0) AS cost_usd,
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
          coalesce(sum(cost_usd), 0) AS cost_usd,
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
          coalesce(sum(ev.cost_usd), 0) AS cost_usd,
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
