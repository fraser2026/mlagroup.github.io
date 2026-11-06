-- Phase 1c: citations across RegAnchor come from the requirement registry.
-- The registry stays the single place a citation, penalty or date is edited. RegAnchor keeps its
-- own display copies (obligation article references, diagnostic rows, assessment section bases)
-- and public.reg_sync_citations() derives them from approved requirements. It runs after every
-- registry edit or review decision, daily (so pending dates roll into force), and once here.
-- Dossiers and published methodology versions read the registry directly.

alter table reg.sources add column if not exists short_title text null;

comment on column reg.sources.short_title is
  'Short name used when composing citations, e.g. "EU AI Act", "UK GDPR", "FCA".';

update reg.sources s
set short_title = v.short_title
from (values
  ('eu_ai_act', 'EU AI Act'),
  ('eu_ai_omnibus', 'AI Omnibus'),
  ('eu_gdpr', 'EU GDPR'),
  ('eu_dora', 'DORA'),
  ('uk_gdpr', 'UK GDPR'),
  ('uk_duaa_2025', 'DUAA 2025'),
  ('uk_si_2026_82', 'SI 2026/82'),
  ('uk_dpa_2018', 'DPA 2018'),
  ('uk_fsma_2000', 'FSMA 2000'),
  ('fca_handbook', 'FCA'),
  ('fca_ai_approach', 'FCA'),
  ('fca_ai_good_practice', 'FCA'),
  ('fca_fg21_1', 'FCA'),
  ('pra_ss1_23', 'PRA'),
  ('ico_accountability', 'ICO'),
  ('iso_42001', 'ISO/IEC 42001')
) as v (key, short_title)
where s.key = v.key;

-- ---------------------------------------------------------------- composition

