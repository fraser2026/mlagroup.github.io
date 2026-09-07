-- MCP OAuth 2.1 (PKCE) + portal connect support.
-- Opaque MCP tokens remain ra_mcp_at_ / ra_mcp_rt_; OAuth issues the same families.

ALTER TABLE public.mcp_refresh_tokens
  ADD COLUMN IF NOT EXISTS resource text
    CHECK (resource IS NULL OR char_length(resource) BETWEEN 8 AND 512);

CREATE TABLE IF NOT EXISTS public.mcp_oauth_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text NOT NULL UNIQUE CHECK (char_length(client_id) BETWEEN 8 AND 128),
  client_name text NOT NULL DEFAULT 'MCP client' CHECK (char_length(client_name) BETWEEN 1 AND 120),
  redirect_uris jsonb NOT NULL DEFAULT '[]'::jsonb,
  grant_types jsonb NOT NULL DEFAULT '["authorization_code","refresh_token"]'::jsonb,
  token_endpoint_auth_method text NOT NULL DEFAULT 'none'
    CHECK (token_endpoint_auth_method IN ('none', 'client_secret_post', 'client_secret_basic')),
  client_secret_hash text CHECK (client_secret_hash IS NULL OR client_secret_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS mcp_oauth_clients_active_idx
  ON public.mcp_oauth_clients (client_id)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.mcp_oauth_clients IS
  'OAuth clients for MCP (Cursor DCR / pre-registered). Public clients use auth method none + PKCE.';

CREATE TABLE IF NOT EXISTS public.mcp_oauth_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  client_id text NOT NULL REFERENCES public.mcp_oauth_clients(client_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.organisations(id) ON DELETE SET NULL,
  redirect_uri text NOT NULL CHECK (char_length(redirect_uri) BETWEEN 8 AND 512),
  code_challenge text NOT NULL CHECK (char_length(code_challenge) BETWEEN 43 AND 128),
  code_challenge_method text NOT NULL DEFAULT 'S256' CHECK (code_challenge_method = 'S256'),
  resource text CHECK (resource IS NULL OR char_length(resource) BETWEEN 8 AND 512),
  scope text NOT NULL DEFAULT 'mcp:tools',
  state text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS mcp_oauth_codes_pending_idx
  ON public.mcp_oauth_codes (code_hash)
  WHERE consumed_at IS NULL;

COMMENT ON TABLE public.mcp_oauth_codes IS
  'Authorization codes for MCP OAuth. Plaintext codes returned once; only SHA-256 hashes stored.';

ALTER TABLE public.mcp_oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_oauth_codes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mcp_oauth_clients FROM anon, authenticated;
REVOKE ALL ON TABLE public.mcp_oauth_codes FROM anon, authenticated;
GRANT ALL ON TABLE public.mcp_oauth_clients, public.mcp_oauth_codes TO service_role;
