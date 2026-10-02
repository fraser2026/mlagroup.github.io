-- Already applied live. Clients may SELECT their own generated-report audit rows. No client INSERT/UPDATE/DELETE.
ALTER TABLE public.report_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS report_audit_select ON public.report_audit_log;
CREATE POLICY report_audit_select
  ON public.report_audit_log
  FOR SELECT
  TO authenticated
  USING (
    (EXISTS (
      SELECT 1 FROM entitlements e
      WHERE e.diagnostic_id = report_audit_log.response_id
        AND e.user_id = auth.uid()
        AND e.product = 'premium_report'
        AND e.status = 'active'
    ))
    OR (EXISTS (
      SELECT 1 FROM diagnostic_results d
      WHERE d.id = report_audit_log.response_id
        AND d.user_id = auth.uid()
    ))
    OR is_mla_admin()
  );

REVOKE ALL ON TABLE public.report_audit_log FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.report_audit_log FROM authenticated;
GRANT SELECT ON TABLE public.report_audit_log TO authenticated;
