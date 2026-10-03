-- Draft MLA chat thread (and future draft UI state) lives on the policy row.
-- meta.mla_thread = { messages, prompt, updated_at }; cleared only on New / logout.

ALTER TABLE public.policy_documents
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.policy_documents.meta IS
  'Draft UI state. mla_thread: { messages: [{id,role,content}], prompt, updated_at }';
