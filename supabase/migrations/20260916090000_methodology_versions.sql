-- Phase 3: Named methodology publish snapshots (controls + frameworks + maps).
-- Live catalogue tables remain the working copy. Publish freezes a version dossiers can cite.

create table if not exists public.methodology_versions (
  id uuid primary key default gen_random_uuid(),
  version_label text not null,
  note text null,
  catalogue_hash text not null,
  snapshot jsonb not null default '{}'::jsonb,
  is_current boolean not null default false,
  published_by uuid null references auth.users(id) on delete set null,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint methodology_versions_label_nonempty check (length(trim(version_label)) > 0),
  constraint methodology_versions_hash_nonempty check (length(trim(catalogue_hash)) > 0)
);

create unique index if not exists methodology_versions_one_current_idx
  on public.methodology_versions ((is_current))
  where is_current;

create index if not exists methodology_versions_published_at_idx
  on public.methodology_versions (published_at desc);

comment on table public.methodology_versions is
  'Published methodology catalogue snapshots. Working copy stays in governance_controls / compliance_frameworks / control_requirement_map.';

alter table public.methodology_versions enable row level security;

drop policy if exists mv_select on public.methodology_versions;
create policy mv_select
  on public.methodology_versions
  for select
  to authenticated
  using (true);

drop policy if exists mv_mla_admin_write on public.methodology_versions;
create policy mv_mla_admin_write
  on public.methodology_versions
  for all
  to authenticated
  using (public.is_mla_admin())
  with check (public.is_mla_admin());

grant select on public.methodology_versions to authenticated;
grant select, insert, update, delete on public.methodology_versions to authenticated;

-- Atomically publish: clear current, insert new current row.
create or replace function public.publish_methodology_version(
  p_version_label text,
  p_note text default null
)
returns public.methodology_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_controls jsonb;
  v_frameworks jsonb;
  v_maps jsonb;
  v_snapshot jsonb;
  v_hash text;
  v_row public.methodology_versions;
begin
  if not public.is_mla_admin() then
    raise exception 'Only MLA admins can publish methodology versions';
  end if;

  if p_version_label is null or length(trim(p_version_label)) = 0 then
    raise exception 'version_label is required';
  end if;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.control_number nulls last, c.id), '[]'::jsonb)
  into v_controls
  from public.governance_controls c;

  select coalesce(jsonb_agg(to_jsonb(f) order by f.framework, f.display_order, f.id), '[]'::jsonb)
  into v_frameworks
  from public.compliance_frameworks f;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.display_order, m.id), '[]'::jsonb)
  into v_maps
  from public.control_requirement_map m
  where m.is_active is distinct from false;

  v_snapshot := jsonb_build_object(
    'version', 1,
    'controls', v_controls,
    'frameworks', v_frameworks,
    'maps', v_maps
  );

  v_hash := substr(encode(extensions.digest(v_snapshot::text, 'sha256'), 'hex'), 1, 16);

  update public.methodology_versions
  set is_current = false
  where is_current;

  insert into public.methodology_versions (
    version_label,
    note,
    catalogue_hash,
    snapshot,
    is_current,
    published_by,
    published_at
  )
  values (
    trim(p_version_label),
    nullif(trim(coalesce(p_note, '')), ''),
    v_hash,
    v_snapshot,
    true,
    auth.uid(),
    now()
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.publish_methodology_version(text, text) from public;
grant execute on function public.publish_methodology_version(text, text) to authenticated;

comment on function public.publish_methodology_version(text, text) is
  'Freeze live methodology catalogue into a named published version and mark it current.';
