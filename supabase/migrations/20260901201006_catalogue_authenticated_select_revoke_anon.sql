-- Already applied live. Catalogue is a shared library (no org_id). Authenticated SELECT only. No anon. No client writes on controls/tasks.
REVOKE ALL ON TABLE public.governance_controls FROM anon;
REVOKE ALL ON TABLE public.control_tasks FROM anon;
REVOKE ALL ON TABLE public.policy_templates FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.governance_controls FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.control_tasks FROM authenticated;

GRANT SELECT ON TABLE public.governance_controls TO authenticated;
GRANT SELECT ON TABLE public.control_tasks TO authenticated;
GRANT SELECT ON TABLE public.policy_templates TO authenticated;

DROP POLICY IF EXISTS "policy_templates_select" ON public.policy_templates;
CREATE POLICY "policy_templates_select"
  ON public.policy_templates
  FOR SELECT
  TO authenticated
  USING (true);
