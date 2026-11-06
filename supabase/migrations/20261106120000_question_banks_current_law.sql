-- Bring the diagnostic and asset assessment question banks in line with the law as at Nov 2026.
-- Wording only: question keys and option scores are unchanged, so earlier results stay comparable.
-- One diagnostic category is added (life and health insurance, Annex III point 5(c)).

-- Diagnostic q1_2: identity verification alone is excluded from Annex III point 1; insurance pricing was missing.
update public.diagnostic_questions set
  hint = 'Some of these are high-risk uses under EU AI Act Annex III (credit scoring, life and health insurance pricing, recruitment and HR, biometric identification); others bring UK GDPR automated decision and FCA Consumer Duty obligations. Select all that apply. Selections affect your exposure score.',
  options = '[
    {"label": "Automated decision support affecting individuals", "value": "auto"},
    {"label": "Customer profiling or segmentation", "value": "profile"},
    {"label": "Creditworthiness assessment or credit scoring of individuals", "value": "credit"},
    {"label": "Life or health insurance risk assessment or pricing", "value": "insurance"},
    {"label": "HR or recruitment support", "value": "hr"},
    {"label": "Biometric identification or categorisation (not simple identity checks)", "value": "bio"},
    {"label": "Health or safety related outputs", "value": "health"},
    {"label": "None of the above: AI is used only for internal operational tasks", "value": "none"}
  ]'::jsonb,
  updated_at = now()
where question_key = 'q1_2';

update public.diagnostic_questions set
  prompt = 'Can a specific AI-assisted decision be traced back to its source inputs, the model version that produced it, and the logic applied, for any decision made in the past 12 months?',
  updated_at = now()
where question_key = 'q5_4';

update public.diagnostic_questions set
  prompt = 'Are individuals informed, at the point of interaction or decision, when automated or AI-assisted processes are used in ways that materially affect them?',
  updated_at = now()
where question_key = 'q6_2';

-- UK GDPR Articles 22A to 22D safeguards: representations, human intervention, contest.
update public.diagnostic_questions set
  prompt = 'Is there a documented process allowing individuals to make representations about, request human review of, or contest an AI-assisted decision that affects them?',
  updated_at = now()
where question_key = 'q6_3';

update public.diagnostic_questions set
  hint = 'Transparency duties and prohibited practices apply now. High-risk obligations for Annex III uses, such as credit scoring and life and health insurance pricing, apply from 2 December 2027.',
  updated_at = now()
where question_key = 'q6_4';

-- GDPR has no free-standing right to explanation; the right is to meaningful information about the logic involved.
update public.diagnostic_questions set
  prompt = 'Are individuals able to exercise their data rights in relation to AI-assisted decisions, including access to meaningful information about the logic involved, objection, and erasure?',
  updated_at = now()
where question_key = 'q6_5';

-- Asset assessment section bases: deployer duties and UK financial services sources alongside provider articles.
update public.assessment_sections set
  regulatory_basis = 'EU AI Act Articles 14 and 26(2); UK GDPR Articles 22A to 22D',
  updated_at = now()
where section_key = 's4';

update public.assessment_sections set
  regulatory_basis = 'EU AI Act Articles 9, 11, 17 (providers) and 26 (deployers); FCA SM&CR',
  updated_at = now()
where section_key = 's6';

update public.assessment_sections set
  regulatory_basis = 'EU AI Act Article 26; FCA SYSC 8 (outsourcing); DORA (EU financial entities)',
  updated_at = now()
where section_key = 's7';

-- q3_3: deployers of high-risk systems must keep logs for at least six months (AI Act Article 26(6)).
update public.assessment_questions set
  options = jsonb_set(options, '{0,label}', '"Yes: comprehensive logging, retained for at least six months"'),
  updated_at = now()
where question_key = 'q3_3' and options->0->>'label' = 'Yes: comprehensive logging with defined retention period';

-- q5_4: third-party models change and are retired by providers; "fixed" is no longer a safe assumption.
update public.assessment_questions q set
  options = (
    select jsonb_agg(
      case when o->>'label' = 'Not applicable: using a fixed third-party model'
        then jsonb_set(o, '{label}', '"Third-party model: version pinned and provider changes reviewed"')
        else o end
      order by ord)
    from jsonb_array_elements(q.options) with ordinality as t(o, ord)
  ),
  updated_at = now()
where question_key = 'q5_4';
