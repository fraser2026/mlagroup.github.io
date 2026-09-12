-- Foundation for org data backends (warehouses / databases).
-- UI-first: connections are not live yet. Credentials will use Vault later (same pattern as org_env / providers).

CREATE TABLE IF NOT EXISTS public.data_backend_catalog (
  slug text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('warehouse', 'database')),
  description text NOT NULL DEFAULT '',
  docs_url text,
  connector_available boolean NOT NULL DEFAULT false,
  display_order int NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.data_backend_catalog IS
  'Reference catalog of data warehouses/databases RegAnchor may connect for monitoring (DPA / read access).';

INSERT INTO public.data_backend_catalog (slug, name, kind, description, docs_url, connector_available, display_order)
VALUES
  ('bigquery', 'BigQuery', 'warehouse', 'Connect a Google BigQuery warehouse.', 'https://cloud.google.com/bigquery/docs', false, 10),
  ('snowflake', 'Snowflake', 'warehouse', 'Connect a Snowflake warehouse.', 'https://docs.snowflake.com/', false, 20),
  ('databricks', 'Databricks', 'warehouse', 'Connect a Databricks workspace.', 'https://docs.databricks.com/', false, 30),
  ('redshift', 'Redshift', 'warehouse', 'Connect an Amazon Redshift cluster.', 'https://docs.aws.amazon.com/redshift/', false, 40),
  ('postgres', 'Postgres', 'database', 'Connect a PostgreSQL database.', 'https://www.postgresql.org/docs/', false, 50)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    kind = EXCLUDED.kind,
    description = EXCLUDED.description,
    docs_url = EXCLUDED.docs_url,
    display_order = EXCLUDED.display_order,
    is_active = true;

ALTER TABLE public.data_backend_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS data_backend_catalog_select ON public.data_backend_catalog;
CREATE POLICY data_backend_catalog_select ON public.data_backend_catalog
  FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE TABLE IF NOT EXISTS public.org_data_backends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  backend_slug text NOT NULL REFERENCES public.data_backend_catalog(slug),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'connected', 'error', 'revoked')),
  label text,
  credential_secret_id uuid,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  connected_by uuid REFERENCES auth.users(id),
  connected_at timestamptz,
  last_verified_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS org_data_backends_active_org_slug_uidx
  ON public.org_data_backends (org_id, backend_slug)
  WHERE status <> 'revoked';

CREATE INDEX IF NOT EXISTS org_data_backends_org_idx
  ON public.org_data_backends (org_id);

COMMENT ON TABLE public.org_data_backends IS
  'Org-scoped data backend connections. Secrets will live in Vault via credential_secret_id; no live connectors yet.';
COMMENT ON COLUMN public.org_data_backends.credential_secret_id IS
  'Future vault.secrets.id for connection credentials. Never expose decrypted values to clients.';
COMMENT ON COLUMN public.org_data_backends.config IS
  'Non-secret connection metadata (project id, account, host, region, warehouse name, etc.).';

ALTER TABLE public.org_data_backends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_data_backends_select ON public.org_data_backends;
CREATE POLICY org_data_backends_select ON public.org_data_backends
  FOR SELECT
  USING (is_org_member(org_id));

-- Writes will go through service-role edge functions when connectors ship.
