-- Phase 2: baselines, client change notices and the regulatory horizon.
--
-- 1. Article-level links to the official text for EU AI Act, EU GDPR and DORA requirements
--    (EUR-Lex anchors art_N, anx_III, cpt_V). Logged in reg.review_log.
-- 2. Completed assessments are stamped with the methodology version current at completion.
-- 3. Draft requirement for the Article 5 prohibitions added by the AI Omnibus (points (ba) and
--    (bb)), applying from 2 Dec 2026. Hidden from clients until approved in Control Centre.
-- 4. public.asset_regulatory_changes: what changed in the law, for the requirements an asset's
--    latest assessment, obligations and controls rely on, since that assessment was completed.
-- 5. public.org_regulatory_horizon: approved requirements that apply from a future date and
--    touch the organisation's assets.

-- ---------------------------------------------------------------- 1. article links

with links as (
  select r.id, r.official_url as old_url,
         case s.key
           when 'eu_ai_act' then 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02024R1689-20260727#'
             || case when r.key like 'eu_ai_act:annex3%' then 'anx_III'
                     else 'art_' || substring(r.key from '^eu_ai_act:art([0-9]+a?)') end
           when 'eu_gdpr' then 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679#'
             || case when r.key = 'eu_gdpr:chapter5' then 'cpt_V'
                     else 'art_' || substring(r.key from '^eu_gdpr:art([0-9]+)') end
           when 'eu_dora' then 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32022R2554#'
             || 'art_' || substring(r.key from '^eu_dora:art([0-9]+)')
         end as new_url
  from reg.requirements r
  join reg.sources s on s.id = r.source_id
  where s.key in ('eu_ai_act', 'eu_gdpr', 'eu_dora')
    and r.official_url is null
),
updated as (
  update reg.requirements r
  set official_url = l.new_url, updated_at = now()
  from links l
  where r.id = l.id and l.new_url is not null and l.new_url !~ '#(art_)?$'
  returning r.id, l.old_url, l.new_url
)
insert into reg.review_log (requirement_id, action, changes, note, actor)
select u.id, 'edit',
       jsonb_build_object('official_url', jsonb_build_object('from', u.old_url, 'to', u.new_url)),
       'Article-level link to the official text', null
from updated u;

-- ---------------------------------------------------------------- 2. assessment baselines

alter table public.registry_assessments
  add column if not exists methodology_version_id uuid null references public.methodology_versions (id);

comment on column public.registry_assessments.methodology_version_id is
  'Methodology version (catalogue and requirement registry) current when the assessment was completed. Null for assessments completed before versioning.';

create or replace function public.registry_assessments_stamp_baseline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.completed_at is not null
     and new.methodology_version_id is null
     and (tg_op = 'INSERT' or old.completed_at is null) then
    select v.id into new.methodology_version_id
    from public.methodology_versions v
    where v.is_current
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists registry_assessments_stamp_baseline on public.registry_assessments;
create trigger registry_assessments_stamp_baseline
  before insert or update of completed_at on public.registry_assessments
  for each row execute function public.registry_assessments_stamp_baseline();

update public.registry_assessments a
set methodology_version_id = (
  select v.id from public.methodology_versions v
  where v.published_at <= a.completed_at
  order by v.published_at desc
  limit 1
)
where a.completed_at is not null and a.methodology_version_id is null;

-- ---------------------------------------------------------------- 3. Article 5 omnibus prohibitions (draft)

insert into reg.requirements (
  key, source_id, parent_id, kind, citation, short_citation, title, summary, evidence_expected,
  applies_to, jurisdictions, risk_tiers, penalty, effective_from, official_url, review_state,
  captured_text, captured_hash, captured_url, captured_at, display_order
)
select 'eu_ai_act:art5(1)(ba)-(bb)', p.source_id, p.id, 'obligation',
       'EU AI Act Article 5(1)(ba) and (bb)', 'Art. 5(1)(ba)-(bb)',
       'Prohibited generation of intimate imagery and child sexual abuse material',
       'Bans placing on the market, putting into service or using AI systems that generate or manipulate realistic intimate or sexually explicit images, video or audio of an identifiable person without their explicit consent, or child sexual abuse material. Added by the AI Omnibus.',
       'A screening record per AI system that generates images, video or audio, with the safeguards that prevent this output',
       p.applies_to, p.jurisdictions, p.risk_tiers, p.penalty, date '2026-12-02',
       'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02024R1689-20260727#art_5',
       'draft',
       t.txt, encode(extensions.digest(t.txt, 'sha256'), 'hex'), p.captured_url, p.captured_at, 21
