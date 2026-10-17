-- Evals foundation: one row per completed evaluation run against an asset.
-- Per-test results land in a later table; the registry reads the latest run.

CREATE TABLE IF NOT EXISTS public.asset_eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.ai_systems(id) ON DELETE CASCADE,
  suite text NOT NULL DEFAULT 'default',
  passed integer NOT NULL DEFAULT 0 CHECK (passed >= 0),
  failed integer NOT NULL DEFAULT 0 CHECK (failed >= 0),
  errored integer NOT NULL DEFAULT 0 CHECK (errored >= 0),
  skipped integer NOT NULL DEFAULT 0 CHECK (skipped >= 0),
  categories jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS asset_eval_runs_asset_completed_idx
  ON public.asset_eval_runs (asset_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS asset_eval_runs_org_completed_idx
  ON public.asset_eval_runs (org_id, completed_at DESC);

COMMENT ON TABLE public.asset_eval_runs IS
  'Evaluation runs per asset. Status is derived: any failed = failed, else any errored = errored, else passed. Skipped tests are excluded from totals.';
COMMENT ON COLUMN public.asset_eval_runs.categories IS
  'Per-category counts, e.g. {"quality":{"passed":14,"total":14},"safety":{"passed":11,"total":12}}. Categories: quality, safety, performance, cost, compliance.';
COMMENT ON COLUMN public.asset_eval_runs.completed_at IS
  'Null while a run is in progress; the registry only reads completed runs.';

ALTER TABLE public.asset_eval_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asset_eval_runs_select ON public.asset_eval_runs;
CREATE POLICY asset_eval_runs_select ON public.asset_eval_runs
  FOR SELECT
  TO authenticated
  USING (is_org_member(org_id));

REVOKE ALL ON TABLE public.asset_eval_runs FROM anon, authenticated;
GRANT SELECT ON TABLE public.asset_eval_runs TO authenticated;
GRANT ALL ON TABLE public.asset_eval_runs TO service_role;
