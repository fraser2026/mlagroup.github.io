-- Custom framework controls become full governance controls owned by one organisation.
-- Catalogue controls keep org_id null and a global control_number.

alter table public.governance_controls
  add column if not exists org_id uuid references public.organisations(id) on delete cascade,
  add column if not exists reference text,
  add column if not exists created_by uuid references auth.users(id) on delete set null;

alter table public.governance_controls alter column control_number drop not null;
alter table public.governance_controls drop constraint if exists governance_controls_catalogue_number;
alter table public.governance_controls add constraint governance_controls_catalogue_number
  check (org_id is not null or control_number is not null);
alter table public.governance_controls drop constraint if exists governance_controls_reference_len;
alter table public.governance_controls add constraint governance_controls_reference_len
  check (reference is null or char_length(reference) <= 60);

create index if not exists governance_controls_org_id_idx on public.governance_controls (org_id) where org_id is not null;

drop policy if exists gc_select on public.governance_controls;
create policy gc_select on public.governance_controls for select
  using (org_id is null or public.is_org_member(org_id) or public.is_mla_admin());

drop policy if exists ct_select on public.control_tasks;
create policy ct_select on public.control_tasks for select
  using (exists (
    select 1 from public.governance_controls g
    where g.id = control_id and (g.org_id is null or public.is_org_member(g.org_id) or public.is_mla_admin())
  ));

-- Writes for org controls go through the security definer functions below.

