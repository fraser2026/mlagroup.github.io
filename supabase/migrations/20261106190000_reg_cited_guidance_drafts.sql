-- Phase 1d follow-up: documents the public pages cite that were not in the registry.
-- Added as drafts for review in Control Centre; the citation check accepts them once approved.
-- Also moves the "no AI inventory" diagnostic flag off Article 9 (a provider duty) to the
-- classification article and the FCA AI approach, matching the corrected page copy.

insert into reg.sources (key, title, short_title, issuer, jurisdiction, kind, url, licence, redistributable, display_order)
values
  ('fca_ps22_9', 'FCA PS22/9, A new Consumer Duty: feedback to CP21/36 and final rules', 'FCA', 'FCA', 'UK', 'rulebook',
   'https://www.fca.org.uk/publications/policy-statements/ps22-9-new-consumer-duty',
   'FCA website terms. Link and summarise; do not republish text', false, 54),
  ('pra_ss2_21', 'PRA SS2/21, Outsourcing and third party risk management', 'PRA', 'PRA', 'UK', 'supervisory_statement',
   'https://www.bankofengland.co.uk/prudential-regulation/publication/2021/march/outsourcing-and-third-party-risk-management-ss',
   'Bank of England website terms. Link and summarise; do not republish text', false, 61),
  ('ico_ai_guidance', 'ICO guidance on AI and data protection', 'ICO', 'ICO', 'UK', 'guidance',
   'https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/artificial-intelligence/guidance-on-ai-and-data-protection/',
   'ICO website terms. Link and summarise; do not republish text', false, 71)
on conflict (key) do nothing;

insert into reg.requirements (
  key, source_id, kind, citation, short_citation, title, summary, evidence_expected,
  applies_to, jurisdictions, effective_from, review_state, display_order
)
select v.key, s.id, v.kind, v.citation, v.short_citation, v.title, v.summary, v.evidence,
       v.applies_to, v.juris, v.eff_from, 'draft', v.ord
from (values
  ('fca:ps22_9', 'fca_ps22_9', 'obligation', 'FCA PS22/9', 'PS22/9', 'Consumer Duty final rules',
   'The policy statement that made the Consumer Duty rules in PRIN 2A: firms act to deliver good outcomes for retail customers, including where AI shapes products, prices, communications or support.',
   'Outcome monitoring and board reporting covering AI-assisted customer journeys',
   '{fca_firm}'::text[], '{UK}'::text[], date '2023-07-31', 10),
  ('pra:ss2_21', 'pra_ss2_21', 'expectation', 'PRA SS2/21', 'SS2/21', 'Outsourcing and third party risk management',
   'PRA-regulated firms assess materiality, carry out due diligence, set contractual terms, and keep exit plans and oversight for outsourcing and other third party arrangements, including AI vendors.',
   'Third party register, due diligence and exit plans for material AI vendors',
   '{pra_firm}'::text[], '{UK}'::text[], date '2022-03-31', 10),
  ('ico:ai_guidance', 'ico_ai_guidance', 'expectation', 'ICO guidance on AI and data protection', 'ICO AI guidance', 'Guidance on AI and data protection',
   'How UK GDPR applies to AI: accountability and DPIAs, lawfulness, fairness and bias, transparency, security, data minimisation and individual rights. Updated 15 March 2023.',
   'DPIA and fairness assessment for AI processing personal data',
   '{controller}'::text[], '{UK}'::text[], date '2023-03-15', 10)
) as v (key, src, kind, citation, short_citation, title, summary, evidence, applies_to, juris, eff_from, ord)
join reg.sources s on s.key = v.src
on conflict (key) do nothing;

-- Diagnostic "no AI inventory" flag: classification and the FCA AI approach, not Article 9.
delete from public.requirement_citations c
using reg.requirements r
where c.requirement_id = r.id
  and r.key = 'eu_ai_act:art9'
  and c.target_type = 'diagnostic_flag'
  and c.target_key = 'pf_no_inventory';

insert into public.requirement_citations (requirement_id, target_type, target_key, is_primary, display_order)
select r.id, 'diagnostic_flag', l.target_key, l.is_primary, l.ord
from (values
  ('pf_no_inventory', 'eu_ai_act:art6', true, 10),
  ('pf_no_inventory', 'fca:ai_approach', false, 20),
  ('pf_dpia', 'ico:ai_guidance', false, 20)
) as l (target_key, requirement_key, is_primary, ord)
join reg.requirements r on r.key = l.requirement_key
on conflict (requirement_id, target_type, target_key) do nothing;
