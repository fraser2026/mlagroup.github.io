-- Org-authored compliance frameworks (applied remotely 2026-09-07)
CREATE TABLE IF NOT EXISTS public.org_frameworks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  source text NOT NULL DEFAULT 'custom' CHECK (source IN ('custom', 'imported')),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.org_framework_controls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id uuid NOT NULL REFERENCES public.org_frameworks(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 4000),
  category text NOT NULL DEFAULT 'general',
  display_order integer NOT NULL DEFAULT 0,
  mapped_control_id uuid REFERENCES public.governance_controls(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'implemented', 'verified', 'not_applicable')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS org_frameworks_org_idx ON public.org_frameworks (org_id, is_active);
CREATE INDEX IF NOT EXISTS org_framework_controls_fw_idx ON public.org_framework_controls (framework_id, display_order);

ALTER TABLE public.org_frameworks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_framework_controls ENABLE ROW LEVEL SECURITY;