from reg.requirements p
cross join lateral (
  select substring(p.captured_text from '(\(ba\) .*?)\n\(c\) ') as txt
) t
where p.key = 'eu_ai_act:art5' and t.txt is not null
on conflict (key) do nothing;

-- ---------------------------------------------------------------- 4. asset change notice

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

  if v_org is null or not (public.is_org_member(v_org) or public.is_mla_admin()) then
    raise exception 'Asset not found';
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

comment on function public.asset_regulatory_changes(uuid) is
  'Changes to the requirements behind an asset''s latest completed assessment, its obligations and its controls since that assessment: now applies, replaced, repealed, and (against a version 2 baseline) wording updated or newly cited.';

-- ---------------------------------------------------------------- 5. regulatory horizon

create or replace function public.org_regulatory_horizon(p_org_id uuid)
returns table (
  requirement_key text,
  citation text,
  title text,
  summary text,
  applies_to text[],
  effective_from date,
  scope text,
  assets integer,
  official_url text
)
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
  with systems as (
    select s.id from public.ai_systems s
    where s.org_id = p_org_id and s.deleted_at is null
  ),
  touched as (
    select c.requirement_id, a.system_id, 'cited'::text as via
    from public.registry_assessments a
    join systems sy on sy.id = a.system_id
    cross join public.requirement_citations c
    join public.assessment_sections sec on sec.section_key = c.target_key and sec.is_active
    where a.completed_at is not null and c.target_type = 'assessment_section'
    union
    select f.requirement_id, sc.system_id, 'cited'
    from public.system_compliance sc
    join systems sy on sy.id = sc.system_id
    join public.compliance_frameworks f on f.id = sc.obligation_id
    where f.requirement_id is not null
    union
    select coalesce(m.requirement_id, f.requirement_id), ca.system_id, 'cited'
    from public.control_assignments ca
    join systems sy on sy.id = ca.system_id
    join public.control_requirement_map m on m.control_id = ca.control_id and m.is_active is distinct from false
    left join public.compliance_frameworks f on f.id = m.obligation_id
    where coalesce(m.requirement_id, f.requirement_id) is not null
    union
    select r.id, sy.id, 'all_systems'
    from reg.requirements r
    cross join systems sy
    where r.risk_tiers @> array['prohibited']
  ),
  agg as (
    select t.requirement_id,
           count(distinct t.system_id)::int as assets,
           case when bool_or(t.via = 'all_systems') then 'all_systems' else 'cited' end as scope
    from touched t
    group by t.requirement_id
  )
  select r.key, r.citation, r.title, r.summary, r.applies_to, r.effective_from,
         ag.scope, ag.assets, coalesce(r.official_url, s.url)
  from agg ag
  join reg.requirements r on r.id = ag.requirement_id
  join reg.sources s on s.id = r.source_id
  where r.review_state = 'approved'
    and r.effective_from > current_date
    and (r.effective_to is null or r.effective_to > current_date)
  order by r.effective_from, s.display_order, r.display_order;
end;
$$;

comment on function public.org_regulatory_horizon(uuid) is
  'Approved requirements that apply from a future date and touch the organisation''s assets: cited by a completed assessment, an obligation or an assigned control, or a prohibition (which applies to every AI system).';

-- ---------------------------------------------------------------- grants

revoke all on function public.registry_assessments_stamp_baseline() from public;
revoke all on function public.asset_regulatory_changes(uuid) from public;
revoke all on function public.org_regulatory_horizon(uuid) from public;
grant execute on function public.asset_regulatory_changes(uuid) to authenticated, service_role;
grant execute on function public.org_regulatory_horizon(uuid) to authenticated, service_role;
