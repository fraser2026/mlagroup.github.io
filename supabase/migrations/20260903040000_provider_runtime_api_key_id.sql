-- Attribute Anthropic usage to the runtime key on this asset.

ALTER TABLE public.provider_connections
  ADD COLUMN IF NOT EXISTS runtime_api_key_id text,
  ADD COLUMN IF NOT EXISTS runtime_workspace_id text;

COMMENT ON COLUMN public.provider_connections.runtime_api_key_id IS 'Provider API key id (e.g. apikey_…) matched from the stored runtime secret. Used to filter usage reports to this asset.';
COMMENT ON COLUMN public.provider_connections.runtime_workspace_id IS 'Provider workspace id for the matched runtime key, when Anthropic reports one.';