create or replace function public.save_org_framework_control(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fw uuid := (p->>'framework_id')::uuid;
  v_fc uuid := nullif(p->>'framework_control_id', '')::uuid;
  v_org uuid;
  v_ctrl uuid;
  v_title text := btrim(coalesce(p->>'title', ''));
  v_desc text := btrim(coalesce(p->>'description', ''));
  v_type text := coalesce(nullif(p->>'control_type', ''), 'organisation');
  v_pillar text := coalesce(nullif(p->>'pillar', ''), 'control');
  v_assignee uuid := nullif(p->>'assigned_to', '')::uuid;
  v_due date := nullif(p->>'due_date', '')::date;
  v_priority text := coalesce(nullif(p->>'priority', ''), 'medium');
  v_systems uuid[];
  v_task jsonb;
  v_n int := 0;
  v_order int;
begin
  select org_id into v_org from org_frameworks where id = v_fw;
  if v_org is null then
    raise exception 'Framework not found';
  end if;
  if not has_org_role(v_org, array['owner', 'admin', 'editor']) then
    raise exception 'Your role cannot edit this framework';
  end if;
  if char_length(v_title) < 2 or char_length(v_title) > 200 then
    raise exception 'Control title must be between 2 and 200 characters';
  end if;
  if v_assignee is not null and not exists (
    select 1 from org_members where org_id = v_org and user_id = v_assignee
  ) then
    raise exception 'Owner must be a member of this organisation';
  end if;

  select coalesce(array_agg(s.id), '{}') into v_systems
  from ai_systems s
  where s.org_id = v_org
    and s.deleted_at is null
    and s.id in (select (jsonb_array_elements_text(coalesce(p->'system_ids', '[]'::jsonb)))::uuid);

  if v_type = 'system' and cardinality(v_systems) = 0 then
    raise exception 'Select at least one AI asset for a system control';
  end if;

  if v_fc is not null then
    select mapped_control_id into v_ctrl
    from org_framework_controls where id = v_fc and framework_id = v_fw;
    if not found then
      raise exception 'Control not found in this framework';
    end if;
    if v_ctrl is not null and not exists (
      select 1 from governance_controls where id = v_ctrl and org_id = v_org
    ) then
      v_ctrl := null;
    end if;
  end if;

  if v_ctrl is null then
    insert into governance_controls (
      org_id, reference, title, description, purpose, control_type, pillar,
      is_org_level, evidence_types, display_order, is_active, created_by
    ) values (
      v_org, nullif(btrim(p->>'reference'), ''), v_title, v_desc, nullif(btrim(p->>'purpose'), ''),
      v_type, v_pillar, v_type <> 'system', coalesce(p->'evidence_types', '[]'::jsonb), 1000, true, auth.uid()
    ) returning id into v_ctrl;
  else
    update governance_controls set
      reference = nullif(btrim(p->>'reference'), ''),
      title = v_title,
      description = v_desc,
      purpose = nullif(btrim(p->>'purpose'), ''),
      control_type = v_type,
      pillar = v_pillar,
      is_org_level = v_type <> 'system',
      evidence_types = coalesce(p->'evidence_types', '[]'::jsonb)
    where id = v_ctrl;
    delete from control_tasks where control_id = v_ctrl;
  end if;

  for v_task in select value from jsonb_array_elements(coalesce(p->'tasks', '[]'::jsonb)) loop
    if char_length(btrim(coalesce(v_task->>'title', ''))) = 0 then
      continue;
    end if;
    v_n := v_n + 1;
    insert into control_tasks (control_id, task_number, title, description, task_type, options, display_order)
    values (
      v_ctrl, v_n, btrim(v_task->>'title'), nullif(btrim(coalesce(v_task->>'description', '')), ''),
      coalesce(nullif(v_task->>'task_type', ''), 'checkbox'),
      case when jsonb_typeof(v_task->'options') = 'object' then v_task->'options' else null end,
      v_n
    );
  end loop;

  if v_fc is null then
    select coalesce(max(display_order), -1) + 1 into v_order from org_framework_controls where framework_id = v_fw;
    insert into org_framework_controls (framework_id, org_id, title, description, category, display_order, mapped_control_id, status)
    values (v_fw, v_org, v_title, left(v_desc, 4000), v_pillar, v_order, v_ctrl, 'not_started')
    returning id into v_fc;
  else
    update org_framework_controls set
      title = v_title, description = left(v_desc, 4000), category = v_pillar,
      mapped_control_id = v_ctrl, updated_at = now()
    where id = v_fc;
  end if;

  if v_type = 'system' then
    delete from control_assignments
    where control_id = v_ctrl and (system_id is null or not (system_id = any (v_systems)));
    insert into control_assignments (control_id, org_id, system_id, status, triggered_by, triggered_at,
      assigned_to, assigned_by, assigned_at, due_date, priority)
    select v_ctrl, v_org, s, 'not_started', 'manual', now(),
      v_assignee, case when v_assignee is not null then auth.uid() end,
      case when v_assignee is not null then now() end, v_due, v_priority
    from unnest(v_systems) s
    where not exists (select 1 from control_assignments a where a.control_id = v_ctrl and a.system_id = s);
  else
    delete from control_assignments where control_id = v_ctrl and system_id is not null;
    if not exists (select 1 from control_assignments where control_id = v_ctrl and system_id is null) then
      insert into control_assignments (control_id, org_id, system_id, status, triggered_by, triggered_at,
        assigned_to, assigned_by, assigned_at, due_date, priority)
      values (v_ctrl, v_org, null, 'not_started', 'manual', now(),
        v_assignee, case when v_assignee is not null then auth.uid() end,
        case when v_assignee is not null then now() end, v_due, v_priority);
    end if;
  end if;

  update control_assignments set
    assigned_to = coalesce(v_assignee, assigned_to),
    assigned_by = case when v_assignee is not null and assigned_to is distinct from v_assignee then auth.uid() else assigned_by end,
    assigned_at = case when v_assignee is not null and assigned_to is distinct from v_assignee then now() else assigned_at end,
    due_date = coalesce(v_due, due_date),
    priority = v_priority,
    updated_at = now()
  where control_id = v_ctrl;

  return jsonb_build_object('framework_control_id', v_fc, 'control_id', v_ctrl);
end;
$$;

create or replace function public.delete_org_framework_control(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_ctrl uuid;
begin
  select org_id, mapped_control_id into v_org, v_ctrl from org_framework_controls where id = p_id;
  if v_org is null then
    raise exception 'Control not found';
  end if;
  if not has_org_role(v_org, array['owner', 'admin', 'editor']) then
    raise exception 'Your role cannot edit this framework';
  end if;
  delete from org_framework_controls where id = p_id;
  if v_ctrl is not null and exists (select 1 from governance_controls where id = v_ctrl and org_id = v_org)
     and not exists (select 1 from org_framework_controls where mapped_control_id = v_ctrl) then
    delete from support_requests where control_id = v_ctrl;
    delete from compliance_rules where control_id = v_ctrl;
    update policy_documents set linked_control_id = null where linked_control_id = v_ctrl;
    delete from control_assignments where control_id = v_ctrl;
    delete from governance_controls where id = v_ctrl;
  end if;
end;
$$;

create or replace function public.delete_org_framework(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_row record;
begin
  select org_id into v_org from org_frameworks where id = p_id;
  if v_org is null then
    raise exception 'Framework not found';
  end if;
  if not has_org_role(v_org, array['owner', 'admin']) then
    raise exception 'Only owners and admins can delete a framework';
  end if;
  for v_row in select id from org_framework_controls where framework_id = p_id loop
    perform public.delete_org_framework_control(v_row.id);
  end loop;
  delete from org_frameworks where id = p_id;
end;
$$;

revoke all on function public.save_org_framework_control(jsonb) from public, anon;
revoke all on function public.delete_org_framework_control(uuid) from public, anon;
revoke all on function public.delete_org_framework(uuid) from public, anon;
grant execute on function public.save_org_framework_control(jsonb) to authenticated;
grant execute on function public.delete_org_framework_control(uuid) to authenticated;
grant execute on function public.delete_org_framework(uuid) to authenticated;
