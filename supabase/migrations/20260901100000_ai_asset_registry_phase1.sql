-- Phase 1: AI Asset Registry taxonomy (additive only)
-- ai_systems remains the physical table; asset_kind discriminates system vs agent.

ALTER TABLE public.ai_systems
  ADD COLUMN IF NOT EXISTS asset_kind text NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS provider_slug text NULL;

ALTER TABLE public.ai_systems
  DROP CONSTRAINT IF EXISTS ai_systems_asset_kind_check;

ALTER TABLE public.ai_systems
  ADD CONSTRAINT ai_systems_asset_kind_check
  CHECK (asset_kind IN ('system', 'agent'));

COMMENT ON COLUMN public.ai_systems.asset_kind IS 'Governed asset classification: system or agent (Phase 1).';
COMMENT ON COLUMN public.ai_systems.provider_slug IS 'Optional provider catalog slug for classification metadata only.';

CREATE TABLE IF NOT EXISTS public.provider_catalog (
  slug text PRIMARY KEY,
  name text NOT NULL,
  logo_path text NULL,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.provider_catalog IS 'Reference catalog of AI providers RegAnchor may recognise or connect to. Metadata only in Phase 1.';

INSERT INTO public.provider_catalog (slug, name, logo_path, is_active, display_order)
VALUES
  ('anthropic', 'Anthropic', 'assets/providers/anthropic-color.svg', true, 1),
  ('openai', 'OpenAI', 'assets/providers/openai-color.svg', true, 2),
  ('bedrock', 'AWS Bedrock', 'assets/providers/bedrock-color.svg', true, 3)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  logo_path = EXCLUDED.logo_path,
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order;

ALTER TABLE public.provider_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_catalog_select ON public.provider_catalog;

CREATE POLICY provider_catalog_select ON public.provider_catalog
  FOR SELECT
  TO authenticated
  USING (is_active = true);
