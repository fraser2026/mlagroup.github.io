-- Append-only audit trail for governance dossier versions.
-- Records who did what to a dossier version and when (UTC), with request metadata.

CREATE TABLE IF NOT EXISTS public.governance_dossier_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_version_id uuid NOT NULL REFERENCES public.governance_dossiers (id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  event_type text NOT NULL
    CHECK (event_type = ANY (ARRAY[
      'generated'::text,
      'viewed'::text,
      'signed'::text,
      'finalised'::text,
      'downloaded'::text
    ])),
  actor_user_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  actor_name text,
  actor_email text,
  ip_address text,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS governance_dossier_events_version_idx
  ON public.governance_dossier_events (dossier_version_id, occurred_at);

CREATE INDEX IF NOT EXISTS governance_dossier_events_org_idx
  ON public.governance_dossier_events (org_id, occurred_at DESC);

ALTER TABLE public.governance_dossier_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS governance_dossier_events_select ON public.governance_dossier_events;
CREATE POLICY governance_dossier_events_select
  ON public.governance_dossier_events
  FOR SELECT
  USING (public.is_org_member(org_id));

-- No insert/update/delete policies: writes go through the generate-dossier edge function.
-- The trigger below also blocks the service role from rewriting history.
CREATE OR REPLACE FUNCTION public.governance_dossier_events_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'governance_dossier_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS governance_dossier_events_no_update ON public.governance_dossier_events;
CREATE TRIGGER governance_dossier_events_no_update
  BEFORE UPDATE ON public.governance_dossier_events
  FOR EACH ROW EXECUTE FUNCTION public.governance_dossier_events_immutable();

COMMENT ON TABLE public.governance_dossier_events IS
  'Append-only audit trail for governance dossier versions (generated, viewed, signed, finalised, downloaded).';

-- Backfill versions created before the audit trail existed.
INSERT INTO public.governance_dossier_events
  (dossier_version_id, org_id, event_type, actor_user_id, actor_name, actor_email, metadata, occurred_at)
SELECT d.id, d.org_id, 'generated', d.created_by, p.full_name, p.email,
       jsonb_build_object('dossier_code', d.dossier_code, 'snapshot_hash', d.snapshot_hash, 'backfilled', true),
       d.created_at
FROM public.governance_dossiers d
LEFT JOIN public.profiles p ON p.id = d.created_by
WHERE NOT EXISTS (
  SELECT 1 FROM public.governance_dossier_events e
  WHERE e.dossier_version_id = d.id AND e.event_type = 'generated'
);

INSERT INTO public.governance_dossier_events
  (dossier_version_id, org_id, event_type, actor_user_id, actor_name, actor_email, metadata, occurred_at)
SELECT d.id, d.org_id, 'viewed', d.created_by, p.full_name, p.email,
       jsonb_build_object('backfilled', true),
       d.reviewed_at
FROM public.governance_dossiers d
LEFT JOIN public.profiles p ON p.id = d.created_by
WHERE d.reviewed_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.governance_dossier_events e
    WHERE e.dossier_version_id = d.id AND e.event_type = 'viewed'
  );

INSERT INTO public.governance_dossier_events
  (dossier_version_id, org_id, event_type, actor_user_id, actor_name, actor_email, ip_address, user_agent, metadata, occurred_at)
SELECT d.id, d.org_id, 'signed', s.user_id, s.signatory_name, s.signatory_email, s.ip_address, s.user_agent,
       jsonb_build_object(
         'signature_id', s.id,
         'signatory_role', s.signatory_role,
         'content_hash', s.content_hash,
         'declaration', s.declaration_text,
         'backfilled', true
       ),
       s.signed_at
FROM public.governance_dossiers d
JOIN public.e_signatures s ON s.id = d.signature_id
WHERE d.status = 'signed'
  AND NOT EXISTS (
    SELECT 1 FROM public.governance_dossier_events e
    WHERE e.dossier_version_id = d.id AND e.event_type = 'signed'
  );
