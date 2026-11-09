-- Phase 2 follow-up: change notices for dossiers and the Reports page.
--
-- public.reg_asset_changes is the change logic without an access check, for the dossier
-- generator (service role). public.asset_regulatory_changes keeps its check and calls it.
-- public.org_regulatory_change_counts gives per-asset counts for the Reports page.
-- Also revokes anon and authenticated execute on internal registry functions.

create or replace function public.reg_asset_changes(p_system_id uuid)
returns table (
  requirement_key text,
  citation text,
  title text,
  change text,
  changed_on date,
  replaces text,
  replaced_by text,
  sections jsonb,
  controls jsonb,
  official_url text,
  assessed_on date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid;
  v_assessment uuid;
  v_since date;
  v_snapshot jsonb;
begin
  select s.org_id into v_org
  from public.ai_systems s
  where s.id = p_system_id and s.deleted_at is null;

  if v_org is null then
    return;
  end if;

  select a.id, a.completed_at::date, v.snapshot
  into v_assessment, v_since, v_snapshot
  from public.registry_assessments a
  left join public.methodology_versions v on v.id = a.methodology_version_id
  where a.system_id = p_system_id and a.completed_at is not null
  order by a.completed_at desc
  limit 1;

  if v_assessment is null then
    return;
  end if;

  if coalesce((v_snapshot->>'version')::int, 1) < 2 then
    v_snapshot := null;
  end if;

  return query
  with cited as (
    select c.requirement_id, c.target_key as section_key, null::uuid as control_id
    from public.requirement_citations c
    join public.assessment_sections sec on sec.section_key = c.target_key and sec.is_active
    where c.target_type = 'assessment_section'
    union
    select f.requirement_id, null, null
    from public.system_compliance sc
    join public.compliance_frameworks f on f.id = sc.obligation_id
    where sc.system_id = p_system_id and f.requirement_id is not null
    union
    select coalesce(m.requirement_id, f.requirement_id), null, ca.control_id
    from public.control_assignments ca
    join public.control_requirement_map m on m.control_id = ca.control_id and m.is_active is distinct from false
    left join public.compliance_frameworks f on f.id = m.obligation_id
    where ca.system_id = p_system_id and coalesce(m.requirement_id, f.requirement_id) is not null
  ),
  reqs as (
    select distinct c.requirement_id from cited c
  ),
  snap as (
    select e->>'key' as key, e->>'citation' as citation, e->>'captured_hash' as captured_hash
    from jsonb_array_elements(coalesce(v_snapshot->'requirements', '[]'::jsonb)) e
  ),
  events as (
    select r.id, 'now_applies'::text as change, r.effective_from as changed_on
    from reg.requirements r join reqs q on q.requirement_id = r.id
    where r.review_state = 'approved'
      and r.effective_from > v_since and r.effective_from <= current_date
    union all
    select r.id, case when r.superseded_by is not null then 'replaced' else 'repealed' end, r.effective_to + 1
    from reg.requirements r join reqs q on q.requirement_id = r.id
    where r.effective_to >= v_since and r.effective_to < current_date
    union all
    select r.id,
           case when sn.key is null then 'added' else 'wording' end,
           coalesce(r.reviewed_at, r.updated_at)::date
    from reg.requirements r
    join reqs q on q.requirement_id = r.id
    left join snap sn on sn.key = r.key
    where v_snapshot is not null
      and r.review_state = 'approved'
      and (r.effective_from is null or r.effective_from <= v_since or r.effective_from > current_date)
      and (sn.key is null
           or sn.citation is distinct from r.citation
           or sn.captured_hash is distinct from r.captured_hash)
  )
  select r.key,
         r.citation,
         r.title,
         ev.change,
         ev.changed_on,
         (select string_agg(o.citation, '; ' order by o.key)
            from reg.requirements o where o.superseded_by = r.id),
         sb.citation,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'key', sec.section_key,
                    'title', sec.title,
                    'answers', (select count(*) from public.assessment_questions aq
                                where aq.section_key = sec.section_key and aq.is_active))
                  order by sec.display_order)
           from public.assessment_sections sec
           where sec.is_active
             and sec.section_key in (select c.section_key from cited c where c.requirement_id = r.id)
         ), '[]'::jsonb),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'control_number', gc.control_number,
                    'reference', gc.reference,
                    'title', gc.title)
                  order by gc.control_number nulls last, gc.title)
           from public.governance_controls gc
           where gc.id in (select c.control_id from cited c where c.requirement_id = r.id)
         ), '[]'::jsonb),
         coalesce(r.official_url, s.url),
         v_since
  from events ev
  join reg.requirements r on r.id = ev.id
  join reg.sources s on s.id = r.source_id
  left join reg.requirements sb on sb.id = r.superseded_by
  order by ev.changed_on desc, s.display_order, r.display_order;
