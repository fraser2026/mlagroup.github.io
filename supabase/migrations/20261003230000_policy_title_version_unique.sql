-- Controlled-document uniqueness: one active title+version per org.
-- Matches ISO / GRC practice: revision under a title is unique in the active set.
-- Inactive (is_active = false) rows are excluded so soft-hidden orphans do not block.

-- One-off: founder smoke created a second active published AUP v0.1.
-- Keep the earlier row; deactivate the later orphan so the unique index can apply.
UPDATE public.policy_documents
SET
  is_active = false,
  updated_at = now()
WHERE id = '40011d24-b148-4a15-bcbe-0f1adc3a9799'
  AND org_id = 'a148f419-6970-4474-a017-4a4f5e3bc248'
  AND is_active = true
  AND version = '0.1'
  AND lower(trim(title)) = 'ai acceptable use policy';

-- Any remaining active collisions (should be none after the one-off): keep oldest, soft-hide rest.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY org_id, lower(trim(title)), version
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.policy_documents
  WHERE is_active = true
)
UPDATE public.policy_documents p
SET
  is_active = false,
  updated_at = now()
FROM ranked r
WHERE p.id = r.id
  AND r.rn > 1
  AND p.is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS policy_documents_org_title_version_active_uidx
  ON public.policy_documents (org_id, lower(trim(title)), version)
  WHERE is_active = true;

COMMENT ON INDEX public.policy_documents_org_title_version_active_uidx IS
  'Active controlled policies: unique (org, title CI, version). Draft and published share the key.';

-- Preflight helper for clients (optional; UI also queries directly).
CREATE OR REPLACE FUNCTION public.policy_title_version_available(
  p_org_id uuid,
  p_title text,
  p_version text,
  p_exclude_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.policy_documents d
    WHERE d.org_id = p_org_id
      AND d.is_active = true
      AND d.version = trim(p_version)
      AND lower(trim(d.title)) = lower(trim(p_title))
      AND (p_exclude_id IS NULL OR d.id <> p_exclude_id)
  );
$$;

REVOKE ALL ON FUNCTION public.policy_title_version_available(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.policy_title_version_available(uuid, text, text, uuid) TO authenticated;
