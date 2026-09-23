-- Phase 2c: Asset assessment question bank (per-AI-asset engine).
-- Separate from diagnostic org-funnel questions. UI chrome stays in assessment.html;
-- Control Centre edits prompt/options/scores. Scoring keys (q1_1 etc.) must stay stable.

create table if not exists public.assessment_sections (
  section_key text primary key,
  title text not null,
  description text null,
  regulatory_basis text null,
  display_order integer not null default 0,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.assessment_questions (
  id uuid primary key default gen_random_uuid(),
  section_key text not null references public.assessment_sections(section_key) on delete cascade,
  question_key text not null unique,
  prompt text not null,
  hint text null,
  display_order integer not null default 0,
  is_active boolean not null default true,
  options jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint assessment_questions_options_is_array check (jsonb_typeof(options) = 'array')
);

create index if not exists assessment_questions_section_order_idx
  on public.assessment_questions (section_key, display_order)
  where is_active;

comment on table public.assessment_sections is
  'Per-asset AI system assessment domains. Not the org diagnostic engine.';
comment on table public.assessment_questions is
  'Per-asset assessment prompts + scored options (jsonb). question_key feeds the scoring engine.';

alter table public.assessment_sections enable row level security;
alter table public.assessment_questions enable row level security;

drop policy if exists as_select on public.assessment_sections;
create policy as_select on public.assessment_sections for select to anon, authenticated using (true);
drop policy if exists as_mla_admin_write on public.assessment_sections;
create policy as_mla_admin_write on public.assessment_sections for all to authenticated
  using (public.is_mla_admin()) with check (public.is_mla_admin());

drop policy if exists aq_select on public.assessment_questions;
create policy aq_select on public.assessment_questions for select to anon, authenticated using (true);
drop policy if exists aq_mla_admin_write on public.assessment_questions;
create policy aq_mla_admin_write on public.assessment_questions for all to authenticated
  using (public.is_mla_admin()) with check (public.is_mla_admin());

grant select on public.assessment_sections to anon, authenticated;
grant select, insert, update, delete on public.assessment_sections to authenticated;
grant select on public.assessment_questions to anon, authenticated;
grant select, insert, update, delete on public.assessment_questions to authenticated;

do $$
declare
  seed jsonb := '[{"section_key":"s1","title":"System Purpose & Classification","description":"Establishing the intended use, impact scope, and regulatory exposure of this AI system.","regulatory_basis":"EU AI Act Annex III, Article 6","display_order":10,"questions":[{"question_key":"q1_1","prompt":"What is the intended use and potential impact of this AI system?","hint":null,"display_order":10,"options":[{"label":"Low impact: internal tooling with no effect on individuals","score":3},{"label":"Moderate impact: supports decisions but a human always decides","score":2},{"label":"Significant impact: directly informs decisions affecting individuals","score":1},{"label":"Critical impact: makes or substantially determines outcomes for individuals","score":0}]},{"question_key":"q1_2","prompt":"Who are the primary end users of this system?","hint":null,"display_order":20,"options":[{"label":"Internal staff only: no public-facing interaction","score":3},{"label":"Internal staff with outputs shared externally","score":2},{"label":"Directly accessed by customers or the public","score":1},{"label":"Used by regulated entities or vulnerable populations","score":0}]},{"question_key":"q1_3","prompt":"Does this system make or inform decisions that affect individuals'' rights, access to services, or financial position?","hint":null,"display_order":30,"options":[{"label":"No: outputs do not affect individuals","score":3},{"label":"Indirectly: outputs may influence but do not determine outcomes","score":2},{"label":"Yes: the system informs decisions that affect individuals","score":1},{"label":"Yes: the system makes automated decisions with direct effect","score":0}]},{"question_key":"q1_4","prompt":"At what scale does this system operate?","hint":null,"display_order":40,"options":[{"label":"Limited: small number of users or cases","score":3},{"label":"Moderate: departmental use across the organisation","score":2},{"label":"Significant: organisation-wide or large customer base","score":1},{"label":"Extensive: high-volume processing affecting many individuals","score":0}]}]},{"section_key":"s2","title":"Data Governance","description":"Assessing data practices, personal data handling, quality controls, and retention policies.","regulatory_basis":"UK GDPR Articles 5, 6, 25, 35; EU AI Act Article 10","display_order":20,"questions":[{"question_key":"q2_1","prompt":"What type of data does this system process?","hint":null,"display_order":10,"options":[{"label":"Non-personal, non-sensitive data only","score":3},{"label":"Personal data that is not sensitive (names, contact details)","score":2},{"label":"Special category data (health, ethnicity, biometric)","score":1},{"label":"Don''t know what data the system processes","score":0}]},{"question_key":"q2_2","prompt":"Is there a documented lawful basis for this system''s processing of personal data?","hint":null,"display_order":20,"options":[{"label":"Yes: lawful basis identified, documented, and reviewed within 12 months","score":3},{"label":"Yes: identified but not formally documented","score":2},{"label":"No personal data is processed","score":3},{"label":"No: lawful basis has not been assessed","score":0},{"label":"Don''t know","score":0}]},{"question_key":"q2_3","prompt":"Is the source of training and input data verified and documented?","hint":null,"display_order":30,"options":[{"label":"Yes: data sources documented with provenance and quality records","score":3},{"label":"Partially: some sources documented but not comprehensively","score":2},{"label":"No: data sources are not tracked","score":0},{"label":"Don''t know","score":0}]},{"question_key":"q2_4","prompt":"Are mechanisms in place to monitor data quality and detect bias?","hint":null,"display_order":40,"options":[{"label":"Yes: regular assessments with documented methodology and results","score":3},{"label":"Partially: some checks exist but are not systematic","score":2},{"label":"Planned but not yet implemented","score":1},{"label":"No mechanisms in place","score":0}]},{"question_key":"q2_5","prompt":"Is there a defined data retention and deletion policy for this system?","hint":null,"display_order":50,"options":[{"label":"Yes: documented policy with defined retention periods and deletion procedures","score":3},{"label":"Partially: general organisational policy exists but not AI-specific","score":2},{"label":"No formal policy","score":0},{"label":"Don''t know","score":0}]}]},{"section_key":"s3","title":"Transparency & Explainability","description":"Evaluating whether AI interactions are disclosed, decisions can be explained, and outputs are traceable.","regulatory_basis":"EU AI Act Articles 13, 50; UK GDPR Article 22","display_order":30,"questions":[{"question_key":"q3_1","prompt":"Are end users informed that they are interacting with or affected by an AI system?","hint":null,"display_order":10,"options":[{"label":"Yes: clear disclosure at the point of interaction","score":3},{"label":"Partially: disclosed in terms of service but not at point of use","score":1},{"label":"No: users are not informed","score":0},{"label":"Not applicable: no user-facing interaction","score":3}]},{"question_key":"q3_2","prompt":"Can decisions or outputs produced by this system be explained in understandable terms?","hint":null,"display_order":20,"options":[{"label":"Yes: documented explanation methodology, accessible to non-technical stakeholders","score":3},{"label":"Partially: technical explanations available but not user-friendly","score":2},{"label":"Limited: explanations possible only in certain cases","score":1},{"label":"No: the system is a black box","score":0}]},{"question_key":"q3_3","prompt":"Are inputs, outputs, and confidence scores logged for audit and review?","hint":null,"display_order":30,"options":[{"label":"Yes: comprehensive logging with defined retention period","score":3},{"label":"Partially: some outputs logged but not systematically","score":2},{"label":"No logging in place","score":0},{"label":"Don''t know","score":0}]},{"question_key":"q3_4","prompt":"Are error handling and fallback mechanisms documented for when the system fails or produces uncertain outputs?","hint":null,"display_order":40,"options":[{"label":"Yes: documented procedures with defined triggers and escalation paths","score":3},{"label":"Partially: informal processes exist but are not documented","score":1},{"label":"No fallback mechanisms defined","score":0}]}]},{"section_key":"s4","title":"Human Oversight","description":"Assessing whether human judgement is integrated into AI-driven processes and whether oversight is effective.","regulatory_basis":"EU AI Act Article 14","display_order":40,"questions":[{"question_key":"q4_1","prompt":"Are high-impact outputs reviewed by a human before action is taken?","hint":null,"display_order":10,"options":[{"label":"Yes: mandatory human review for all high-impact outputs with documented protocols","score":3},{"label":"Conditionally: based on defined risk thresholds","score":2},{"label":"Rarely: review occurs informally","score":1},{"label":"No: outputs are acted upon without human review","score":0}]},{"question_key":"q4_2","prompt":"Can automated decisions be overridden by a human, and is this process documented?","hint":null,"display_order":20,"options":[{"label":"Yes: formally documented override process with records maintained","score":3},{"label":"Yes: override is possible but the process is informal","score":1},{"label":"No: there is no mechanism to override","score":0}]},{"question_key":"q4_3","prompt":"Are staff responsible for reviewing AI outputs trained on the system''s capabilities and limitations?","hint":null,"display_order":30,"options":[{"label":"Yes: mandatory training with completion records and periodic refresh","score":3},{"label":"Yes: training available but voluntary or inconsistent","score":2},{"label":"No formal training provided","score":0},{"label":"Not applicable: no human review takes place","score":0}]},{"question_key":"q4_4","prompt":"Is there a formal process for monitoring whether human oversight is effective in practice?","hint":null,"display_order":40,"options":[{"label":"Yes: regular reviews of override rates, decision quality, and oversight outcomes","score":3},{"label":"Partially: some metrics tracked but not systematically reviewed","score":2},{"label":"No formal monitoring of oversight effectiveness","score":0}]}]},{"section_key":"s5","title":"Security & Robustness","description":"Evaluating resilience against adversarial threats, performance monitoring, and operational continuity.","regulatory_basis":"EU AI Act Article 15","display_order":50,"questions":[{"question_key":"q5_1","prompt":"Has this system been tested for adversarial vulnerabilities specific to AI (e.g. prompt injection, data poisoning, model manipulation)?","hint":null,"display_order":10,"options":[{"label":"Yes: formal AI-specific security testing conducted and documented","score":3},{"label":"Partially: general security testing but AI-specific risks not assessed","score":1},{"label":"No testing conducted","score":0},{"label":"Don''t know","score":0}]},{"question_key":"q5_2","prompt":"Is the system''s performance monitored on an ongoing basis, including accuracy and drift detection?","hint":null,"display_order":20,"options":[{"label":"Yes: automated monitoring with defined thresholds and alerting","score":3},{"label":"Yes: manual periodic reviews","score":2},{"label":"Partially: some monitoring but no defined thresholds","score":1},{"label":"No performance monitoring in place","score":0}]},{"question_key":"q5_3","prompt":"Are there defined procedures for responding to AI system failures, harmful outputs, or unexpected behaviour?","hint":null,"display_order":30,"options":[{"label":"Yes: documented incident response including AI-specific scenarios","score":3},{"label":"General incident response exists but does not cover AI-specific failures","score":1},{"label":"No incident response process for this system","score":0}]},{"question_key":"q5_4","prompt":"Is model retraining, versioning, and change management controlled and documented?","hint":null,"display_order":40,"options":[{"label":"Yes: version control with documented change rationale and rollback capability","score":3},{"label":"Partially: some version tracking but not comprehensive","score":2},{"label":"No version control or change management","score":0},{"label":"Not applicable: using a fixed third-party model","score":2}]}]},{"section_key":"s6","title":"Accountability & Documentation","description":"Assessing whether governance roles, documentation, and audit capabilities are in place.","regulatory_basis":"EU AI Act Articles 9, 11, 17","display_order":60,"questions":[{"question_key":"q6_1","prompt":"Is there a named individual responsible for the governance of this AI system?","hint":null,"display_order":10,"options":[{"label":"Yes: named system owner with documented responsibilities and reporting line","score":3},{"label":"Yes: informally understood but not documented","score":1},{"label":"No: ownership is unclear","score":0}]},{"question_key":"q6_2","prompt":"Is technical documentation maintained for this system covering architecture, intended use, limitations, and performance?","hint":null,"display_order":20,"options":[{"label":"Yes: comprehensive documentation maintained and reviewed within 12 months","score":3},{"label":"Partially: some documentation exists but is incomplete or outdated","score":2},{"label":"No documentation maintained","score":0}]},{"question_key":"q6_3","prompt":"Are incidents and failures logged, reviewed, and used to improve the system?","hint":null,"display_order":30,"options":[{"label":"Yes: incident log with root cause analysis and documented improvements","score":3},{"label":"Partially: incidents are noted but not systematically reviewed","score":1},{"label":"No incident logging","score":0}]},{"question_key":"q6_4","prompt":"Are decision logs and audit trails maintained that would satisfy a regulatory examination?","hint":null,"display_order":40,"options":[{"label":"Yes: audit-ready logs retained for a defined period, accessible on request","score":3},{"label":"Partially: some records exist but may not satisfy regulatory scrutiny","score":2},{"label":"No audit trail maintained","score":0},{"label":"Don''t know","score":0}]}]},{"section_key":"s7","title":"Third-Party & Supply Chain","description":"Evaluating governance of external AI providers, vendor contracts, and supply chain transparency.","regulatory_basis":"EU AI Act Article 26","display_order":70,"questions":[{"question_key":"q7_1","prompt":"Is this AI system developed in-house, provided by a third party, or a hybrid?","hint":"Third-party systems carry additional deployer obligations under the EU AI Act.","display_order":10,"options":[{"label":"Fully in-house: developed and maintained internally","score":3},{"label":"Hybrid: built on third-party foundation with internal customisation","score":2},{"label":"Third-party: externally provided with limited internal visibility","score":1},{"label":"Don''t know the development origin","score":0}]},{"question_key":"q7_2","prompt":"Have vendor contracts been reviewed for regulatory compliance, data handling, and liability allocation?","hint":null,"display_order":20,"options":[{"label":"Yes: contracts reviewed with specific AI governance provisions","score":3},{"label":"Partially: standard procurement review but no AI-specific clauses","score":2},{"label":"No contract review for AI governance","score":0},{"label":"Not applicable: system is fully in-house","score":3}]},{"question_key":"q7_3","prompt":"Are model cards, transparency reports, or impact assessments available from the provider?","hint":null,"display_order":30,"options":[{"label":"Yes: provider supplies comprehensive transparency documentation","score":3},{"label":"Partially: some information available but incomplete","score":2},{"label":"No: provider does not supply transparency documentation","score":0},{"label":"Not applicable: system is fully in-house","score":3}]},{"question_key":"q7_4","prompt":"Are third-party updates, model changes, or data practice changes tracked and assessed before deployment?","hint":null,"display_order":40,"options":[{"label":"Yes: change management process includes third-party AI updates","score":3},{"label":"Partially: aware of major updates but no formal tracking","score":2},{"label":"No: third-party changes are not tracked","score":0},{"label":"Not applicable: system is fully in-house","score":3}]}]}]'::jsonb;
  sec jsonb;
  q jsonb;
begin
  if exists (select 1 from public.assessment_questions limit 1) then
    return;
  end if;

  for sec in select * from jsonb_array_elements(seed)
  loop
    insert into public.assessment_sections (section_key, title, description, regulatory_basis, display_order)
    values (
      sec->>'section_key',
      sec->>'title',
      sec->>'description',
      sec->>'regulatory_basis',
      coalesce((sec->>'display_order')::int, 0)
    )
    on conflict (section_key) do update set
      title = excluded.title,
      description = excluded.description,
      regulatory_basis = excluded.regulatory_basis,
      display_order = excluded.display_order,
      is_active = true,
      updated_at = now();

    for q in select * from jsonb_array_elements(sec->'questions')
    loop
      insert into public.assessment_questions (section_key, question_key, prompt, hint, display_order, options)
      values (
        sec->>'section_key',
        q->>'question_key',
        q->>'prompt',
        nullif(q->>'hint',''),
        coalesce((q->>'display_order')::int, 0),
        coalesce(q->'options', '[]'::jsonb)
      )
      on conflict (question_key) do update set
        section_key = excluded.section_key,
        prompt = excluded.prompt,
        hint = excluded.hint,
        display_order = excluded.display_order,
        options = excluded.options,
        is_active = true,
        updated_at = now();
    end loop;
  end loop;
end
$$;
