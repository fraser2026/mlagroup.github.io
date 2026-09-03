-- Registry asset deletion: soft-delete, archive for recovery, RegAnchor review gate.

ALTER TABLE public.ai_systems
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

COMMENT ON COLUMN public.ai_systems.deleted_at IS 'Soft-delete timestamp; active registry queries exclude non-null rows.';
COMMENT ON COLUMN public.ai_systems.deleted_by IS 'User who removed the asset from the active registry.';

CREATE TABLE IF NOT EXISTS public.registry_deleted_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  original_system_id uuid NOT NULL,
  asset_snapshot jsonb NOT NULL,
  governance_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  deletion_mode text NOT NULL CHECK (deletion_mode IN ('immediate', 'reviewed')),
  delete_reason text,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  deleted_by uuid REFERENCES auth.users(id),
  restored_at timestamptz,
  restored_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS registry_deleted_assets_org_idx
  ON public.registry_deleted_assets (org_id, deleted_at DESC);

CREATE INDEX IF NOT EXISTS registry_deleted_assets_system_idx
  ON public.registry_deleted_assets (original_system_id);

COMMENT ON TABLE public.registry_deleted_assets IS 'Recoverable archive when a registry asset is removed from the active inventory.';

CREATE TABLE IF NOT EXISTS public.registry_delete_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  system_id uuid NOT NULL REFERENCES public.ai_systems(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  governance_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  review_notes text
);

