-- User-scoped MFA recovery codes (hashed). Shown once at generation; verify later on challenge screen.

CREATE TABLE IF NOT EXISTS public.user_mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_mfa_recovery_codes_user_idx
  ON public.user_mfa_recovery_codes (user_id)
  WHERE used_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_mfa_recovery_codes_hash_uidx
  ON public.user_mfa_recovery_codes (user_id, code_hash);

COMMENT ON TABLE public.user_mfa_recovery_codes IS
  'SHA-256 hashes of one-time MFA recovery codes. Plaintext shown once in the client only.';

ALTER TABLE public.user_mfa_recovery_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_mfa_recovery_codes_select ON public.user_mfa_recovery_codes;
CREATE POLICY user_mfa_recovery_codes_select ON public.user_mfa_recovery_codes
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_mfa_recovery_codes_insert ON public.user_mfa_recovery_codes;
CREATE POLICY user_mfa_recovery_codes_insert ON public.user_mfa_recovery_codes
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_mfa_recovery_codes_delete ON public.user_mfa_recovery_codes;
CREATE POLICY user_mfa_recovery_codes_delete ON public.user_mfa_recovery_codes
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_mfa_recovery_codes_update ON public.user_mfa_recovery_codes;
CREATE POLICY user_mfa_recovery_codes_update ON public.user_mfa_recovery_codes
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
