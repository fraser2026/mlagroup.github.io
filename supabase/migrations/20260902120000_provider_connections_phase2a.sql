-- Phase 2a: Provider connection foundation (credentials in Vault, no live connector yet).

ALTER TABLE public.provider_catalog
  ADD COLUMN IF NOT EXISTS auth_method text NOT NULL DEFAULT 'api_key',
  ADD COLUMN IF NOT EXISTS connector_available boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS docs_url text;

ALTER TABLE public.provider_catalog
  DROP CONSTRAINT IF EXISTS provider_catalog_auth_method_check;

ALTER TABLE public.provider_catalog
  ADD CONSTRAINT provider_catalog_auth_method_check
  CHECK (auth_method IN ('api_key', 'iam', 'oauth'));

COMMENT ON COLUMN public.provider_catalog.auth_method IS 'How RegAnchor authenticates to this platform when a connector is enabled.';
COMMENT ON COLUMN public.provider_catalog.connector_available IS 'When true, assets on this platform may establish a provider connection.';
COMMENT ON COLUMN public.provider_catalog.docs_url IS 'Optional link to provider connection documentation.';

UPDATE public.provider_catalog
SET
  auth_method = 'api_key',
  connector_available = (slug = 'anthropic'),
  docs_url = CASE slug
    WHEN 'anthropic' THEN 'https://docs.anthropic.com/en/api/getting-started'
    ELSE docs_url
  END
WHERE slug IN ('anthropic', 'openai', 'bedrock', 'google', 'azure', 'in_house', 'other');

CREATE TABLE IF NOT EXISTS public.provider_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.ai_systems(id) ON DELETE CASCADE,
  provider_slug text NOT NULL REFERENCES public.provider_catalog(slug),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'connected', 'error', 'revoked')),
  auth_method text NOT NULL DEFAULT 'api_key'
    CHECK (auth_method IN ('api_key', 'iam', 'oauth')),
  credential_secret_id uuid,
  connected_by uuid REFERENCES auth.users(id),
  connected_at timestamptz,
  last_verified_at timestamptz,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_connections_active_asset_provider_idx
  ON public.provider_connections (asset_id, provider_slug)
  WHERE status <> 'revoked';

CREATE INDEX IF NOT EXISTS provider_connections_org_idx
  ON public.provider_connections (org_id, asset_id);

COMMENT ON TABLE public.provider_connections IS 'Authenticated link between a registry asset and an AI platform API. Credentials live in Vault only.';
COMMENT ON COLUMN public.provider_connections.credential_secret_id IS 'vault.secrets.id — never exposed to clients.';

ALTER TABLE public.provider_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_connections_select ON public.provider_connections;
CREATE POLICY provider_connections_select ON public.provider_connections
  FOR SELECT
  USING (is_org_member(org_id));

-- Writes go through service-role edge functions only (no INSERT/UPDATE/DELETE for authenticated).

CREATE OR REPLACE FUNCTION public.provider_connection_store_secret(
  p_connection_id uuid,
  p_secret text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_conn public.provider_connections;
  v_name text;
  v_secret_id uuid;
BEGIN
  IF coalesce(trim(p_secret), '') = '' THEN
    RAISE EXCEPTION 'Credential is required.';
  END IF;

  SELECT * INTO v_conn
  FROM public.provider_connections
  WHERE id = p_connection_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Connection not found.';
  END IF;

  v_name := 'provider_connection:' || p_connection_id::text;

  IF v_conn.credential_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_conn.credential_secret_id;
  END IF;

  SELECT vault.create_secret(
    trim(p_secret),
    v_name,
    'RegAnchor provider connection credential'
  ) INTO v_secret_id;

  UPDATE public.provider_connections
  SET credential_secret_id = v_secret_id,
      updated_at = now()
  WHERE id = p_connection_id;

  RETURN v_secret_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.provider_connection_read_secret(
  p_connection_id uuid
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
  SELECT credential_secret_id INTO v_secret_id
  FROM public.provider_connections
  WHERE id = p_connection_id;

  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE id = v_secret_id;

  RETURN v_secret;
END;
$$;

CREATE OR REPLACE FUNCTION public.provider_connection_delete_secret(
  p_connection_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret_id uuid;
BEGIN
  SELECT credential_secret_id INTO v_secret_id
  FROM public.provider_connections
  WHERE id = p_connection_id;

  IF v_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_secret_id;
  END IF;

  UPDATE public.provider_connections
  SET credential_secret_id = NULL,
      updated_at = now()
  WHERE id = p_connection_id;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_connection_store_secret(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_connection_read_secret(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_connection_delete_secret(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.provider_connection_store_secret(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.provider_connection_read_secret(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.provider_connection_delete_secret(uuid) TO service_role;
