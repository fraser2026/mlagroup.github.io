-- Rename ai_systems.deployment_status → lifecycle (product language).
-- Values unchanged: planned | development | pilot | production | decommissioned.

ALTER TABLE public.ai_systems
  RENAME COLUMN deployment_status TO lifecycle;

COMMENT ON COLUMN public.ai_systems.lifecycle IS
  'Asset lifecycle stage: planned, development, pilot, production, or decommissioned.';
