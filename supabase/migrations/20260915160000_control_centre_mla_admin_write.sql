-- Control Centre: allow MLA admins to maintain methodology catalogues.
-- Customer roles remain read-only via existing select policies.

create or replace function public.is_mla_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'mla_admin'
  );
$$;

revoke all on function public.is_mla_admin() from public;
grant execute on function public.is_mla_admin() to authenticated;

drop policy if exists controls_mla_admin_write on public.governance_controls;
create policy controls_mla_admin_write
  on public.governance_controls
  for all
  to authenticated
  using (public.is_mla_admin())
  with check (public.is_mla_admin());

drop policy if exists frameworks_mla_admin_write on public.compliance_frameworks;
create policy frameworks_mla_admin_write
  on public.compliance_frameworks
  for all
  to authenticated
  using (public.is_mla_admin())
  with check (public.is_mla_admin());

-- Table privileges required in addition to RLS (RLS alone is not enough).
grant select, insert, update, delete on public.governance_controls to authenticated;
grant select, insert, update, delete on public.compliance_frameworks to authenticated;