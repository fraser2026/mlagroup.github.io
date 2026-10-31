-- Monthly gateway budgets for an organisation and for individual agents (assets).
-- Months are calendar months in UTC, the same boundary providers bill on.
-- Writes go through the gateway-budget edge function (owner/admin, audited); members can read.

CREATE TABLE IF NOT EXISTS public.gateway_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES public.ai_systems(id) ON DELETE CASCADE,
  period text NOT NULL DEFAULT 'month' CHECK (period = 'month'),
  amount_usd numeric(14, 2) NOT NULL CHECK (amount_usd > 0 AND amount_usd <= 100000000),
  warn_at_pct smallint NOT NULL DEFAULT 80 CHECK (warn_at_pct BETWEEN 1 AND 100),
  enforcement text NOT NULL DEFAULT 'monitor' CHECK (enforcement = 'monitor'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS gateway_budgets_org_scope_key
  ON public.gateway_budgets (org_id) WHERE asset_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS gateway_budgets_asset_scope_key
  ON public.gateway_budgets (org_id, asset_id) WHERE asset_id IS NOT NULL;

ALTER TABLE public.gateway_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gateway_budgets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gateway_budgets TO authenticated;
GRANT ALL ON public.gateway_budgets TO service_role;

DROP POLICY IF EXISTS gateway_budgets_member_read ON public.gateway_budgets;
CREATE POLICY gateway_budgets_member_read ON public.gateway_budgets
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

-- Spend against each budget for the current UTC month.
-- exact_usd: priced from provider-reported usage at list rates.
-- estimated_usd: priced, but the final figure needs the provider cost report (priority tier,
--   unknown region, cancelled stream, partial code execution).
-- unpriced_requests: billable requests with no price yet; while above zero the spend is incomplete.
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
      (date_trunc('month', p_at AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC' AS period_end
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
    SELECT e.asset_id, e.cost_status, e.cost_usd
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
      coalesce(sum(cost_usd) FILTER (WHERE cost_status = 'priced'), 0) AS exact_usd,
      coalesce(sum(cost_usd) FILTER (WHERE cost_status IN ('needs_reconciliation', 'partial', 'pending')), 0) AS estimated_usd,
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
      coalesce(sp.unpriced_requests, 0) AS unpriced_requests
    FROM public.gateway_budgets g
    LEFT JOIN public.ai_systems s ON s.id = g.asset_id
    LEFT JOIN spend sp
      ON (g.asset_id IS NULL AND sp.is_total) OR (g.asset_id IS NOT NULL AND sp.asset_id = g.asset_id)
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
        END
      ) ORDER BY r.asset_id IS NOT NULL, r.spend_usd DESC), '[]'::jsonb)
      FROM rows r
    )
  )
  FROM elapsed e;
$$;

REVOKE ALL ON FUNCTION public.gateway_budget_status(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gateway_budget_status(uuid, timestamptz) TO authenticated, service_role;
