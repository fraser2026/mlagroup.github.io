-- Phase 2a: Diagnostic scoring engine (separate from methodology catalogue).
-- Questions, REGS prose, and priority-flag copy stay in HTML until later slices.
-- Public read: free diagnostic.html must load weights without auth.

create table if not exists public.diagnostic_section_weights (
  section_key text primary key,
  label text not null,
  weight numeric(6,4) not null check (weight >= 0 and weight <= 1),
  display_order integer not null default 0,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.diagnostic_sector_multipliers (
  sector text primary key,
  multiplier numeric(6,4) not null check (multiplier > 0 and multiplier <= 2),
  display_order integer not null default 0,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

comment on table public.diagnostic_section_weights is
  'Diagnostic engine: section contribution weights (sum should be ~1). Not methodology catalogue.';
comment on table public.diagnostic_sector_multipliers is
  'Diagnostic engine: sector calibration multipliers applied after weighted score.';

alter table public.diagnostic_section_weights enable row level security;
alter table public.diagnostic_sector_multipliers enable row level security;

drop policy if exists dsw_select on public.diagnostic_section_weights;
create policy dsw_select
  on public.diagnostic_section_weights
  for select
  to anon, authenticated
  using (true);

drop policy if exists dsw_mla_admin_write on public.diagnostic_section_weights;
create policy dsw_mla_admin_write
  on public.diagnostic_section_weights
  for all
  to authenticated
  using (public.is_mla_admin())
  with check (public.is_mla_admin());

drop policy if exists dsm_select on public.diagnostic_sector_multipliers;
create policy dsm_select
  on public.diagnostic_sector_multipliers
  for select
  to anon, authenticated
  using (true);

drop policy if exists dsm_mla_admin_write on public.diagnostic_sector_multipliers;
create policy dsm_mla_admin_write
  on public.diagnostic_sector_multipliers
  for all
  to authenticated
  using (public.is_mla_admin())
  with check (public.is_mla_admin());

grant select on public.diagnostic_section_weights to anon, authenticated;
grant select, insert, update, delete on public.diagnostic_section_weights to authenticated;
grant select on public.diagnostic_sector_multipliers to anon, authenticated;
grant select, insert, update, delete on public.diagnostic_sector_multipliers to authenticated;

insert into public.diagnostic_section_weights (section_key, label, weight, display_order) values
  ('s1', 'AI Inventory & Classification', 0.14, 10),
  ('s2', 'Governance & Accountability', 0.20, 20),
  ('s3', 'Data Governance', 0.10, 30),
  ('s4', 'Human Oversight & Controls', 0.16, 40),
  ('s5', 'Transparency & Explainability', 0.16, 50),
  ('s6', 'Compliance & Legal Alignment', 0.18, 60),
  ('s7', 'Operational Resilience', 0.06, 70)
on conflict (section_key) do update set
  label = excluded.label,
  weight = excluded.weight,
  display_order = excluded.display_order,
  is_active = true,
  updated_at = now();

insert into public.diagnostic_sector_multipliers (sector, multiplier, display_order) values
  ('Financial Services', 1.00, 10),
  ('Healthcare & Life Sciences', 1.00, 20),
  ('Public Sector / Government', 0.95, 30),
  ('Legal & Professional Services', 0.92, 40),
  ('Technology & SaaS', 0.88, 50),
  ('Retail & E-commerce', 0.85, 60),
  ('Education', 0.82, 70),
  ('Manufacturing & Logistics', 0.80, 80),
  ('Other', 0.90, 90)
on conflict (sector) do update set
  multiplier = excluded.multiplier,
  display_order = excluded.display_order,
  is_active = true,
  updated_at = now();
