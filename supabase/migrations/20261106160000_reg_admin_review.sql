-- Phase 1b: review and edit the requirement registry from Control Centre.
-- reg stays unexposed; MLA admins work through these functions, which check is_mla_admin().
-- Every edit and review decision is written to reg.review_log (who, when, what changed, why).

alter table reg.requirements add column if not exists review_note text null;

create table if not exists reg.review_log (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references reg.requirements (id) on delete cascade,
  action text not null check (action in ('approve', 'return_to_draft', 'retire', 'edit')),
  changes jsonb not null default '{}'::jsonb,
  note text null,
  actor uuid null,
  created_at timestamptz not null default now()
);

create index if not exists review_log_requirement_idx on reg.review_log (requirement_id, created_at desc);

alter table reg.review_log enable row level security;
grant select on reg.review_log to service_role;

comment on table reg.review_log is
  'Review and edit history for requirements. The record that the methodology is governed.';

-- ---------------------------------------------------------------- list (all states)

create or replace function public.reg_admin_requirements()
returns table (
  key text,
  parent_key text,
  kind text,
  citation text,
  short_citation text,
  title text,
  summary text,
  evidence_expected text,
  applies_to text[],
  jurisdictions text[],
  risk_tiers text[],
  penalty text,
  effective_from date,
  effective_to date,
  status text,
  superseded_by_key text,
  official_url text,
  review_state text,
  review_note text,
  reviewed_at timestamptz,
  source_key text,
  source_title text,
  source_url text,
  source_licence text,
  source_redistributable boolean,
  captured_text text,
  captured_hash text,
  captured_url text,
  captured_at timestamptz,
  obligations jsonb,
  controls jsonb,
  citations jsonb,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_mla_admin() then
    raise exception 'Only MLA admins can read the requirement registry';
  end if;

  return query
  select r.key, p.key, r.kind, r.citation, r.short_citation, r.title, r.summary, r.evidence_expected,
         r.applies_to, r.jurisdictions, r.risk_tiers, r.penalty, r.effective_from, r.effective_to,
         case
           when r.effective_to is not null and r.effective_to < current_date then 'repealed'
           when r.effective_from is not null and r.effective_from > current_date then 'pending'
           else 'in_force'
         end,
         sb.key, r.official_url, r.review_state, r.review_note, r.reviewed_at,
         s.key, s.title, s.url, s.licence, s.redistributable,
         r.captured_text, r.captured_hash, r.captured_url, r.captured_at,
         coalesce((
           select jsonb_agg(jsonb_build_object('key', f.obligation_key, 'framework', f.framework, 'title', f.obligation_title, 'active', f.is_active)
                            order by f.framework, f.display_order)
           from public.compliance_frameworks f
           where f.requirement_id = r.id
         ), '[]'::jsonb),
         coalesce((
           select jsonb_agg(distinct jsonb_build_object('number', g.control_number, 'title', g.title, 'primary', m.is_primary))
           from public.control_requirement_map m
           join public.governance_controls g on g.id = m.control_id
           where m.requirement_id = r.id and m.is_active is distinct from false
         ), '[]'::jsonb),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'type', c.target_type,
                    'key', c.target_key,
                    'primary', c.is_primary,
                    'label', case c.target_type
                      when 'assessment_section' then (select a.title from public.assessment_sections a where a.section_key = c.target_key)
                      when 'diagnostic_reg' then (select d.regime || ' ' || d.article from public.diagnostic_regs d where d.id::text = c.target_key)
                      else c.target_key
                    end)
                  order by c.target_type, c.target_key)
           from public.requirement_citations c
           where c.requirement_id = r.id
         ), '[]'::jsonb),
         r.updated_at
  from reg.requirements r
  join reg.sources s on s.id = r.source_id
  left join reg.requirements p on p.id = r.parent_id
  left join reg.requirements sb on sb.id = r.superseded_by
  order by s.display_order, r.display_order, r.key;
end;
$$;

-- ---------------------------------------------------------------- edit

