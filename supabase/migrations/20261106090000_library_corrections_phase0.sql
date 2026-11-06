-- Phase 0 library corrections (docs/PLATFORM-ALIGNMENT-PLAN.md, docs/REGULATORY-RESEARCH.md section 1).
-- Rows are corrected in place: system_compliance and control_requirement_map reference obligation ids,
-- so ids never change. Publish a new methodology version in Control Centre after applying.

alter table public.compliance_frameworks drop constraint if exists compliance_frameworks_framework_check;
alter table public.compliance_frameworks add constraint compliance_frameworks_framework_check
  check (framework = any (array['eu_ai_act', 'uk_gdpr', 'eu_gdpr', 'fca', 'pra']));

-- FG24/5 is FCA guidance on change in control, not AI. The FCA's AI position is its AI Update and AI approach.
update public.compliance_frameworks set
  obligation_key = 'fca_ai_approach',
  article_reference = 'FCA AI Update (April 2024) and AI approach',
  obligation_title = 'FCA approach to AI in financial services',
  obligation_description = 'The FCA has no AI-specific rules. Firms using AI must meet existing requirements, including the Consumer Duty, SM&CR, SYSC systems and controls, and operational resilience, and be able to explain, monitor and take responsibility for AI-driven outcomes.',
  guidance_text = 'Map each AI system to the FCA requirements it touches. Monitor customer outcomes across groups, control bias and accuracy, tell consumers when AI is used, and name the senior manager accountable. Use the FCA AI good and poor practice publication as the benchmark.'
where obligation_key = 'fca_fg24_5';

-- SS1/23 is a PRA supervisory statement for banks, not an FCA publication.
update public.compliance_frameworks set
  framework = 'pra',
  obligation_key = 'pra_ss1_23',
  article_reference = 'PRA SS1/23',
  obligation_title = 'Model risk management principles for banks',
  obligation_description = 'PRA-regulated banks and building societies must manage model risk, including AI and machine learning models, through a model inventory with risk tiering, governance, independent validation, change control and ongoing performance monitoring. In effect from 17 May 2024.',
  guidance_text = 'Include AI and machine learning models in the model inventory with a risk tier. Apply validation, change control and monitoring proportionate to the tier. Firms not regulated by the PRA can use SS1/23 as good practice.'
where obligation_key = 'fca_ss1_23';

-- UK GDPR Article 22 was replaced by Articles 22A to 22D on 5 Feb 2026 (Data (Use and Access) Act 2025 s.80, SI 2026/82).
update public.compliance_frameworks set
  obligation_key = 'ukgdpr_art22a_d',
  article_reference = 'UK GDPR Articles 22A to 22D',
  obligation_title = 'Automated decision-making safeguards',
  obligation_description = 'Significant decisions based solely on automated processing are permitted for most personal data, provided safeguards are in place: inform the person, let them make representations, offer human intervention, and let them contest the decision. Decisions using special category data remain restricted. Decisions taken before 5 Feb 2026 are governed by former Article 22.',
  guidance_text = 'Identify AI systems that make or substantially determine significant decisions about individuals. For each, record evidence of the four safeguards and of any meaningful human involvement. Treat special category data separately under Article 22B.'
where obligation_key = 'ukgdpr_art22';

-- Article 27 also applies to deployers of credit scoring and life and health insurance pricing systems.
update public.compliance_frameworks set
  obligation_description = 'Before using a high-risk AI system, deployers that are public bodies or private entities providing public services, and deployers of systems used for creditworthiness assessment or credit scoring of individuals, or for risk assessment and pricing in life and health insurance (Annex III points 5(b) and 5(c)), must assess the impact on fundamental rights and notify the market surveillance authority of the results.',
  guidance_text = 'Classify each AI asset against Annex III. Where points 5(b) or 5(c) apply, complete a fundamental rights impact assessment before use, covering the people affected, the specific risks of harm, human oversight measures and how risks will be addressed. Applies from 2 Dec 2027 under the AI Omnibus.'
where obligation_key = 'euaia_art27';

