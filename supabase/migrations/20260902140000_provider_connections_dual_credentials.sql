-- Phase 4a: Dual credential slots (runtime API key + governance admin key).

ALTER TABLE public.provider_connections
  ADD COLUMN IF NOT EXISTS admin_credential_secret_id uuid,
  ADD COLUMN IF NOT EXISTS admin_connected_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_last_error text;

COMMENT ON COLUMN public.provider_connections.credential_secret_id IS 'vault.secrets.id for runtime API key (sk-ant-api…).';
COMMENT ON COLUMN public.provider_connections.admin_credential_secret_id IS 'vault.secrets.id for governance Admin API key (sk-ant-admin…).';

CREATE OR REPLACE FUNCTION public.provider_connection_store_secret(
  p_connection_id uuid,
  p_secret text,
  p_slot text DEFAULT 'api'
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
  v_existing uuid;
BEGIN
  IF coalesce(trim(p_secret), '') = '' THEN
    RAISE EXCEPTION 'Credential is required.';
  END IF;

  IF p_slot NOT IN ('api', 'admin') THEN
    RAISE EXCEPTION 'Invalid credential slot.';
  END IF;

  SELECT * INTO v_conn
  FROM public.provider_connections
  WHERE id = p_connection_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Connection not found.';
  END IF;

  v_name := 'provider_connection:' || p_connection_id::text || ':' || p_slot;
  v_existing := CASE WHEN p_slot = 'api' THEN v_conn.credential_secret_id ELSE v_conn.admin_credential_secret_id END;

  IF v_existing IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_existing;
  END IF;

  SELECT vault.create_secret(
    trim(p_secret),
    v_name,
    'RegAnchor provider connection credential (' || p_slot || ')'
  ) INTO v_secret_id;

  IF p_slot = 'api' THEN
    UPDATE public.provider_connections
    SET credential_secret_id = v_secret_id,
        updated_at = now()
    WHERE id = p_connection_id;
  ELSE
    UPDATE public.provider_connections
    SET admin_credential_secret_id = v_secret_id,
        updated_at = now()
    WHERE id = p_connection_id;
  END IF;

  RETURN v_secret_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.provider_connection_read_secret(
  p_connection_id uuid,
  p_slot text DEFAULT 'api'
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
  IF p_slot NOT IN ('api', 'admin') THEN
    RAISE EXCEPTION 'Invalid credential slot.';
  END IF;

  SELECT CASE WHEN p_slot = 'api' THEN credential_secret_id ELSE admin_credential_secret_id END
  INTO v_secret_id
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
  p_connection_id uuid,
  p_slot text DEFAULT 'api'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret_id uuid;
BEGIN
  IF p_slot = 'all' THEN
    PERFORM public.provider_connection_delete_secret(p_connection_id, 'api');
    PERFORM public.provider_connection_delete_secret(p_connection_id, 'admin');
    RETURN;
  END IF;

  IF p_slot NOT IN ('api', 'admin') THEN
    RAISE EXCEPTION 'Invalid credential slot.';
  END IF;

  SELECT CASE WHEN p_slot = 'api' THEN credential_secret_id ELSE admin_credential_secret_id END
  INTO v_secret_id
  FROM public.provider_connections
  WHERE id = p_connection_id;

  IF v_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_secret_id;
  END IF;

  IF p_slot = 'api' THEN
    UPDATE public.provider_connections
    SET credential_secret_id = NULL,
        updated_at = now()
    WHERE id = p_connection_id;
  ELSE
    UPDATE public.provider_connections
    SET admin_credential_secret_id = NULL,
        updated_at = now()
    WHERE id = p_connection_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_connection_store_secret(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_connection_read_secret(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_connection_delete_secret(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.provider_connection_store_secret(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.provider_connection_read_secret(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.provider_connection_delete_secret(uuid, text) TO service_role;