end;
$$;

comment on function public.reg_asset_changes(uuid) is
  'Internal: changes to the requirements behind an asset''s latest completed assessment, its obligations and its controls since that assessment. No access check; service role and the checked wrappers only.';

-- Client wrapper keeps its access check and returns the internal result.
create or replace function public.asset_regulatory_changes(p_system_id uuid)
returns table (
  requirement_key text,
  citation text,
  title text,
  change text,
  changed_on date,
  replaces text,
  replaced_by text,
  sections jsonb,
  controls jsonb,
  official_url text,
  assessed_on date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select s.org_id into v_org
  from public.ai_systems s
  where s.id = p_system_id and s.deleted_at is null;

  if v_org is null or not (public.is_org_member(v_org) or public.is_mla_admin()) then
    raise exception 'Asset not found';
  end if;

  return query select * from public.reg_asset_changes(p_system_id);
end;
$$;

-- Per-asset change counts for an organisation (paragraphs folded into their article).
create or replace function public.org_regulatory_change_counts(p_org_id uuid)
returns table (system_id uuid, changes integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not (public.is_org_member(p_org_id) or public.is_mla_admin()) then
    raise exception 'Organisation not found';
  end if;

  return query
  with x as (
    select s.id as sys, c.requirement_key as k, c.change as ch, c.changed_on as d
    from public.ai_systems s
    cross join lateral public.reg_asset_changes(s.id) c
    where s.org_id = p_org_id and s.deleted_at is null
  )
  select x.sys, count(*)::int
  from x
  where not exists (
    select 1 from x p
    where p.sys = x.sys and p.ch = x.ch and p.d = x.d
      and x.k like p.k || '(%'
  )
  group by x.sys;
end;
$$;

comment on function public.org_regulatory_change_counts(uuid) is
  'Number of regulatory changes since each asset''s latest completed assessment, for the Reports page.';

-- ---------------------------------------------------------------- grants
-- Supabase grants execute on new public functions to anon and authenticated by default,
-- so internal functions are revoked from those roles explicitly.

revoke execute on function public.reg_asset_changes(uuid) from public, anon, authenticated;
revoke execute on function public.reg_sync_citations() from public, anon, authenticated;
revoke execute on function public.reg_compose_basis(text, text) from public, anon, authenticated;
revoke execute on function public.reg_compose_short(text, text) from public, anon, authenticated;
revoke execute on function public.registry_assessments_stamp_baseline() from public, anon, authenticated;
revoke execute on function public.reg_obligation_requirements() from public, anon;
revoke execute on function public.asset_regulatory_changes(uuid) from public, anon;
revoke execute on function public.org_regulatory_horizon(uuid) from public, anon;
revoke execute on function public.org_regulatory_change_counts(uuid) from public, anon;

grant execute on function public.reg_asset_changes(uuid) to service_role;
grant execute on function public.org_regulatory_change_counts(uuid) to authenticated, service_role;