-- Long form for section bases, grouped by source, with role qualifiers where a duty is one-sided:
-- "EU AI Act Articles 9, 11 and 17 (providers) and Article 26 (deployers); FCA SM&CR"
create or replace function public.reg_compose_basis(p_target_type text, p_target_key text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with items as (
    select s.key as src,
           coalesce(s.short_title, s.title) as label,
           min(c.display_order) over (partition by s.key) as src_order,
           c.display_order as ord,
           r.short_citation as sc,
           case
             when r.applies_to = array['provider']::text[] then 'providers'
             when r.applies_to = array['deployer']::text[] then 'deployers'
             when r.applies_to = array['eu_financial_entity']::text[] then 'EU financial entities'
           end as role,
           r.short_citation ~ '^Arts?\. ' as is_art,
           r.short_citation ~ '^Arts\. ' as plural,
           replace(regexp_replace(r.short_citation, '^Arts?\. ', ''), ' & ', ' and ') as num
    from public.requirement_citations c
    join reg.requirements r on r.id = c.requirement_id and r.review_state = 'approved'
    join reg.sources s on s.id = r.source_id
    where c.target_type = p_target_type
      and c.target_key = p_target_key
  ),
  grouped as (
    select src, label, src_order, role, is_art,
           min(ord) as g_order,
           array_agg(num order by ord) as nums,
           bool_or(plural) as plural,
           array_agg(case when sc like label || '%' then sc else label || ' ' || sc end order by ord) as phrases
    from items
    group by src, label, src_order, role, is_art
  ),
  rendered as (
    select src, label, src_order, is_art, g_order,
           case
             when is_art and cardinality(nums) = 1 then
               case when plural then 'Articles ' else 'Article ' end || nums[1]
             when is_art then
               'Articles ' || array_to_string(nums[1:cardinality(nums) - 1], ', ') || ' and ' || nums[cardinality(nums)]
             else array_to_string(phrases, ', ')
           end || coalesce(' (' || role || ')', '') as txt
    from grouped
  ),
  per_source as (
    select src, src_order,
           concat_ws(', ',
             label || ' ' || string_agg(txt, ' and ' order by g_order) filter (where is_art),
             string_agg(txt, ', ' order by g_order) filter (where not is_art)) as txt
    from rendered
    group by src, label, src_order
  )
  select string_agg(txt, '; ' order by src_order, src)
  from per_source;
$$;

-- Short form for diagnostic rows, primary first: "Art. 13 & 12", "Arts. 22A to 22D", "SM&CR".
create or replace function public.reg_compose_short(p_target_type text, p_target_key text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with items as (
    select r.short_citation as sc,
           row_number() over (order by c.is_primary desc, c.display_order, r.key) as n
    from public.requirement_citations c
    join reg.requirements r on r.id = c.requirement_id and r.review_state = 'approved'
    where c.target_type = p_target_type
      and c.target_key = p_target_key
  )
  select string_agg(
           case
             when i.n > 1 and i.sc ~ '^Art\. ' and f.sc ~ '^Arts?\. ' then regexp_replace(i.sc, '^Art\. ', '')
             else i.sc
           end, ' & ' order by i.n)
  from items i
  cross join (select sc from items where n = 1) f;
$$;

-- ---------------------------------------------------------------- sync

create or replace function public.reg_sync_citations()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_obligations integer := 0;
  v_diagnostic integer := 0;
  v_sections integer := 0;
begin
  -- Obligations: the citation without the framework name, which every reader shows alongside.
  with derived as (
    select f.id,
           case
             when s.short_title is not null and r.citation like s.short_title || ' %'
               then substr(r.citation, length(s.short_title) + 2)
             else r.citation
           end as ref
    from public.compliance_frameworks f
    join reg.requirements r on r.id = f.requirement_id and r.review_state = 'approved'
    join reg.sources s on s.id = r.source_id
  )
  update public.compliance_frameworks f
  set article_reference = d.ref
  from derived d
  where f.id = d.id
    and f.article_reference is distinct from d.ref;
  get diagnostics v_obligations = row_count;

  -- Diagnostic regulatory table: regime, article, penalty and deadline from the primary requirement.
  with prim as (
    select distinct on (c.target_key)
           c.target_key, r.kind, r.effective_from, r.penalty, coalesce(s.short_title, s.title) as regime
    from public.requirement_citations c
    join reg.requirements r on r.id = c.requirement_id and r.review_state = 'approved'
    join reg.sources s on s.id = r.source_id
    where c.target_type = 'diagnostic_reg'
    order by c.target_key, c.is_primary desc, c.display_order
  ),
  derived as (
    select d.id,
           p.regime,
           public.reg_compose_short('diagnostic_reg', d.id::text) as article,
           coalesce(p.penalty, d.penalty) as penalty,
           case
             when p.kind = 'benchmark' then 'Ongoing'
             when p.effective_from > current_date then to_char(p.effective_from, 'FMDD Mon YYYY')
             else 'Immediate'
           end as deadline
    from public.diagnostic_regs d
    join prim p on p.target_key = d.id::text
  )
  update public.diagnostic_regs d
  set regime = x.regime,
      article = x.article,
      penalty = x.penalty,
      deadline = x.deadline,
      updated_at = now()
  from derived x
  where d.id = x.id
    and x.article is not null
    and (d.regime, d.article, d.penalty, d.deadline) is distinct from (x.regime, x.article, x.penalty, x.deadline);
  get diagnostics v_diagnostic = row_count;

  -- Assessment section bases.
  with derived as (
    select a.section_key, public.reg_compose_basis('assessment_section', a.section_key) as basis
    from public.assessment_sections a
  )
  update public.assessment_sections a
  set regulatory_basis = x.basis,
      updated_at = now()
  from derived x
  where a.section_key = x.section_key
    and x.basis is not null
    and a.regulatory_basis is distinct from x.basis;
  get diagnostics v_sections = row_count;

  return jsonb_build_object('obligations', v_obligations, 'diagnostic_regs', v_diagnostic, 'assessment_sections', v_sections);
end;
$$;

comment on function public.reg_sync_citations() is
  'Derive RegAnchor citation copies from approved registry requirements. Safe to run any time.';

-- ---------------------------------------------------------------- dossier read

create or replace function public.reg_obligation_requirements()
returns table (
  obligation_id uuid,
  requirement_key text,
  citation text,
  short_citation text,
  title text,
  status text,
  effective_from date,
  effective_to date,
  official_url text,
  source_title text,
  captured_hash text
)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, r.key, r.citation, r.short_citation, r.title,
         case
           when r.effective_to is not null and r.effective_to < current_date then 'repealed'
           when r.effective_from is not null and r.effective_from > current_date then 'pending'
           else 'in_force'
         end,
         r.effective_from, r.effective_to,
         coalesce(r.official_url, s.url),
         s.title,
         r.captured_hash
  from public.compliance_frameworks f
  join reg.requirements r on r.id = f.requirement_id and r.review_state = 'approved'
  join reg.sources s on s.id = r.source_id
  order by f.framework, f.display_order;
$$;

-- ---------------------------------------------------------------- admin RPCs now sync

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
    perform public.reg_sync_citations();
  end if;
end;
$$;

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

  perform public.reg_sync_citations();
end;
$$;

-- ---------------------------------------------------------------- methodology snapshot v2

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
  v_requirements jsonb;
  v_citations jsonb;
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

  select coalesce(jsonb_agg(jsonb_build_object(
           'key', r.key,
           'source', s.key,
           'kind', r.kind,
           'citation', r.citation,
           'short_citation', r.short_citation,
           'title', r.title,
           'summary', r.summary,
           'applies_to', r.applies_to,
           'effective_from', r.effective_from,
           'effective_to', r.effective_to,
           'official_url', r.official_url,
           'captured_hash', r.captured_hash,
           'reviewed_at', r.reviewed_at
         ) order by r.key), '[]'::jsonb)
  into v_requirements
  from reg.requirements r
  join reg.sources s on s.id = r.source_id
  where r.review_state = 'approved';

  select coalesce(jsonb_agg(jsonb_build_object(
           'requirement', r.key,
           'target_type', c.target_type,
           'target_key', c.target_key,
           'is_primary', c.is_primary
         ) order by c.target_type, c.target_key, r.key), '[]'::jsonb)
  into v_citations
  from public.requirement_citations c
  join reg.requirements r on r.id = c.requirement_id;

  v_snapshot := jsonb_build_object(
    'version', 2,
    'controls', v_controls,
    'frameworks', v_frameworks,
    'maps', v_maps,
    'requirements', v_requirements,
    'citations', v_citations
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

comment on function public.publish_methodology_version(text, text) is
  'Freeze the live methodology catalogue and the approved requirement registry into a named published version and mark it current.';

-- ---------------------------------------------------------------- grants

revoke all on function public.reg_compose_basis(text, text) from public;
revoke all on function public.reg_compose_short(text, text) from public;
revoke all on function public.reg_sync_citations() from public;
revoke all on function public.reg_obligation_requirements() from public;
grant execute on function public.reg_sync_citations() to service_role;
grant execute on function public.reg_obligation_requirements() to authenticated, service_role;

-- ---------------------------------------------------------------- schedule and first run

select cron.unschedule(jobid) from cron.job where jobname = 'reg-sync-citations-daily';

select cron.schedule(
  'reg-sync-citations-daily',
  '5 0 * * *',
  $job$ select public.reg_sync_citations(); $job$
);

select public.reg_sync_citations();
