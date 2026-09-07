-- Phase 4: durable provider usage snapshots for organisation analytics.

CREATE TABLE IF NOT EXISTS public.asset_usage_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.ai_systems(id) ON DELETE CASCADE,
  provider_slug text NOT NULL REFERENCES public.provider_catalog(slug),
  window_days integer NOT NULL CHECK (window_days BETWEEN 1 AND 90),
  scope text NOT NULL CHECK (scope IN ('asset', 'organization')),
  total_tokens bigint NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  org_cost_usd numeric(20, 6) NOT NULL DEFAULT 0 CHECK (org_cost_usd >= 0),
  estimated_asset_usd numeric(20, 6) CHECK (estimated_asset_usd >= 0),
  api_key_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  refreshed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS asset_usage_snapshots_asset_window_idx
  ON public.asset_usage_snapshots (asset_id, provider_slug, window_days);

CREATE INDEX IF NOT EXISTS asset_usage_snapshots_org_refreshed_idx
  ON public.asset_usage_snapshots (org_id, refreshed_at DESC);

COMMENT ON TABLE public.asset_usage_snapshots IS
  'Latest provider usage snapshot per asset, provider, and reporting window. Organisation cost is provider-reported; estimated asset cost is a leakage signal only.';
COMMENT ON COLUMN public.asset_usage_snapshots.org_cost_usd IS
  'Provider-reported organisation or workspace cost; never presented as per-asset billing.';
COMMENT ON COLUMN public.asset_usage_snapshots.estimated_asset_usd IS
  'Optional token x rough list-price estimate for asset-scoped leakage detection; not billing.';

ALTER TABLE public.asset_usage_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asset_usage_snapshots_select ON public.asset_usage_snapshots;
CREATE POLICY asset_usage_snapshots_select ON public.asset_usage_snapshots
  FOR SELECT
  TO authenticated
  USING (is_org_member(org_id));

REVOKE ALL ON TABLE public.asset_usage_snapshots FROM anon, authenticated;
GRANT SELECT ON TABLE public.asset_usage_snapshots TO authenticated;
GRANT ALL ON TABLE public.asset_usage_snapshots TO service_role;
