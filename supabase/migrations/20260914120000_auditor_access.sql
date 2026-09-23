-- Auditor access (Professional+): engagements, scoped visibility, share + API tokens.
-- Tokens store hashes only; plaintext returned once at mint.

CREATE TABLE IF NOT EXISTS public.auditor_engagements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  name text NOT NULL,
  firm_name text,
  contact_email text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'completed', 'revoked')),
  window_start timestamptz NOT NULL DEFAULT now(),
  window_end timestamptz NOT NULL,
  scopes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT auditor_engagements_name_len CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  CONSTRAINT auditor_engagements_window CHECK (window_end > window_start)
);

CREATE INDEX IF NOT EXISTS auditor_engagements_org_idx
  ON public.auditor_engagements (org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.auditor_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL REFERENCES public.auditor_engagements(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('share', 'api')),
  label text NOT NULL DEFAULT '',
  token_hash text NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auditor_tokens_label_len CHECK (char_length(label) <= 80),
  CONSTRAINT auditor_tokens_prefix_len CHECK (char_length(token_prefix) BETWEEN 8 AND 32)
);

CREATE INDEX IF NOT EXISTS auditor_tokens_engagement_idx
  ON public.auditor_tokens (engagement_id, created_at DESC);

CREATE INDEX IF NOT EXISTS auditor_tokens_org_idx
  ON public.auditor_tokens (org_id, kind);

ALTER TABLE public.auditor_engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditor_tokens ENABLE ROW LEVEL SECURITY;

-- Org owners/admins can read engagements (writes go through edge + service role).
DROP POLICY IF EXISTS auditor_engagements_select ON public.auditor_engagements;
CREATE POLICY auditor_engagements_select ON public.auditor_engagements
  FOR SELECT TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS auditor_tokens_select ON public.auditor_tokens;
CREATE POLICY auditor_tokens_select ON public.auditor_tokens
  FOR SELECT TO authenticated
  USING (public.has_org_role(org_id, ARRAY['owner', 'admin']));

COMMENT ON TABLE public.auditor_engagements IS
  'Time-boxed auditor engagements with client-controlled scope flags (Professional+).';
COMMENT ON TABLE public.auditor_tokens IS
  'Share-link and API capability tokens for auditor engagements; hash-only storage.';
