-- In-app help requests from any page (not only controls) + MLA evidence review.

ALTER TABLE public.support_requests ALTER COLUMN control_assignment_id DROP NOT NULL;
ALTER TABLE public.support_requests ALTER COLUMN control_id DROP NOT NULL;

ALTER TABLE public.support_requests
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS page_path text,
  ADD COLUMN IF NOT EXISTS page_title text,
  ADD COLUMN IF NOT EXISTS attachment_path text,
  ADD COLUMN IF NOT EXISTS attachment_name text,
  ADD COLUMN IF NOT EXISTS attachment_size integer,
  ADD COLUMN IF NOT EXISTS attachment_type text;

-- Any workspace member (including viewers) can ask for help, as themselves.
DROP POLICY IF EXISTS sr_insert ON public.support_requests;
CREATE POLICY sr_insert
  ON public.support_requests
  FOR INSERT
  WITH CHECK (public.is_org_member(org_id) AND requested_by = auth.uid());

CREATE INDEX IF NOT EXISTS support_requests_status_idx
  ON public.support_requests (status, requested_at DESC);

ALTER TABLE public.evidence_uploads
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

ALTER TABLE public.evidence_uploads DROP CONSTRAINT IF EXISTS evidence_uploads_review_status_check;
ALTER TABLE public.evidence_uploads
  ADD CONSTRAINT evidence_uploads_review_status_check
  CHECK (review_status = ANY (ARRAY['submitted'::text, 'accepted'::text, 'changes_requested'::text]));

DROP POLICY IF EXISTS eu_update_admin ON public.evidence_uploads;
CREATE POLICY eu_update_admin
  ON public.evidence_uploads
  FOR UPDATE
  USING (public.is_mla_admin())
  WITH CHECK (public.is_mla_admin());

CREATE INDEX IF NOT EXISTS evidence_uploads_review_idx
  ON public.evidence_uploads (review_status, uploaded_at DESC);
