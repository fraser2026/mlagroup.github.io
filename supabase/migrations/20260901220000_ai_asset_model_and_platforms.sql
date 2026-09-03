-- Platform taxonomy + model name for AI asset onboarding (Phase 1 refinement)

ALTER TABLE public.ai_systems
  ADD COLUMN IF NOT EXISTS model_name text NULL;

COMMENT ON COLUMN public.ai_systems.model_name IS 'Frontier model identifier or display name (e.g. Claude Opus 4.6, GPT-5).';

INSERT INTO public.provider_catalog (slug, name, logo_path, is_active, display_order)
VALUES
  ('google', 'Google', 'assets/providers/gemini-color.svg', true, 4),
  ('azure', 'Microsoft Azure', 'assets/providers/azureai-color.svg', true, 5),
  ('in_house', 'In-house', NULL, true, 90),
  ('other', 'Other', NULL, true, 99)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  logo_path = EXCLUDED.logo_path,
  is_active = EXCLUDED.is_active,
  display_order = EXCLUDED.display_order;
