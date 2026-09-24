-- Governance dossier versions + e-signature support for dossier sign-off.
-- Signed rows are immutable; a changed workspace snapshot requires a new version.

ALTER TABLE public.e_signatures
  DROP CONSTRAINT IF EXISTS e_signatures_document_type_check;

ALTER TABLE public.e_signatures
  ADD CONSTRAINT e_signatures_document_type_check
  CHECK (
    document_type = ANY (
      ARRAY[
        'policy'::text,
        'control_completion'::text,
        'assessment'::text,
        'risk_acceptance'::text,
        'dossier'::text
      ]
    )
  );

ALTER TABLE public.e_signatures
  ADD COLUMN IF NOT EXISTS signatory_role text;

ALTER TABLE public.e_signatures
  ADD COLUMN IF NOT EXISTS signature_svg text;

CREATE TABLE IF NOT EXISTS public.governance_dossiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  dossier_code text NOT NULL,
  snapshot_hash text NOT NULL,
  content_hash text NOT NULL,
  catalogue_hash text,
  status text NOT NULL DEFAULT 'ready_for_review'
    CHECK (status = ANY (ARRAY['ready_for_review'::text, 'ready_for_signoff'::text, 'signed'::text])),
  snapshot jsonb NOT NULL,
  unsigned_storage_path text,
  signed_storage_path text,
  signature_id uuid REFERENCES public.e_signatures (id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles (id),
  reviewed_at timestamptz,
  signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT governance_dossiers_org_snapshot_unique UNIQUE (org_id, snapshot_hash)
);

CREATE INDEX IF NOT EXISTS governance_dossiers_org_created_idx
  ON public.governance_dossiers (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS governance_dossiers_org_status_idx
  ON public.governance_dossiers (org_id, status);

ALTER TABLE public.governance_dossiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS governance_dossiers_select ON public.governance_dossiers;
CREATE POLICY governance_dossiers_select
  ON public.governance_dossiers
  FOR SELECT
  USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS governance_dossiers_insert ON public.governance_dossiers;
CREATE POLICY governance_dossiers_insert
  ON public.governance_dossiers
  FOR INSERT
  WITH CHECK (
    public.is_org_member(org_id)
    AND EXISTS (
      SELECT 1
      FROM public.org_members m
      WHERE m.org_id = governance_dossiers.org_id
        AND m.user_id = auth.uid()
        AND lower(m.role) IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS governance_dossiers_update ON public.governance_dossiers;
CREATE POLICY governance_dossiers_update
  ON public.governance_dossiers
  FOR UPDATE
  USING (
    public.is_org_member(org_id)
    AND status <> 'signed'
    AND EXISTS (
      SELECT 1
      FROM public.org_members m
      WHERE m.org_id = governance_dossiers.org_id
        AND m.user_id = auth.uid()
        AND lower(m.role) IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    public.is_org_member(org_id)
    AND EXISTS (
      SELECT 1
      FROM public.org_members m
      WHERE m.org_id = governance_dossiers.org_id
        AND m.user_id = auth.uid()
        AND lower(m.role) IN ('owner', 'admin')
    )
  );

COMMENT ON TABLE public.governance_dossiers IS
  'Point-in-time AI Governance Dossier versions. Signed rows must not be mutated; regenerate for a new snapshot_hash.';
