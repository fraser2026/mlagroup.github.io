-- Gateway metering per UTC day for an asset's Connection tab.
-- SECURITY INVOKER: asset_usage_events RLS (is_org_member) still applies.

CREATE OR REPLACE FUNCTION public.asset_usage_daily(p_asset_id uuid, p_days integer DEFAULT 90)
RETURNS TABLE (day date, input_tokens bigint, output_tokens bigint, events bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT
      (now() AT TIME ZONE 'utc')::date AS today,
      LEAST(GREATEST(COALESCE(p_days, 90), 1), 90) AS n
  ),
  days AS (
    SELECT generate_series(b.today - (b.n - 1), b.today, interval '1 day')::date AS day
    FROM bounds b
  ),
  agg AS (
    SELECT
      (e.created_at AT TIME ZONE 'utc')::date AS day,
      SUM(e.input_tokens)::bigint AS input_tokens,
      SUM(e.output_tokens)::bigint AS output_tokens,
      COUNT(*)::bigint AS events
    FROM public.asset_usage_events e, bounds b
    WHERE e.asset_id = p_asset_id
      AND e.created_at >= ((b.today - (b.n - 1))::timestamp AT TIME ZONE 'utc')
    GROUP BY 1
  )
  SELECT
    d.day,
    COALESCE(a.input_tokens, 0),
    COALESCE(a.output_tokens, 0),
    COALESCE(a.events, 0)
  FROM days d
  LEFT JOIN agg a USING (day)
  ORDER BY d.day;
$$;

COMMENT ON FUNCTION public.asset_usage_daily(uuid, integer) IS
  'Zero-filled daily gateway token totals for one asset over the last 1 to 90 UTC days.';

REVOKE ALL ON FUNCTION public.asset_usage_daily(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asset_usage_daily(uuid, integer) TO authenticated, service_role;
