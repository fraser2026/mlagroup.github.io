-- Phase 2b: Diagnostic report REGS rows (engine display copy).
-- Separate from methodology compliance_frameworks / control_requirement_map.

create table if not exists public.diagnostic_regs (
  id uuid primary key default gen_random_uuid(),
  regime text not null,
  article text not null,
  obligation text not null,
  requirement_type text not null check (requirement_type in ('M', 'A')),
  penalty text null,
  deadline text null,
  display_order integer not null default 0,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

create index if not exists diagnostic_regs_order_idx
  on public.diagnostic_regs (display_order)
  where is_active;

comment on table public.diagnostic_regs is
  'Diagnostic PDF regulatory overview rows. Not the methodology catalogue.';

alter table public.diagnostic_regs enable row level security;

drop policy if exists dr_select on public.diagnostic_regs;
create policy dr_select
  on public.diagnostic_regs
  for select
  to anon, authenticated
  using (true);

drop policy if exists dr_mla_admin_write on public.diagnostic_regs;
create policy dr_mla_admin_write
  on public.diagnostic_regs
  for all
  to authenticated
  using (public.is_mla_admin())
  with check (public.is_mla_admin());

grant select on public.diagnostic_regs to anon, authenticated;
grant select, insert, update, delete on public.diagnostic_regs to authenticated;

insert into public.diagnostic_regs (regime, article, obligation, requirement_type, penalty, deadline, display_order)
select v.regime, v.article, v.obligation, v.requirement_type, v.penalty, v.deadline, v.ord
from (values
  ('EU AI Act', 'Art. 6 & Annex III', 'Risk classification and registration of high-risk AI systems', 'M', 'Up to EUR 30M or 6% global turnover', 'Aug 2026', 10),
  ('EU AI Act', 'Art. 14', 'Human oversight measures for high-risk AI systems', 'M', 'Up to EUR 30M or 6% global turnover', 'Aug 2026', 20),
  ('EU AI Act', 'Art. 13 & 12', 'Transparency to deployers and automatic event logging', 'M', 'Up to EUR 15M or 3% global turnover', 'Aug 2026', 30),
  ('EU AI Act', 'Art. 27', 'Fundamental rights impact assessment by deployers', 'M', 'Up to EUR 15M or 3% global turnover', 'Aug 2026', 40),
  ('UK GDPR', 'Art. 35', 'Data Protection Impact Assessment for high-risk AI processing', 'M', 'Up to GBP 17.5M or 4% global turnover', 'Immediate', 50),
  ('UK GDPR', 'Art. 22', 'Safeguards for solely automated decision-making', 'M', 'Up to GBP 17.5M or 4% global turnover', 'Immediate', 60),
  ('UK GDPR', 'Art. 13-14', 'Transparency obligations: inform individuals of AI-assisted decisions', 'M', 'Up to GBP 17.5M or 4% global turnover', 'Immediate', 70),
  ('FCA / SM&CR', 'PS7/21 & PRs', 'Named Senior Manager accountability for AI-driven customer outcomes', 'M', 'Individual sanctions; prohibition from regulated activity', 'Immediate', 80),
  ('ISO/IEC 42001', 'Sections 6-9', 'AI management system: risk assessment, monitoring, and evaluation', 'A', 'Certification benchmark; increasing regulator expectation', 'Ongoing', 90)
) as v(regime, article, obligation, requirement_type, penalty, deadline, ord)
where not exists (select 1 from public.diagnostic_regs limit 1);