CREATE UNIQUE INDEX IF NOT EXISTS registry_delete_requests_pending_system_idx
  ON public.registry_delete_requests (system_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS registry_delete_requests_status_idx
  ON public.registry_delete_requests (status, requested_at DESC);

COMMENT ON TABLE public.registry_delete_requests IS 'Client-requested asset deletion pending RegAnchor review when governance work exists.';

-- Hide soft-deleted assets from normal org member reads.
DROP POLICY IF EXISTS systems_select ON public.ai_systems;
CREATE POLICY systems_select ON public.ai_systems
  FOR SELECT
  USING (is_org_member(org_id) AND deleted_at IS NULL);

ALTER TABLE public.registry_deleted_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registry_delete_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY deleted_assets_select ON public.registry_deleted_assets
  FOR SELECT
  USING (has_org_role(org_id, ARRAY['owner', 'admin']) OR is_mla_admin());

CREATE POLICY deleted_assets_admin_select ON public.registry_deleted_assets
  FOR SELECT
  USING (is_mla_admin());

CREATE POLICY delete_requests_select ON public.registry_delete_requests
  FOR SELECT
  USING (is_org_member(org_id) OR is_mla_admin());

CREATE POLICY delete_requests_admin_select ON public.registry_delete_requests
  FOR SELECT
  USING (is_mla_admin());

CREATE OR REPLACE FUNCTION public.registry_asset_governance_footprint(p_system_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'assessments', (
      SELECT count(*)::int FROM public.registry_assessments WHERE system_id = p_system_id
    ),
    'controls', (
      SELECT count(*)::int FROM public.control_assignments WHERE system_id = p_system_id
    ),
    'controls_active', (
      SELECT count(*)::int FROM public.control_assignments
      WHERE system_id = p_system_id
        AND (
          status <> 'not_started'
          OR coalesce(task_responses, '{}'::jsonb) <> '{}'::jsonb
        )
    ),
    'evidence', (
      SELECT count(*)::int FROM public.evidence_uploads WHERE system_id = p_system_id
    ),
    'support_requests', (
      SELECT count(*)::int FROM public.support_requests WHERE system_id = p_system_id
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.registry_asset_requires_delete_review(p_system_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.registry_assessments WHERE system_id = p_system_id
  )
  OR EXISTS (
    SELECT 1 FROM public.control_assignments
    WHERE system_id = p_system_id
      AND (
        status <> 'not_started'
        OR coalesce(task_responses, '{}'::jsonb) <> '{}'::jsonb
      )
  )
  OR EXISTS (
    SELECT 1 FROM public.evidence_uploads WHERE system_id = p_system_id
  )
  OR EXISTS (
    SELECT 1 FROM public.support_requests WHERE system_id = p_system_id
  );
$$;

CREATE OR REPLACE FUNCTION public._registry_archive_deleted_asset(
  p_system public.ai_systems,
  p_deleted_by uuid,
  p_reason text,
  p_deletion_mode text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_archive_id uuid;
  v_footprint jsonb;
BEGIN
  v_footprint := registry_asset_governance_footprint(p_system.id);

  UPDATE public.ai_systems
  SET deleted_at = now(),
      deleted_by = p_deleted_by,
      updated_at = now()
  WHERE id = p_system.id;

  INSERT INTO public.registry_deleted_assets (
    org_id,
    original_system_id,
    asset_snapshot,
    governance_snapshot,
    deletion_mode,
    delete_reason,
    deleted_by
  )
  VALUES (
    p_system.org_id,
    p_system.id,
    to_jsonb(p_system),
    v_footprint,
    p_deletion_mode,
    p_reason,
    p_deleted_by
  )
  RETURNING id INTO v_archive_id;

  INSERT INTO public.registry_audit_log (
    org_id,
    user_id,
    action,
    entity_type,
    entity_id,
    changes
  )
  VALUES (
    p_system.org_id,
    p_deleted_by,
    'system_deleted',
    'ai_system',
    p_system.id,
    jsonb_build_object(
      '_system_name', p_system.name,
      'deletion_mode', p_deletion_mode,
      'delete_reason', coalesce(p_reason, ''),
      'governance_snapshot', v_footprint,
      'archive_id', v_archive_id
    )
  );

  RETURN v_archive_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_registry_asset_delete_preview(p_system_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_system public.ai_systems;
BEGIN
  SELECT * INTO v_system
  FROM public.ai_systems
  WHERE id = p_system_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Asset not found.');
  END IF;

  IF v_system.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Asset is already deleted.');
  END IF;

  IF NOT has_org_role(v_system.org_id, ARRAY['owner', 'admin']) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Only organisation owners and admins can delete registry assets.');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'system_id', v_system.id,
    'system_name', v_system.name,
    'requires_review', registry_asset_requires_delete_review(v_system.id),
    'footprint', registry_asset_governance_footprint(v_system.id),
    'pending_request', EXISTS (
      SELECT 1 FROM public.registry_delete_requests
      WHERE system_id = v_system.id AND status = 'pending'
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_registry_asset(
  p_system_id uuid,
  p_reason text,
  p_confirm_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_system public.ai_systems;
  v_requires_review boolean;
  v_request_id uuid;
  v_archive_id uuid;
  v_footprint jsonb;
BEGIN
  IF coalesce(trim(p_reason), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'A reason is required.');
  END IF;

  SELECT * INTO v_system
  FROM public.ai_systems
  WHERE id = p_system_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Asset not found.');
  END IF;

  IF v_system.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Asset is already deleted.');
  END IF;

  IF NOT has_org_role(v_system.org_id, ARRAY['owner', 'admin']) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Only organisation owners and admins can delete registry assets.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.registry_delete_requests
    WHERE system_id = p_system_id AND status = 'pending'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'A deletion request is already pending RegAnchor review.');
  END IF;

  v_requires_review := registry_asset_requires_delete_review(p_system_id);
  v_footprint := registry_asset_governance_footprint(p_system_id);

  IF v_requires_review THEN
    INSERT INTO public.registry_delete_requests (
      org_id,
      system_id,
      requested_by,
      reason,
      governance_summary
    )
    VALUES (
      v_system.org_id,
      v_system.id,
      auth.uid(),
      trim(p_reason),
      v_footprint
    )
    RETURNING id INTO v_request_id;

    INSERT INTO public.registry_audit_log (
      org_id,
      user_id,
      action,
      entity_type,
      entity_id,
      changes
    )
    VALUES (
      v_system.org_id,
      auth.uid(),
      'delete_requested',
      'ai_system',
      v_system.id,
      jsonb_build_object(
        '_system_name', v_system.name,
        'delete_reason', trim(p_reason),
        'governance_snapshot', v_footprint,
        'request_id', v_request_id
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'mode', 'review_requested',
      'request_id', v_request_id
    );
  END IF;

  IF coalesce(trim(p_confirm_name), '') = '' OR trim(p_confirm_name) <> v_system.name THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Type the exact asset name to confirm deletion.');
  END IF;

  v_archive_id := _registry_archive_deleted_asset(
    v_system,
    auth.uid(),
    trim(p_reason),
    'immediate'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'mode', 'deleted',
    'archive_id', v_archive_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_registry_delete_request(
  p_request_id uuid,
  p_review_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.registry_delete_requests;
  v_system public.ai_systems;
  v_archive_id uuid;
BEGIN
  IF NOT is_mla_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RegAnchor administrator access required.');
  END IF;

  SELECT * INTO v_request
  FROM public.registry_delete_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Deletion request not found.');
  END IF;

  IF v_request.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Deletion request is no longer pending.');
  END IF;

  SELECT * INTO v_system
  FROM public.ai_systems
  WHERE id = v_request.system_id
  FOR UPDATE;

  IF NOT FOUND OR v_system.deleted_at IS NOT NULL THEN
    UPDATE public.registry_delete_requests
    SET status = 'cancelled',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        review_notes = coalesce(p_review_notes, 'Asset already removed.')
    WHERE id = p_request_id;

    RETURN jsonb_build_object('ok', false, 'error', 'Asset is no longer active.');
  END IF;

  v_archive_id := _registry_archive_deleted_asset(
    v_system,
    auth.uid(),
    v_request.reason,
    'reviewed'
  );

  UPDATE public.registry_delete_requests
  SET status = 'approved',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_notes = nullif(trim(p_review_notes), '')
  WHERE id = p_request_id;

  INSERT INTO public.registry_audit_log (
    org_id,
    user_id,
    action,
    entity_type,
    entity_id,
    changes
  )
  VALUES (
    v_system.org_id,
    auth.uid(),
    'delete_approved',
    'ai_system',
    v_system.id,
    jsonb_build_object(
      '_system_name', v_system.name,
      '_is_mla', true,
      '_actor_name', 'RegAnchor',
      'request_id', p_request_id,
      'archive_id', v_archive_id,
      'review_notes', coalesce(p_review_notes, '')
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'mode', 'deleted',
    'archive_id', v_archive_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_registry_delete_request(
  p_request_id uuid,
  p_review_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.registry_delete_requests;
  v_system_name text;
BEGIN
  IF NOT is_mla_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RegAnchor administrator access required.');
  END IF;

  SELECT * INTO v_request
  FROM public.registry_delete_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Deletion request not found.');
  END IF;

  SELECT name INTO v_system_name
  FROM public.ai_systems
  WHERE id = v_request.system_id;

  IF v_request.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Deletion request is no longer pending.');
  END IF;

  UPDATE public.registry_delete_requests
  SET status = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_notes = nullif(trim(p_review_notes), '')
  WHERE id = p_request_id;

  INSERT INTO public.registry_audit_log (
    org_id,
    user_id,
    action,
    entity_type,
    entity_id,
    changes
  )
  VALUES (
    v_request.org_id,
    auth.uid(),
    'delete_rejected',
    'ai_system',
    v_request.system_id,
    jsonb_build_object(
      '_system_name', v_system_name,
      '_is_mla', true,
      '_actor_name', 'RegAnchor',
      'request_id', p_request_id,
      'review_notes', coalesce(p_review_notes, '')
    )
  );

  RETURN jsonb_build_object('ok', true, 'mode', 'rejected');
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_registry_deleted_asset(p_archive_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_archive public.registry_deleted_assets;
BEGIN
  SELECT * INTO v_archive
  FROM public.registry_deleted_assets
  WHERE id = p_archive_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Deleted asset archive not found.');
  END IF;

  IF v_archive.restored_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This asset has already been restored.');
  END IF;

  IF v_archive.deleted_at < now() - interval '30 days' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Restore window has expired (30 days).');
  END IF;

  IF NOT has_org_role(v_archive.org_id, ARRAY['owner', 'admin']) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Only organisation owners and admins can restore deleted assets.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.ai_systems
    WHERE id = v_archive.original_system_id AND deleted_at IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Active asset record is not in a restorable state.');
  END IF;

  UPDATE public.ai_systems
  SET deleted_at = NULL,
      deleted_by = NULL,
      updated_at = now()
  WHERE id = v_archive.original_system_id;

  UPDATE public.registry_deleted_assets
  SET restored_at = now(),
      restored_by = auth.uid()
  WHERE id = p_archive_id;

  INSERT INTO public.registry_audit_log (
    org_id,
    user_id,
    action,
    entity_type,
    entity_id,
    changes
  )
  VALUES (
    v_archive.org_id,
    auth.uid(),
    'system_restored',
    'ai_system',
    v_archive.original_system_id,
    jsonb_build_object(
      '_system_name', v_archive.asset_snapshot->>'name',
      'archive_id', p_archive_id
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'system_id', v_archive.original_system_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_registry_asset_delete_preview(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_registry_asset(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_registry_deleted_asset(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_registry_delete_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_registry_delete_request(uuid, text) TO authenticated;