create or replace function public.reg_admin_save_requirement(
  p_key text,
  p_patch jsonb,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old reg.requirements;
  v_new reg.requirements;
  v_changes jsonb := '{}'::jsonb;
  v_field text;
  v_allowed text[] := array['title', 'citation', 'short_citation', 'summary', 'evidence_expected',
                            'penalty', 'effective_from', 'effective_to', 'official_url'];
begin
  if not public.is_mla_admin() then
    raise exception 'Only MLA admins can edit requirements';
  end if;

  select * into v_old from reg.requirements where key = p_key for update;
  if not found then
    raise exception 'Requirement % not found', p_key;
  end if;

  for v_field in select jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) loop
    if not v_field = any (v_allowed) then
      raise exception 'Field % cannot be edited here', v_field;
    end if;
  end loop;

  if (p_patch ? 'title' and nullif(trim(p_patch ->> 'title'), '') is null)
     or (p_patch ? 'citation' and nullif(trim(p_patch ->> 'citation'), '') is null)
     or (p_patch ? 'short_citation' and nullif(trim(p_patch ->> 'short_citation'), '') is null)
     or (p_patch ? 'summary' and nullif(trim(p_patch ->> 'summary'), '') is null) then
    raise exception 'Title, citation, short citation and summary cannot be empty';
  end if;

  update reg.requirements r
  set title = case when p_patch ? 'title' then trim(p_patch ->> 'title') else r.title end,
      citation = case when p_patch ? 'citation' then trim(p_patch ->> 'citation') else r.citation end,
      short_citation = case when p_patch ? 'short_citation' then trim(p_patch ->> 'short_citation') else r.short_citation end,
      summary = case when p_patch ? 'summary' then trim(p_patch ->> 'summary') else r.summary end,
      evidence_expected = case when p_patch ? 'evidence_expected' then nullif(trim(p_patch ->> 'evidence_expected'), '') else r.evidence_expected end,
      penalty = case when p_patch ? 'penalty' then nullif(trim(p_patch ->> 'penalty'), '') else r.penalty end,
      effective_from = case when p_patch ? 'effective_from' then nullif(p_patch ->> 'effective_from', '')::date else r.effective_from end,
      effective_to = case when p_patch ? 'effective_to' then nullif(p_patch ->> 'effective_to', '')::date else r.effective_to end,
      official_url = case when p_patch ? 'official_url' then nullif(trim(p_patch ->> 'official_url'), '') else r.official_url end,
      updated_at = now()
  where r.id = v_old.id
  returning * into v_new;

  foreach v_field in array v_allowed loop
    if to_jsonb(v_old) -> v_field is distinct from to_jsonb(v_new) -> v_field then
      v_changes := v_changes || jsonb_build_object(v_field, jsonb_build_object('from', to_jsonb(v_old) -> v_field, 'to', to_jsonb(v_new) -> v_field));
    end if;
  end loop;

  if v_changes <> '{}'::jsonb then
    insert into reg.review_log (requirement_id, action, changes, note, actor)
    values (v_old.id, 'edit', v_changes, nullif(trim(coalesce(p_note, '')), ''), auth.uid());
  end if;
end;
$$;

-- ---------------------------------------------------------------- review decision

create or replace function public.reg_admin_set_review_state(
  p_key text,
  p_state text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old reg.requirements;
  v_action text;
begin
  if not public.is_mla_admin() then
    raise exception 'Only MLA admins can review requirements';
  end if;

  if p_state not in ('draft', 'approved', 'retired') then
    raise exception 'Unknown review state %', p_state;
  end if;

  select * into v_old from reg.requirements where key = p_key for update;
  if not found then
    raise exception 'Requirement % not found', p_key;
  end if;

  if v_old.review_state = p_state then
    return;
  end if;

  v_action := case p_state when 'approved' then 'approve' when 'retired' then 'retire' else 'return_to_draft' end;

  update reg.requirements
  set review_state = p_state,
      review_note = nullif(trim(coalesce(p_note, '')), ''),
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  where id = v_old.id;

  insert into reg.review_log (requirement_id, action, changes, note, actor)
  values (v_old.id, v_action,
          jsonb_build_object('review_state', jsonb_build_object('from', v_old.review_state, 'to', p_state)),
          nullif(trim(coalesce(p_note, '')), ''), auth.uid());
end;
$$;

-- ---------------------------------------------------------------- history

create or replace function public.reg_admin_review_log(p_key text)
returns table (
  action text,
  changes jsonb,
  note text,
  actor_name text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_mla_admin() then
    raise exception 'Only MLA admins can read review history';
  end if;

  return query
  select l.action, l.changes, l.note,
         coalesce(nullif(trim(pr.full_name), ''), pr.email, 'MLA admin'),
         l.created_at
  from reg.review_log l
  join reg.requirements r on r.id = l.requirement_id
  left join public.profiles pr on pr.id = l.actor
  where r.key = p_key
  order by l.created_at desc;
end;
$$;

-- Remaining diagnostic priority flags (1a linked pf_governance, pf_oversight, pf_no_policy).
insert into public.requirement_citations (requirement_id, target_type, target_key, is_primary, display_order)
select r.id, 'diagnostic_flag', l.flag, l.is_primary, l.ord
from (values
  ('pf_dpia', 'uk_gdpr:art35', true, 10),
  ('pf_transparency', 'uk_gdpr:art13-14', true, 10),
  ('pf_no_inventory', 'eu_ai_act:art9', true, 10)
) as l (flag, requirement_key, is_primary, ord)
join reg.requirements r on r.key = l.requirement_key
on conflict (requirement_id, target_type, target_key) do nothing;

revoke all on function public.reg_admin_requirements() from public;
revoke all on function public.reg_admin_save_requirement(text, jsonb, text) from public;
revoke all on function public.reg_admin_set_review_state(text, text, text) from public;
revoke all on function public.reg_admin_review_log(text) from public;
grant execute on function public.reg_admin_requirements() to authenticated;
grant execute on function public.reg_admin_save_requirement(text, jsonb, text) to authenticated;
grant execute on function public.reg_admin_set_review_state(text, text, text) to authenticated;
grant execute on function public.reg_admin_review_log(text) to authenticated;
