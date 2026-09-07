-- RegAnchor MCP device auth and opaque tokens.
-- Plaintext tokens are returned once; only SHA-256 hashes are stored.

CREATE TABLE IF NOT EXISTS public.mcp_device_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_code_hash text NOT NULL UNIQUE CHECK (device_code_hash ~ '^[0-9a-f]{64}$'),
  user_code text NOT NULL UNIQUE CHECK (user_code ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'consumed')),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.organisations(id) ON DELETE CASCADE,
  client_name text NOT NULL DEFAULT 'mcp-client' CHECK (char_length(client_name) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS mcp_device_codes_user_code_idx
  ON public.mcp_device_codes (user_code)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS mcp_device_codes_expires_idx
  ON public.mcp_device_codes (expires_at)
  WHERE status = 'pending';

COMMENT ON TABLE public.mcp_device_codes IS
  'OAuth-style device codes for MCP login. Plaintext device codes are never stored.';

CREATE TABLE IF NOT EXISTS public.mcp_refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.organisations(id) ON DELETE SET NULL,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  label text NOT NULL DEFAULT 'MCP refresh' CHECK (char_length(label) BETWEEN 1 AND 80),
  client_name text NOT NULL DEFAULT 'mcp-client' CHECK (char_length(client_name) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS mcp_refresh_tokens_user_idx
  ON public.mcp_refresh_tokens (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS mcp_refresh_tokens_active_hash_idx
  ON public.mcp_refresh_tokens (token_hash)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.mcp_refresh_tokens IS
  'Long-lived MCP refresh credentials. Access tokens are short-lived and derived at exchange time.';

CREATE TABLE IF NOT EXISTS public.mcp_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  refresh_token_id uuid NOT NULL REFERENCES public.mcp_refresh_tokens(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS mcp_access_tokens_active_hash_idx
  ON public.mcp_access_tokens (token_hash)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.mcp_access_tokens IS
  'Short-lived MCP access tokens presented as Bearer credentials to the MCP HTTP endpoint.';

ALTER TABLE public.mcp_device_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_access_tokens ENABLE ROW LEVEL SECURITY;

-- Lifecycle is mediated by Edge Functions (service role). Authenticated users may
-- read their own pending device approvals and active refresh token metadata.
DROP POLICY IF EXISTS mcp_device_codes_select_own ON public.mcp_device_codes;
CREATE POLICY mcp_device_codes_select_own ON public.mcp_device_codes
  FOR SELECT
  USING (
    status = 'pending'
    OR (user_id IS NOT NULL AND user_id = auth.uid())
  );

DROP POLICY IF EXISTS mcp_refresh_tokens_select_own ON public.mcp_refresh_tokens;
CREATE POLICY mcp_refresh_tokens_select_own ON public.mcp_refresh_tokens
  FOR SELECT
  USING (user_id = auth.uid());

-- No client insert/update/delete policies: auth Edge Functions own writes.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.mcp_device_codes FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.mcp_refresh_tokens FROM anon, authenticated;
REVOKE ALL ON TABLE public.mcp_access_tokens FROM anon, authenticated;

GRANT SELECT ON TABLE public.mcp_device_codes, public.mcp_refresh_tokens TO authenticated;
GRANT ALL ON TABLE public.mcp_device_codes, public.mcp_refresh_tokens, public.mcp_access_tokens TO service_role;