-- Deployers must keep automatically generated logs for at least six months (Article 26(6)).
update public.compliance_frameworks set
  guidance_text = 'Implement decision logging for all high-impact outputs. Deployers must keep automatically generated logs for at least six months (Article 26(6)); a longer period may be proportionate to the system''s risk profile. Ensure logs are accessible for audit.'
where obligation_key = 'euaia_art12';

update public.compliance_frameworks set
  guidance_text = 'Implement clear, visible disclosure at the point of interaction. Use plain language, not a clause buried in terms of service.'
where obligation_key = 'euaia_art50_1';

update public.compliance_frameworks set
  article_reference = 'FCA Consumer Duty (PRIN 2A)',
  obligation_title = 'Consumer Duty: AI in customer outcomes',
  obligation_description = 'Under the Consumer Duty, firms must act to deliver good outcomes for retail customers. Where AI systems influence customer-facing decisions, firms must ensure these systems support, and do not undermine, good outcomes.'
where obligation_key = 'fca_consumer_duty';

-- EU clients are under EU GDPR, where Article 22 is unchanged.
insert into public.compliance_frameworks (
  framework, applicable_risk_tiers, obligation_key, obligation_title, obligation_description,
  guidance_text, article_reference, display_order, is_active
)
select
  'eu_gdpr',
  array['high', 'limited', 'minimal'],
  'eugdpr_art22',
  'Automated individual decision-making',
  'Data subjects have the right not to be subject to a decision based solely on automated processing, including profiling, which produces legal effects or similarly significantly affects them, unless an exception applies (contract, law, or explicit consent) with suitable safeguards, including the right to obtain human intervention, express a view and contest the decision.',
  'For EU data subjects, record which exception each automated decision relies on and the safeguards in place. Special category data needs explicit consent or substantial public interest.',
  'EU GDPR Article 22',
  1,
  true
where not exists (select 1 from public.compliance_frameworks where obligation_key = 'eugdpr_art22');

update public.control_requirement_map m set
  interpretation_note = 'Safeguards for significant automated decisions (Articles 22A to 22D).',
  updated_at = now()
from public.compliance_frameworks o
where o.id = m.obligation_id and o.obligation_key = 'ukgdpr_art22a_d';

update public.control_requirement_map m set
  interpretation_note = 'Model risk management expectations for PRA-regulated banks; good practice for other firms.',
  updated_at = now()
from public.compliance_frameworks o
where o.id = m.obligation_id and o.obligation_key = 'pra_ss1_23';

insert into public.control_requirement_map (control_id, obligation_id, is_primary, interpretation_note, display_order, is_active)
select c.id, o.id, false, 'Automated decision safeguards for EU data subjects.', 25, true
from public.governance_controls c
join public.compliance_frameworks o on o.obligation_key = 'eugdpr_art22'
where c.control_number = 5 and c.org_id is null
on conflict (control_id, obligation_id) do nothing;

update public.assessment_sections set
  regulatory_basis = 'EU AI Act Articles 13, 50; UK GDPR Articles 22A to 22D; EU GDPR Article 22',
  updated_at = now()
where section_key = 's3' and regulatory_basis = 'EU AI Act Articles 13, 50; UK GDPR Article 22';

-- Diagnostic overview: AI Omnibus dates (Regulation (EU) 2026/1744) and final AI Act penalty tiers (Article 99).
update public.diagnostic_regs set
  deadline = '2 Dec 2027',
  penalty = 'Up to EUR 15M or 3% global turnover',
  updated_at = now()
where regime = 'EU AI Act' and article in ('Art. 6 & Annex III', 'Art. 14', 'Art. 13 & 12', 'Art. 27');

update public.diagnostic_regs set
  penalty = 'Up to GBP 8.7M or 2% global turnover',
  updated_at = now()
where regime = 'UK GDPR' and article = 'Art. 35';

update public.diagnostic_regs set
  article = 'Arts. 22A to 22D',
  obligation = 'Safeguards for significant automated decisions',
  updated_at = now()
where regime = 'UK GDPR' and article = 'Art. 22';
