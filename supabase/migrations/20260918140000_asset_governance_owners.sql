-- Governance ownership: three role owners per AI asset (distinct from org_members.role).
-- Profile contact fields for accountability people (app-only contact; dossier omits email/phone).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS work_phone text;

COMMENT ON COLUMN public.profiles.department IS 'Person department / team for governance accountability.';
COMMENT ON COLUMN public.profiles.work_phone IS 'Work contact number; shown in-app only, omitted from dossier exports.';
COMMENT ON COLUMN public.profiles.job_title IS 'Job title for governance accountability profiles.';

ALTER TABLE public.ai_systems
  ADD COLUMN IF NOT EXISTS business_owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS compliance_owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS technical_owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ai_systems_business_owner_id_idx ON public.ai_systems (business_owner_id);
CREATE INDEX IF NOT EXISTS ai_systems_compliance_owner_id_idx ON public.ai_systems (compliance_owner_id);
CREATE INDEX IF NOT EXISTS ai_systems_technical_owner_id_idx ON public.ai_systems (technical_owner_id);

COMMENT ON COLUMN public.ai_systems.business_owner_id IS 'Business owner: use case, deployment, value, downstream impact.';
COMMENT ON COLUMN public.ai_systems.compliance_owner_id IS 'Compliance/risk owner: regulatory alignment, privacy, ethics, documentation.';
COMMENT ON COLUMN public.ai_systems.technical_owner_id IS 'Technical/model owner: architecture, performance, bias monitoring, mitigation.';
COMMENT ON COLUMN public.ai_systems.system_owner IS 'Legacy display name; kept in sync with business owner full_name when business_owner_id is set.';

-- Backfill business_owner_id from legacy free-text system_owner where a unique org member name matches.
UPDATE public.ai_systems a
SET business_owner_id = matched.profile_id
FROM (
  SELECT asset_id, profile_id
  FROM (
    SELECT
      a2.id AS asset_id,
      p.id AS profile_id,
      count(*) OVER (PARTITION BY a2.id) AS match_count
    FROM public.ai_systems a2
    JOIN public.profiles p
      ON p.org_id = a2.org_id
     AND lower(trim(coalesce(p.full_name, ''))) = lower(trim(coalesce(a2.system_owner, '')))
    WHERE a2.deleted_at IS NULL
      AND a2.business_owner_id IS NULL
      AND nullif(trim(coalesce(a2.system_owner, '')), '') IS NOT NULL
  ) ranked
  WHERE match_count = 1
) matched
WHERE a.id = matched.asset_id;
