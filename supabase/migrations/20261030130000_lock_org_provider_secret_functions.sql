-- The organisation admin-key Vault functions were revoked from PUBLIC only.
-- Supabase also grants EXECUTE to anon and authenticated directly, which left
-- them callable through /rest/v1/rpc. Only server functions (service role)
-- may read, store or delete organisation provider secrets.

REVOKE ALL ON FUNCTION public.org_provider_store_secret(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.org_provider_read_secret(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.org_provider_delete_secret(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.org_provider_store_secret(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.org_provider_read_secret(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.org_provider_delete_secret(uuid) TO service_role;
