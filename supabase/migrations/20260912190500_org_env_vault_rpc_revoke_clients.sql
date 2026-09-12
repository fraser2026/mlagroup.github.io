-- Ensure Vault RPCs for org env are service_role-only (Postgres often retains anon/authenticated EXECUTE).
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
