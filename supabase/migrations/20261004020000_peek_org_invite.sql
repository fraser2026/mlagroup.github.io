-- Public peek for org invite landing (token is unguessable; reveals email/org/role only).
CREATE OR REPLACE FUNCTION public.peek_org_invite(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_inv public.org_invites%ROWTYPE;
  v_org_name text;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid invitation');
  END IF;
  SELECT * INTO v_inv FROM public.org_invites
    WHERE token_hash = digest(p_token, 'sha256')
    LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invitation not found');
  END IF;
  IF v_inv.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This invitation was revoked');
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This invitation was already accepted');
  END IF;
  IF v_inv.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This invitation has expired');
  END IF;
  SELECT name INTO v_org_name FROM public.organisations WHERE id = v_inv.org_id;
  RETURN jsonb_build_object(
    'ok', true,
    'email', v_inv.email,
    'role', v_inv.role,
    'org_id', v_inv.org_id,
    'org_name', coalesce(v_org_name, 'your organisation'),
    'expires_at', v_inv.expires_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.peek_org_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.peek_org_invite(text) TO anon, authenticated;
