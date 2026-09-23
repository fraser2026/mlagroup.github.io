-- Phase 1.5: control ↔ obligation map for dossier governance basis.
-- requirement_id / source_citation / interpretation_note reserved for three-tier room.

create table if not exists public.control_requirement_map (
  id uuid primary key default gen_random_uuid(),
  control_id uuid not null references public.governance_controls (id) on delete cascade,
  obligation_id uuid not null references public.compliance_frameworks (id) on delete cascade,
  requirement_id uuid null,
  is_primary boolean not null default false,
  source_citation text null,
  interpretation_note text null,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint control_requirement_map_unique unique (control_id, obligation_id)
);

create index if not exists control_requirement_map_control_idx
  on public.control_requirement_map (control_id)
  where is_active;

create index if not exists control_requirement_map_obligation_idx
  on public.control_requirement_map (obligation_id)
  where is_active;

comment on table public.control_requirement_map is
  'MLA methodology join: governance control → compliance_frameworks obligation (article).';
comment on column public.control_requirement_map.requirement_id is
  'Reserved for future Requirement Registry row; nullable until three-tier split.';
comment on column public.control_requirement_map.is_primary is
  'Primary governance basis for dossier display when multiple obligations map to one control.';

alter table public.control_requirement_map enable row level security;

drop policy if exists crm_select on public.control_requirement_map;
create policy crm_select
  on public.control_requirement_map
  for select
  to authenticated
  using (true);

drop policy if exists crm_mla_admin_write on public.control_requirement_map;
create policy crm_mla_admin_write
  on public.control_requirement_map
  for all
  to authenticated
  using (public.is_mla_admin())
  with check (public.is_mla_admin());

grant select, insert, update, delete on public.control_requirement_map to authenticated;

-- Starter maps inferred from assessment section regs + control trigger_rules.
-- Editable in Control Centre; not a legal determination.
insert into public.control_requirement_map (
  control_id, obligation_id, is_primary, interpretation_note, display_order, is_active
)
select c.id, o.id, v.is_primary, v.note, v.ord, true
from (values
  (1, 'euaia_art17', true,  'Organisation AI policy as quality-management posture.', 10),
  (1, 'euaia_art9',  false, 'Policy anchors the risk-management operating model.', 20),
  (2, 'euaia_art26', true,  'Deployer inventory of AI systems in use.', 10),
  (3, 'euaia_art26', true,  'Third-party and deployer supply-chain obligations.', 10),
  (4, 'euaia_art9',  true,  'Risk classification feeds the risk-management system.', 10),
  (4, 'euaia_art27', false, 'Classification path for fundamental-rights impact assessment.', 20),
  (5, 'euaia_art14', true,  'Human oversight measures for AI-supported decisions.', 10),
  (5, 'ukgdpr_art22', false, 'Automated decision-making safeguards where personal data applies.', 20),
  (6, 'euaia_art13', true,  'Transparency and information to users / operators.', 10),
  (6, 'euaia_art50_1', false, 'Disclose AI interaction to natural persons.', 20),
  (7, 'euaia_art10', true,  'Data and data-governance requirements for AI systems.', 10),
  (7, 'ukgdpr_art5', false, 'Data processing principles for personal data used by AI.', 20),
  (7, 'ukgdpr_art35', false, 'DPIA where high-risk personal-data processing applies.', 30),
  (8, 'euaia_art15', true,  'Ongoing accuracy and performance monitoring.', 10),
  (8, 'fca_ss1_23', false, 'Model risk management expectations (where in scope).', 20),
  (9, 'euaia_art15', true,  'Robustness and cybersecurity testing.', 10),
  (10, 'euaia_art15', true, 'Incident handling supports robustness obligations.', 10),
  (10, 'euaia_art26', false, 'Deployer response and escalation duties.', 20),
  (11, 'euaia_art11', true, 'Technical documentation and records.', 10),
  (12, 'euaia_art12', true, 'Record-keeping and logging / traceability.', 10)
) as v(control_number, obligation_key, is_primary, note, ord)
join public.governance_controls c on c.control_number = v.control_number
join public.compliance_frameworks o on o.obligation_key = v.obligation_key
on conflict (control_id, obligation_id) do update set
  is_primary = excluded.is_primary,
  interpretation_note = excluded.interpretation_note,
  display_order = excluded.display_order,
  is_active = true,
  updated_at = now();
