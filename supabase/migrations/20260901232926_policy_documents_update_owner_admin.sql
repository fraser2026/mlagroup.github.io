REVOKE ALL ON TABLE public.policy_documents FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.policy_documents TO authenticated;
REVOKE DELETE, TRUNCATE ON TABLE public.policy_documents FROM authenticated;

DROP POLICY IF EXISTS "policy_docs_update" ON public.policy_documents;
CREATE POLICY policy_docs_update
  ON public.policy_documents
  FOR UPDATE
  TO authenticated
  USING (has_org_role(org_id, ARRAY['owner'::text, 'admin'::text]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner'::text, 'admin'::text]));
