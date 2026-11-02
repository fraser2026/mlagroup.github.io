-- AWS accounts connected once per organisation and shared by its Amazon Bedrock assets.
-- An organisation can connect several accounts (production, development, a supplier's account).
-- Each asset links to one account and chooses its region on provider_connections.

CREATE TABLE IF NOT EXISTS public.org_aws_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  label text CHECK (label IS NULL OR char_length(label) BETWEEN 1 AND 60),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'connected', 'error', 'revoked')),
  method text CHECK (method IN ('role', 'api_key')),
  aws_account_id text CHECK (aws_account_id IS NULL OR aws_account_id ~ '^\d{12}$'),
  home_region text NOT NULL,
  external_id text NOT NULL UNIQUE CHECK (external_id ~ '^ra-[a-f0-9]{40}$'),
  connection_ref text NOT NULL UNIQUE CHECK (connection_ref ~ '^[a-z0-9]{8}$'),
  role_arn text,
  template_version text,
  credential_secret_id uuid,
  models jsonb NOT NULL DEFAULT '{}'::jsonb,
  connected_by uuid REFERENCES auth.users(id),
  created_by uuid REFERENCES auth.users(id),
  connected_at timestamptz,
  last_verified_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS org_aws_accounts_active_account_idx
  ON public.org_aws_accounts (org_id, aws_account_id)
  WHERE status <> 'revoked' AND aws_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS org_aws_accounts_org_idx
  ON public.org_aws_accounts (org_id, status);

COMMENT ON TABLE public.org_aws_accounts IS
  'AWS accounts an organisation has connected for Amazon Bedrock. Role access needs the external ID; API keys live in Vault only.';
COMMENT ON COLUMN public.org_aws_accounts.models IS
  'Claude models available per region: {"eu-west-2": {"models": [...], "checked_at": "..."}}.';
COMMENT ON COLUMN public.org_aws_accounts.credential_secret_id IS
  'vault.secrets.id for a Bedrock API key when method = api_key. Never exposed to clients.';

ALTER TABLE public.org_aws_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_aws_accounts_select ON public.org_aws_accounts;
CREATE POLICY org_aws_accounts_select ON public.org_aws_accounts
  FOR SELECT
  USING (is_org_member(org_id));

-- Writes go through the aws-connect edge function (service role) only.

ALTER TABLE public.provider_connections
  ADD COLUMN IF NOT EXISTS org_aws_account_id uuid REFERENCES public.org_aws_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS provider_connections_org_aws_account_idx
  ON public.provider_connections (org_aws_account_id)
  WHERE org_aws_account_id IS NOT NULL;

COMMENT ON COLUMN public.provider_connections.org_aws_account_id IS
  'Amazon Bedrock assets: the organisation AWS account this asset uses. Region is metadata.aws.region.';

CREATE OR REPLACE FUNCTION public.org_aws_account_store_secret(
  p_account_id uuid,
  p_secret text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_old uuid;
  v_secret_id uuid;
BEGIN
  IF coalesce(trim(p_secret), '') = '' THEN
    RAISE EXCEPTION 'Credential is required.';
  END IF;

  SELECT credential_secret_id INTO v_old
  FROM public.org_aws_accounts
  WHERE id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AWS account not found.';
  END IF;

  IF v_old IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_old;
  END IF;

  SELECT vault.create_secret(
    trim(p_secret),
    'org_aws_account:' || p_account_id::text || ':api',
    'RegAnchor Amazon Bedrock API key'
  ) INTO v_secret_id;

  UPDATE public.org_aws_accounts
  SET credential_secret_id = v_secret_id,
      updated_at = now()
  WHERE id = p_account_id;

  RETURN v_secret_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.org_aws_account_read_secret(
  p_account_id uuid
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
  FROM public.org_aws_accounts
  WHERE id = p_account_id;

  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE id = v_secret_id;

  RETURN v_secret;
END;
$$;

CREATE OR REPLACE FUNCTION public.org_aws_account_delete_secret(
  p_account_id uuid
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
  FROM public.org_aws_accounts
  WHERE id = p_account_id;

  IF v_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_secret_id;
  END IF;

  UPDATE public.org_aws_accounts
  SET credential_secret_id = NULL,
      updated_at = now()
  WHERE id = p_account_id;
END;
$$;

REVOKE ALL ON FUNCTION public.org_aws_account_store_secret(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.org_aws_account_read_secret(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.org_aws_account_delete_secret(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.org_aws_account_store_secret(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.org_aws_account_read_secret(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.org_aws_account_delete_secret(uuid) TO service_role;

-- Carry over asset-level AWS setups. The external ID and connection reference move with the account,
-- so roles already created in AWS keep working. API key secrets move by reference, not by value.
DO $$
DECLARE
  r record;
  v_aws jsonb;
  v_region text;
  v_models jsonb;
  v_account uuid;
BEGIN
  FOR r IN
    SELECT *
    FROM public.provider_connections
    WHERE provider_slug = 'bedrock'
      AND status <> 'revoked'
      AND org_aws_account_id IS NULL
      AND metadata->'aws'->>'external_id' IS NOT NULL
    ORDER BY created_at
  LOOP
    v_aws := r.metadata->'aws';
    v_region := coalesce(v_aws->>'region', 'eu-west-2');
    v_models := CASE
      WHEN jsonb_typeof(v_aws->'models') = 'array' THEN
        jsonb_build_object(v_region, jsonb_build_object(
          'models', v_aws->'models',
          'checked_at', v_aws->'models_checked_at'
        ))
      ELSE '{}'::jsonb
    END;

    INSERT INTO public.org_aws_accounts (
      org_id, status, method, aws_account_id, home_region, external_id, connection_ref,
      role_arn, template_version, credential_secret_id, models,
      connected_by, created_by, connected_at, last_verified_at, last_error, created_at
    ) VALUES (
      r.org_id,
      CASE WHEN v_aws->>'method' IS NULL THEN 'pending' ELSE r.status END,
      v_aws->>'method',
      CASE WHEN v_aws->>'account_id' ~ '^\d{12}$' THEN v_aws->>'account_id' END,
      v_region,
      v_aws->>'external_id',
      v_aws->>'connection_ref',
      v_aws->>'role_arn',
      v_aws->>'template_version',
      CASE WHEN v_aws->>'method' = 'api_key' THEN r.credential_secret_id END,
      v_models,
      r.connected_by,
      r.connected_by,
      r.connected_at,
      r.last_verified_at,
      r.last_error,
      r.created_at
    )
    RETURNING id INTO v_account;

    IF v_aws->>'method' IS NULL THEN
      UPDATE public.provider_connections
      SET status = 'revoked', metadata = r.metadata - 'aws', updated_at = now()
      WHERE id = r.id;
    ELSE
      UPDATE public.provider_connections
      SET org_aws_account_id = v_account,
          credential_secret_id = NULL,
          metadata = (r.metadata - 'aws') || jsonb_build_object('aws', jsonb_build_object('region', v_region)),
          updated_at = now()
      WHERE id = r.id;
    END IF;
  END LOOP;
END;
$$;
