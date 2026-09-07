-- Already applied live. Alerts: authenticated read/write with immutable payload; no anon; no client DELETE.
REVOKE ALL ON TABLE public.governance_alerts FROM anon;
REVOKE DELETE, TRUNCATE ON TABLE public.governance_alerts FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.governance_alerts TO authenticated;

DROP POLICY IF EXISTS "org members and admins can insert alerts" ON public.governance_alerts;
DROP POLICY IF EXISTS "admin can read all alerts" ON public.governance_alerts;
DROP POLICY IF EXISTS "org members can read their alerts" ON public.governance_alerts;
DROP POLICY IF EXISTS "org members can update their alerts" ON public.governance_alerts;

DROP POLICY IF EXISTS alerts_select_member ON public.governance_alerts;
CREATE POLICY alerts_select_member
  ON public.governance_alerts
  FOR SELECT
  TO authenticated
  USING (is_org_member(org_id));

DROP POLICY IF EXISTS alerts_select_admin ON public.governance_alerts;
CREATE POLICY alerts_select_admin
  ON public.governance_alerts
  FOR SELECT
  TO authenticated
  USING (is_mla_admin());

DROP POLICY IF EXISTS alerts_insert_writer ON public.governance_alerts;
CREATE POLICY alerts_insert_writer
  ON public.governance_alerts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner'::text, 'admin'::text, 'editor'::text])
    OR is_mla_admin()
  );

DROP POLICY IF EXISTS alerts_update_member ON public.governance_alerts;
CREATE POLICY alerts_update_member
  ON public.governance_alerts
  FOR UPDATE
  TO authenticated
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id));

DROP POLICY IF EXISTS alerts_update_admin ON public.governance_alerts;
CREATE POLICY alerts_update_admin
  ON public.governance_alerts
  FOR UPDATE
  TO authenticated
  USING (is_mla_admin())
  WITH CHECK (is_mla_admin());

CREATE OR REPLACE FUNCTION public.protect_governance_alert_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.email_sent := false;
    NEW.email_sent_at := NULL;
    NEW.resolved_at := NULL;
    NEW.resolved_by := NULL;
    RETURN NEW;
  END IF;

  IF NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.system_id IS DISTINCT FROM OLD.system_id
     OR NEW.alert_type IS DISTINCT FROM OLD.alert_type
     OR NEW.severity IS DISTINCT FROM OLD.severity
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.ref_id IS DISTINCT FROM OLD.ref_id
     OR NEW.ref_type IS DISTINCT FROM OLD.ref_type
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.email_sent IS DISTINCT FROM OLD.email_sent
     OR NEW.email_sent_at IS DISTINCT FROM OLD.email_sent_at THEN
    RAISE EXCEPTION 'governance_alerts payload is immutable';
  END IF;

  IF OLD.resolved_at IS NOT NULL AND NEW.resolved_at IS DISTINCT FROM OLD.resolved_at THEN
    RAISE EXCEPTION 'governance_alerts resolve is immutable';
  END IF;

  IF NEW.resolved_at IS NOT NULL AND OLD.resolved_at IS NULL THEN
    NEW.resolved_by := auth.uid();
    NEW.is_read := true;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS protect_governance_alert_row ON public.governance_alerts;
CREATE TRIGGER protect_governance_alert_row
  BEFORE INSERT OR UPDATE ON public.governance_alerts
  FOR EACH ROW
  EXECUTE FUNCTION protect_governance_alert_row();
