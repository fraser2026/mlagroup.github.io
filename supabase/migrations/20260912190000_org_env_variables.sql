-- Organisation environment: preset API keys + secret/plain variables.
-- Secrets/presets live in Supabase Vault (UUID refs only). Plain values are member-visible.

CREATE TABLE IF NOT EXISTS public.org_env_variables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('preset', 'secret', 'plain')),
  name text NOT NULL,
  preset_key text,
  value_plain text,
  secret_id uuid,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_env_name_format CHECK (name ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT org_env_secret_no_plain CHECK (
    (kind = 'plain' AND secret_id IS NULL)
    OR (kind IN ('preset', 'secret') AND value_plain IS NULL)
  ),
  CONSTRAINT org_env_preset_key_shape CHECK (
    (kind = 'preset' AND preset_key IS NOT NULL AND preset_key = name)
    OR (kind <> 'preset' AND preset_key IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS org_env_variables_org_name_uidx
  ON public.org_env_variables (org_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS org_env_variables_org_preset_uidx
  ON public.org_env_variables (org_id, preset_key)
  WHERE preset_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS org_env_variables_org_kind_idx
  ON public.org_env_variables (org_id, kind);

COMMENT ON TABLE public.org_env_variables IS
  'Org-scoped env slots: preset API keys and custom secret/plain variables. Secrets in Vault only.';
COMMENT ON COLUMN public.org_env_variables.secret_id IS
  'vault.secrets.id for preset/secret kinds. Never return decrypted values to clients.';
COMMENT ON COLUMN public.org_env_variables.value_plain IS
  'Plaintext only for kind=plain. Visible to organisation members via RLS.';

ALTER TABLE public.org_env_variables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_env_variables_select ON public.org_env_variables;
CREATE POLICY org_env_variables_select ON public.org_env_variables
  FOR SELECT
  USING (is_org_member(org_id));

-- Writes go through service-role edge functions only.

CREATE OR REPLACE FUNCTION public.org_env_store_secret(
  p_variable_id uuid,
  p_secret text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_row public.org_env_variables;
  v_name text;
  v_secret_id uuid;
BEGIN
  IF coalesce(trim(p_secret), '') = '' THEN
    RAISE EXCEPTION 'Secret value is required.';
  END IF;

  SELECT * INTO v_row
  FROM public.org_env_variables
  WHERE id = p_variable_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Environment variable not found.';
  END IF;

  IF v_row.kind NOT IN ('preset', 'secret') THEN
    RAISE EXCEPTION 'Only preset and secret variables use Vault.';
  END IF;

  v_name := 'org_env:' || p_variable_id::text;

  IF v_row.secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_row.secret_id;
  END IF;

  SELECT vault.create_secret(
    trim(p_secret),
    v_name,
    'RegAnchor organisation environment secret'
  ) INTO v_secret_id;

  UPDATE public.org_env_variables
  SET secret_id = v_secret_id,
      value_plain = NULL,
      updated_at = now()
  WHERE id = p_variable_id;

  RETURN v_secret_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.org_env_read_secret(
  p_variable_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret_id uuid;
  v_secret text;
BEGIN
  SELECT secret_id INTO v_secret_id
  FROM public.org_env_variables
  WHERE id = p_variable_id
    AND kind IN ('preset', 'secret');

  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE id = v_secret_id;

  RETURN v_secret;
END;
$$;

CREATE OR REPLACE FUNCTION public.org_env_delete_secret(
  p_variable_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret_id uuid;
BEGIN
  SELECT secret_id INTO v_secret_id
  FROM public.org_env_variables
  WHERE id = p_variable_id;

  IF v_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_secret_id;
  END IF;

  UPDATE public.org_env_variables
  SET secret_id = NULL,
      updated_at = now()
  WHERE id = p_variable_id;
END;
$$;

REVOKE ALL ON FUNCTION public.org_env_store_secret(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_env_store_secret(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.org_env_store_secret(uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.org_env_read_secret(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_env_read_secret(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.org_env_read_secret(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.org_env_delete_secret(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_env_delete_secret(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.org_env_delete_secret(uuid) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.org_env_store_secret(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.org_env_read_secret(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.org_env_delete_secret(uuid) TO service_role;
