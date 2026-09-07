-- Phase 3b: Organisation-level Provider Admin credentials.
-- Admin key once per (org, provider); runtime keys remain on provider_connections.

CREATE TABLE IF NOT EXISTS public.org_provider_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  provider_slug text NOT NULL REFERENCES public.provider_catalog(slug),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'connected', 'error', 'revoked')),
  admin_credential_secret_id uuid,
  connected_by uuid REFERENCES auth.users(id),
  connected_at timestamptz,
  last_verified_at timestamptz,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS org_provider_credentials_active_org_provider_idx
  ON public.org_provider_credentials (org_id, provider_slug)
  WHERE status <> 'revoked';

CREATE INDEX IF NOT EXISTS org_provider_credentials_org_idx
  ON public.org_provider_credentials (org_id);

COMMENT ON TABLE public.org_provider_credentials IS
  'Organisation-scoped governance Admin credentials per AI provider. Secrets live in Vault only.';
COMMENT ON COLUMN public.org_provider_credentials.admin_credential_secret_id IS
  'vault.secrets.id for governance Admin API key (sk-ant-admin…). Never exposed to clients.';

ALTER TABLE public.org_provider_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_provider_credentials_select ON public.org_provider_credentials;
CREATE POLICY org_provider_credentials_select ON public.org_provider_credentials
  FOR SELECT
  USING (is_org_member(org_id));

-- Writes go through service-role edge functions only.

CREATE OR REPLACE FUNCTION public.org_provider_store_secret(
  p_credential_id uuid,
  p_secret text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_row public.org_provider_credentials;
  v_name text;
  v_secret_id uuid;
BEGIN
  IF coalesce(trim(p_secret), '') = '' THEN
    RAISE EXCEPTION 'Credential is required.';
  END IF;

  SELECT * INTO v_row
  FROM public.org_provider_credentials
  WHERE id = p_credential_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation provider credential not found.';
  END IF;

  v_name := 'org_provider:' || p_credential_id::text || ':admin';

  IF v_row.admin_credential_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_row.admin_credential_secret_id;
  END IF;

  SELECT vault.create_secret(
    trim(p_secret),
    v_name,
    'RegAnchor organisation provider admin credential'
  ) INTO v_secret_id;

  UPDATE public.org_provider_credentials
  SET admin_credential_secret_id = v_secret_id,
      updated_at = now()
  WHERE id = p_credential_id;

  RETURN v_secret_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.org_provider_read_secret(
  p_credential_id uuid
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
  SELECT admin_credential_secret_id INTO v_secret_id
  FROM public.org_provider_credentials
  WHERE id = p_credential_id;

  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE id = v_secret_id;

  RETURN v_secret;
END;
$$;

CREATE OR REPLACE FUNCTION public.org_provider_delete_secret(
  p_credential_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret_id uuid;
BEGIN
  SELECT admin_credential_secret_id INTO v_secret_id
  FROM public.org_provider_credentials
  WHERE id = p_credential_id;

  IF v_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_secret_id;
  END IF;

  UPDATE public.org_provider_credentials
  SET admin_credential_secret_id = NULL,
      updated_at = now()
  WHERE id = p_credential_id;
END;
$$;

REVOKE ALL ON FUNCTION public.org_provider_store_secret(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_provider_read_secret(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.org_provider_delete_secret(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.org_provider_store_secret(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.org_provider_read_secret(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.org_provider_delete_secret(uuid) TO service_role;

-- Promote newest asset-scoped admin secret to org level (additive; leave asset columns).
DO $$
DECLARE
  r record;
  v_id uuid;
  v_secret text;
  v_secret_id uuid;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (pc.org_id, pc.provider_slug)
      pc.org_id,
      pc.provider_slug,
      pc.admin_credential_secret_id,
      pc.admin_connected_at,
      pc.admin_last_verified_at,
      pc.admin_last_error,
      pc.connected_by,
      pc.metadata
    FROM public.provider_connections pc
    WHERE pc.status <> 'revoked'
      AND pc.admin_credential_secret_id IS NOT NULL
    ORDER BY pc.org_id, pc.provider_slug, pc.admin_connected_at DESC NULLS LAST, pc.updated_at DESC
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.org_provider_credentials opc
      WHERE opc.org_id = r.org_id
        AND opc.provider_slug = r.provider_slug
        AND opc.status <> 'revoked'
        AND opc.admin_credential_secret_id IS NOT NULL
    ) THEN
      CONTINUE;
    END IF;

    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE id = r.admin_credential_secret_id;

    IF coalesce(trim(v_secret), '') = '' THEN
      CONTINUE;
    END IF;

    INSERT INTO public.org_provider_credentials (
      org_id,
      provider_slug,
      status,
      connected_by,
      connected_at,
      last_verified_at,
      last_error,
      metadata
    ) VALUES (
      r.org_id,
      r.provider_slug,
      'connected',
      r.connected_by,
      coalesce(r.admin_connected_at, now()),
      r.admin_last_verified_at,
      r.admin_last_error,
      jsonb_build_object(
        'migrated_from', 'provider_connections',
        'admin_verification', coalesce(r.metadata->'admin_verification', 'null'::jsonb)
      )
    )
    RETURNING id INTO v_id;

    SELECT vault.create_secret(
      trim(v_secret),
      'org_provider:' || v_id::text || ':admin',
      'RegAnchor organisation provider admin credential (migrated)'
    ) INTO v_secret_id;

    UPDATE public.org_provider_credentials
    SET admin_credential_secret_id = v_secret_id,
        updated_at = now()
    WHERE id = v_id;
  END LOOP;
END;
$$;
