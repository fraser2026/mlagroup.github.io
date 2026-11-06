-- Phase 1a: requirement registry (docs/PLATFORM-ALIGNMENT-PLAN.md phase 1).
-- Schema reg holds the law: sources and requirements. It is not exposed to the API and
-- references nothing in public. RegAnchor reads it through the public reg_* functions and
-- points at it from its own tables (compliance_frameworks, control_requirement_map,
-- requirement_citations). Additive: no existing reader changes in this migration.
-- Seed: today's library, research section 3 rows and the missing regimes (research
-- section 1 error 6). Requirements RegAnchor already cites are approved; the rest are
-- drafts, hidden from read functions until reviewed in Control Centre.

create schema if not exists reg;
revoke all on schema reg from public;
grant usage on schema reg to service_role;

comment on schema reg is
  'Regulatory requirement registry. Sources and requirements only; consumer mappings live in the consumer schema.';

-- ---------------------------------------------------------------- sources

create table if not exists reg.sources (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  title text not null,
  issuer text not null,
  jurisdiction text not null check (jurisdiction in ('EU', 'UK', 'INT')),
  kind text not null check (kind in ('law', 'amending_law', 'rulebook', 'guidance', 'supervisory_statement', 'standard')),
  official_id text null,
  url text not null,
  feed_url text null,
  licence text not null,
  redistributable boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column reg.sources.official_id is 'ELI or legislation.gov.uk URI where one exists.';
comment on column reg.sources.redistributable is 'Whether captured text may be shown to parties outside MLA Group (licence permits reuse with attribution).';

-- ---------------------------------------------------------------- requirements

create table if not exists reg.requirements (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  source_id uuid not null references reg.sources (id),
  parent_id uuid null references reg.requirements (id),
  kind text not null check (kind in ('obligation', 'classification', 'penalty', 'expectation', 'benchmark')),
  citation text not null,
  short_citation text not null,
  title text not null,
  summary text not null,
  evidence_expected text null,
  applies_to text[] not null default '{}',
  jurisdictions text[] not null,
  risk_tiers text[] null,
  penalty text null,
  effective_from date null,
  effective_to date null,
  superseded_by uuid null references reg.requirements (id),
  official_url text null,
  review_state text not null default 'draft' check (review_state in ('draft', 'approved', 'retired')),
  reviewed_by uuid null,
  reviewed_at timestamptz null,
  captured_text text null,
  captured_hash text null,
  captured_url text null,
  captured_at timestamptz null,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint requirements_dates_ordered check (effective_to is null or effective_from is null or effective_to >= effective_from),
  constraint requirements_capture_pair check ((captured_text is null) = (captured_hash is null))
);

create index if not exists requirements_source_idx on reg.requirements (source_id, display_order);
create index if not exists requirements_parent_idx on reg.requirements (parent_id);

comment on column reg.requirements.key is 'Stable public key in official form, for example eu_ai_act:art26(6). Never reused.';
comment on column reg.requirements.risk_tiers is 'EU AI Act risk tiers the requirement attaches to. Null means not tier dependent.';
comment on column reg.requirements.effective_from is 'Date the requirement applies. Null means undated guidance, treated as current.';
comment on column reg.requirements.review_state is 'draft: seeded or proposed, hidden from read functions. approved: published to products. retired: kept for history.';
comment on column reg.requirements.captured_text is 'Verbatim clause text as retrieved from captured_url. Only for redistributable sources.';

alter table reg.sources enable row level security;
alter table reg.requirements enable row level security;
grant select on reg.sources, reg.requirements to service_role;

-- ---------------------------------------------------------------- seed: sources

insert into reg.sources (key, title, issuer, jurisdiction, kind, official_id, url, licence, redistributable, display_order)
values
  ('eu_ai_act', 'Regulation (EU) 2024/1689 (Artificial Intelligence Act)', 'European Union', 'EU', 'law',
   'http://data.europa.eu/eli/reg/2024/1689/oj', 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng',
   'EU legal text, reuse permitted with attribution (Commission Decision 2011/833/EU)', true, 10),
  ('eu_ai_omnibus', 'Regulation (EU) 2026/1744 (AI Omnibus), amending the AI Act', 'European Union', 'EU', 'amending_law',
   'http://data.europa.eu/eli/reg/2026/1744/oj', 'https://eur-lex.europa.eu/eli/reg/2026/1744/oj/eng',
   'EU legal text, reuse permitted with attribution (Commission Decision 2011/833/EU)', true, 11),
  ('eu_gdpr', 'Regulation (EU) 2016/679 (EU GDPR)', 'European Union', 'EU', 'law',
   'http://data.europa.eu/eli/reg/2016/679/oj', 'https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng',
   'EU legal text, reuse permitted with attribution (Commission Decision 2011/833/EU)', true, 20),
  ('eu_dora', 'Regulation (EU) 2022/2554 (Digital Operational Resilience Act)', 'European Union', 'EU', 'law',
   'http://data.europa.eu/eli/reg/2022/2554/oj', 'https://eur-lex.europa.eu/eli/reg/2022/2554/oj/eng',
   'EU legal text, reuse permitted with attribution (Commission Decision 2011/833/EU)', true, 30),
  ('uk_gdpr', 'UK GDPR (retained Regulation (EU) 2016/679 as amended)', 'UK Parliament', 'UK', 'law',
   'http://www.legislation.gov.uk/eur/2016/679', 'https://www.legislation.gov.uk/eur/2016/679/contents',
   'Open Government Licence v3.0', true, 40),
  ('uk_duaa_2025', 'Data (Use and Access) Act 2025', 'UK Parliament', 'UK', 'amending_law',
   'http://www.legislation.gov.uk/ukpga/2025/18', 'https://www.legislation.gov.uk/ukpga/2025/18/contents',
   'Open Government Licence v3.0', true, 41),
  ('uk_si_2026_82', 'SI 2026/82, Data (Use and Access) Act 2025 (Commencement No. 6) Regulations', 'UK Parliament', 'UK', 'amending_law',
   'http://www.legislation.gov.uk/uksi/2026/82', 'https://www.legislation.gov.uk/uksi/2026/82/made',
   'Open Government Licence v3.0', true, 42),
  ('uk_dpa_2018', 'Data Protection Act 2018', 'UK Parliament', 'UK', 'law',
   'http://www.legislation.gov.uk/ukpga/2018/12', 'https://www.legislation.gov.uk/ukpga/2018/12/contents',
   'Open Government Licence v3.0', true, 43),
  ('uk_fsma_2000', 'Financial Services and Markets Act 2000', 'UK Parliament', 'UK', 'law',
   'http://www.legislation.gov.uk/ukpga/2000/8', 'https://www.legislation.gov.uk/ukpga/2000/8/contents',
   'Open Government Licence v3.0', true, 44),
  ('fca_handbook', 'FCA Handbook', 'FCA', 'UK', 'rulebook',
   null, 'https://www.handbook.fca.org.uk/handbook',
   'FCA website terms. Link and summarise; do not republish text', false, 50),
  ('fca_ai_approach', 'FCA AI Update (April 2024) and AI approach', 'FCA', 'UK', 'guidance',
   null, 'https://www.fca.org.uk/firms/innovation/ai-approach',
   'FCA website terms. Link and summarise; do not republish text', false, 51),
  ('fca_ai_good_practice', 'FCA, AI in financial services: good practice and areas for improvement', 'FCA', 'UK', 'guidance',
   null, 'https://www.fca.org.uk/publications/good-poor-practice/ai-financial-services',
   'FCA website terms. Link and summarise; do not republish text', false, 52),
  ('fca_fg21_1', 'FCA FG21/1, Guidance for firms on the fair treatment of vulnerable customers', 'FCA', 'UK', 'guidance',
   null, 'https://www.fca.org.uk/publications/finalised-guidance/guidance-firms-fair-treatment-vulnerable-customers',
   'FCA website terms. Link and summarise; do not republish text', false, 53),
  ('pra_ss1_23', 'PRA SS1/23, Model risk management principles for banks', 'PRA', 'UK', 'supervisory_statement',
   null, 'https://www.bankofengland.co.uk/prudential-regulation/publication/2023/may/model-risk-management-principles-for-banks-ss',
   'Bank of England website terms. Link and summarise; do not republish text', false, 60),
  ('ico_accountability', 'ICO Accountability Framework', 'ICO', 'UK', 'guidance',
   null, 'https://ico.org.uk/for-organisations/accountability-framework/',
   'ICO website terms. Link and summarise; do not republish text', false, 70),
  ('iso_42001', 'ISO/IEC 42001:2023, AI management systems', 'ISO/IEC', 'INT', 'standard',
   null, 'https://www.iso.org/standard/81230.html',
   'Paid standard. Titles and clause numbers only', false, 80)
on conflict (key) do nothing;

-- ---------------------------------------------------------------- seed: requirements

with v (key, src, parent, kind, citation, short_citation, title, summary, evidence, applies_to, juris, tiers, penalty, eff_from, eff_to, official_url, state, ord) as (
  values
  -- EU AI Act
  ('eu_ai_act:art4', 'eu_ai_act', null, 'obligation', 'EU AI Act Article 4', 'Art. 4', 'AI literacy',
   'Providers and deployers take measures to support the AI literacy of staff and others who operate AI on their behalf. As amended by Regulation (EU) 2026/1744, no specific level of literacy has to be guaranteed.',
   'Training and awareness measures for staff who use or oversee AI systems',
   '{provider,deployer}'::text[], '{EU}'::text[], null::text[], null, date '2025-02-02', null::date, null, 'draft', 10),
  ('eu_ai_act:art4a', 'eu_ai_act', null, 'obligation', 'EU AI Act Article 4a', 'Art. 4a', 'Special category data for bias detection',
   'Providers of high-risk systems may process special category personal data to detect and correct bias, only where strictly necessary and with safeguards. Inserted by Regulation (EU) 2026/1744.',
   'Necessity assessment, safeguards and deletion records for special category data used in bias testing',
   '{provider}', '{EU}', '{high}', null, date '2026-07-27', null, null, 'draft', 15),
  ('eu_ai_act:art5', 'eu_ai_act', null, 'obligation', 'EU AI Act Article 5', 'Art. 5', 'Prohibited AI practices',
   'Bans specified AI practices, including manipulative techniques, social scoring and certain biometric uses. A further prohibition on AI practices that generate non-consensual intimate content or child sexual abuse material applies from 2 December 2026 (Regulation (EU) 2026/1744).',
   'A screening record per AI system confirming it uses no prohibited practice',
   '{provider,deployer}', '{EU}', '{prohibited}', 'Up to EUR 35M or 7% of global turnover', date '2025-02-02', null, null, 'draft', 20),
  ('eu_ai_act:art6', 'eu_ai_act', null, 'classification', 'EU AI Act Article 6 and Annex III', 'Art. 6 & Annex III', 'Classification of high-risk AI systems',
   'Sets which AI systems are high-risk, including the uses listed in Annex III. Obligations for Annex III high-risk systems apply from 2 December 2027 and for Annex I products from 2 August 2028 (Regulation (EU) 2026/1744).',
   'A documented classification per AI system, with the reasoning for any Annex III use',
   '{provider,deployer}', '{EU}', '{high}', 'Up to EUR 15M or 3% of global turnover', date '2027-12-02', null, null, 'approved', 30),
  ('eu_ai_act:annex3(4)', 'eu_ai_act', 'eu_ai_act:art6', 'classification', 'EU AI Act Annex III, point 4', 'Annex III(4)', 'Employment and workers management',
   'AI used for recruitment or selection, decisions on promotion or termination, task allocation, or monitoring and evaluating workers is high-risk.',
   'Classification of any HR use, with the deployer duties in Article 26 applied',
   '{provider,deployer}', '{EU}', '{high}', null, date '2027-12-02', null, null, 'draft', 31),
  ('eu_ai_act:annex3(5)(b)', 'eu_ai_act', 'eu_ai_act:art6', 'classification', 'EU AI Act Annex III, point 5(b)', 'Annex III(5)(b)', 'Creditworthiness and credit scoring',
   'AI used to evaluate the creditworthiness of natural persons or establish their credit score is high-risk. AI used to detect financial fraud is excluded.',
   'Classification of any credit use, triggering the fundamental rights impact assessment',
   '{provider,deployer}', '{EU}', '{high}', null, date '2027-12-02', null, null, 'draft', 32),
  ('eu_ai_act:annex3(5)(c)', 'eu_ai_act', 'eu_ai_act:art6', 'classification', 'EU AI Act Annex III, point 5(c)', 'Annex III(5)(c)', 'Life and health insurance risk assessment and pricing',
   'AI used for risk assessment and pricing in relation to natural persons for life and health insurance is high-risk.',
   'Classification of any insurance pricing use, triggering the fundamental rights impact assessment',
   '{provider,deployer}', '{EU}', '{high}', null, date '2027-12-02', null, null, 'draft', 33),
  ('eu_ai_act:art9', 'eu_ai_act', null, 'obligation', 'EU AI Act Article 9', 'Art. 9', 'Risk management system',
   'Providers of high-risk systems establish, document and maintain a risk management system across the lifecycle of the system.',
   'Risk management plan, risk register and test results for the system',
   '{provider}', '{EU}', '{high}', 'Up to EUR 15M or 3% of global turnover', date '2027-12-02', null, null, 'approved', 40),
  ('eu_ai_act:art10', 'eu_ai_act', null, 'obligation', 'EU AI Act Article 10', 'Art. 10', 'Data and data governance',
   'Training, validation and test data for high-risk systems are governed for relevance, representativeness, errors and bias.',
   'Data governance records: sources, preparation and bias examination',
   '{provider}', '{EU}', '{high}', 'Up to EUR 15M or 3% of global turnover', date '2027-12-02', null, null, 'approved', 50),
  ('eu_ai_act:art11', 'eu_ai_act', null, 'obligation', 'EU AI Act Article 11', 'Art. 11', 'Technical documentation',
   'Providers draw up technical documentation before a high-risk system is placed on the market or put into service, and keep it up to date.',
   'Technical documentation covering the elements in Annex IV',
   '{provider}', '{EU}', '{high}', 'Up to EUR 15M or 3% of global turnover', date '2027-12-02', null, null, 'approved', 60),
  ('eu_ai_act:art12', 'eu_ai_act', null, 'obligation', 'EU AI Act Article 12', 'Art. 12', 'Record-keeping',
   'High-risk systems technically allow the automatic recording of events (logs) over the lifetime of the system.',
   'Logging capability and log samples per system',
   '{provider}', '{EU}', '{high}', 'Up to EUR 15M or 3% of global turnover', date '2027-12-02', null, null, 'approved', 70),
  ('eu_ai_act:art13', 'eu_ai_act', null, 'obligation', 'EU AI Act Article 13', 'Art. 13', 'Transparency and provision of information to deployers',
   'High-risk systems are transparent enough for deployers to interpret and use the output, and come with instructions for use.',
   'Instructions for use on file for each high-risk system',
   '{provider}', '{EU}', '{high}', 'Up to EUR 15M or 3% of global turnover', date '2027-12-02', null, null, 'approved', 80),
  ('eu_ai_act:art14', 'eu_ai_act', null, 'obligation', 'EU AI Act Article 14', 'Art. 14', 'Human oversight',
   'High-risk systems are designed so that natural persons can oversee them effectively, including the ability to intervene and stop the system.',
   'Named overseers, a working stop capability and records of interventions',
   '{provider,deployer}', '{EU}', '{high}', 'Up to EUR 15M or 3% of global turnover', date '2027-12-02', null, null, 'approved', 90),
  ('eu_ai_act:art15', 'eu_ai_act', null, 'obligation', 'EU AI Act Article 15', 'Art. 15', 'Accuracy, robustness and cybersecurity',
   'High-risk systems achieve appropriate accuracy, robustness and cybersecurity, including resilience against AI-specific attacks such as data poisoning and adversarial inputs.',
   'Testing records and attack monitoring, including periodic red-team results per system',
   '{provider}', '{EU}', '{high}', 'Up to EUR 15M or 3% of global turnover', date '2027-12-02', null, null, 'approved', 100),
  ('eu_ai_act:art17', 'eu_ai_act', null, 'obligation', 'EU AI Act Article 17', 'Art. 17', 'Quality management system',
   'Providers of high-risk systems put a documented quality management system in place.',
   'Quality management policies and procedures covering the AI lifecycle',
   '{provider}', '{EU}', '{high}', 'Up to EUR 15M or 3% of global turnover', date '2027-12-02', null, null, 'approved', 110),
  ('eu_ai_act:art26', 'eu_ai_act', null, 'obligation', 'EU AI Act Article 26', 'Art. 26', 'Obligations of deployers of high-risk AI systems',
   'Deployers of high-risk systems use them according to the instructions, assign competent human oversight, monitor operation, keep logs, inform workers and affected persons, and use provider information for their DPIA.',
   'Per-system records for each deployer duty',
   '{deployer}', '{EU}', '{high}', 'Up to EUR 15M or 3% of global turnover', date '2027-12-02', null, null, 'approved', 120),
  ('eu_ai_act:art26(1)', 'eu_ai_act', 'eu_ai_act:art26', 'obligation', 'EU AI Act Article 26(1)', 'Art. 26(1)', 'Use according to the instructions for use',
   'Deployers take appropriate technical and organisational measures to use high-risk systems in accordance with the instructions for use.',
   'Provider instructions for use on file; usage matches the intended purpose',
   '{deployer}', '{EU}', '{high}', 'Up to EUR 15M or 3% of global turnover', date '2027-12-02', null, null, 'draft', 121),
  ('eu_ai_act:art26(2)', 'eu_ai_act', 'eu_ai_act:art26', 'obligation', 'EU AI Act Article 26(2)', 'Art. 26(2)', 'Assign human oversight',
   'Deployers assign human oversight to natural persons who have the necessary competence, training and authority, as well as the necessary support.',
   'Named overseer per system with authority to intervene and stop it',
   '{deployer}', '{EU}', '{high}', 'Up to EUR 15M or 3% of global turnover', date '2027-12-02', null, null, 'approved', 122),
  ('eu_ai_act:art26(5)', 'eu_ai_act', 'eu_ai_act:art26', 'obligation', 'EU AI Act Article 26(5)', 'Art. 26(5)', 'Monitor operation and report serious incidents',
   'Deployers monitor the operation of high-risk systems, suspend use and inform the provider and authority where there is a risk, and report serious incidents.',
   'Monitoring records; incident and suspension records with timestamps and notifications',
   '{deployer}', '{EU}', '{high}', 'Up to EUR 15M or 3% of global turnover', date '2027-12-02', null, null, 'draft', 125),
  ('eu_ai_act:art26(6)', 'eu_ai_act', 'eu_ai_act:art26', 'obligation', 'EU AI Act Article 26(6)', 'Art. 26(6)', 'Keep logs for at least six months',
   'Deployers keep the logs automatically generated by high-risk systems under their control for at least six months, unless other law provides otherwise. Financial institutions keep them as part of their financial services documentation.',
   'Retained logs, retrievable per system, with the retention period stated',
   '{deployer}', '{EU}', '{high}', 'Up to EUR 15M or 3% of global turnover', date '2027-12-02', null, null, 'draft', 126),
  ('eu_ai_act:art26(7)', 'eu_ai_act', 'eu_ai_act:art26', 'obligation', 'EU AI Act Article 26(7)', 'Art. 26(7)', 'Inform workers and their representatives',
   'Before putting a high-risk system into use at the workplace, employers inform workers'' representatives and the affected workers.',
   'Notice records for workers and their representatives',
   '{deployer}', '{EU}', '{high}', 'Up to EUR 15M or 3% of global turnover', date '2027-12-02', null, null, 'draft', 127),
  ('eu_ai_act:art26(9)', 'eu_ai_act', 'eu_ai_act:art26', 'obligation', 'EU AI Act Article 26(9)', 'Art. 26(9)', 'Use provider information for the DPIA',
   'Deployers use the information provided under Article 13 to carry out their data protection impact assessment.',
   'DPIA that references the system and the provider''s information',
   '{deployer}', '{EU}', '{high}', 'Up to EUR 15M or 3% of global turnover', date '2027-12-02', null, null, 'draft', 129),
  ('eu_ai_act:art26(11)', 'eu_ai_act', 'eu_ai_act:art26', 'obligation', 'EU AI Act Article 26(11)', 'Art. 26(11)', 'Inform affected persons',
   'Deployers of Annex III systems that make or assist decisions about natural persons inform those persons that they are subject to the use of the system.',
   'Disclosure text and where it is shown to affected persons',
   '{deployer}', '{EU}', '{high}', 'Up to EUR 15M or 3% of global turnover', date '2027-12-02', null, null, 'draft', 131),
  ('eu_ai_act:art27', 'eu_ai_act', null, 'obligation', 'EU AI Act Article 27', 'Art. 27', 'Fundamental rights impact assessment',
   'Before first use, bodies governed by public law, private entities providing public services, and deployers of credit scoring (Annex III point 5(b)) and life and health insurance pricing (Annex III point 5(c)) systems assess the impact on fundamental rights and notify the market surveillance authority.',
   'Fundamental rights impact assessment and the notification record',
   '{deployer}', '{EU}', '{high}', 'Up to EUR 15M or 3% of global turnover', date '2027-12-02', null, null, 'approved', 140),
  ('eu_ai_act:art50', 'eu_ai_act', null, 'obligation', 'EU AI Act Article 50', 'Art. 50', 'Transparency obligations for certain AI systems',
   'People are told when they interact with an AI system, AI-generated content is marked, and deepfakes and AI-generated text published to inform the public are disclosed.',
   'Disclosure and labelling in each customer-facing interface',
   '{provider,deployer}', '{EU}', '{high,limited}', 'Up to EUR 15M or 3% of global turnover', date '2026-08-02', null, null, 'approved', 150),
  ('eu_ai_act:art50(1)', 'eu_ai_act', 'eu_ai_act:art50', 'obligation', 'EU AI Act Article 50(1)', 'Art. 50(1)', 'Disclose AI interaction',
   'Providers design AI systems that interact with people so that the people concerned are informed they are interacting with an AI system, unless obvious.',
   'Disclosure in the interface',
   '{provider}', '{EU}', '{high,limited}', 'Up to EUR 15M or 3% of global turnover', date '2026-08-02', null, null, 'approved', 151),
  ('eu_ai_act:art50(2)', 'eu_ai_act', 'eu_ai_act:art50', 'obligation', 'EU AI Act Article 50(2)', 'Art. 50(2)', 'Mark AI-generated content',
   'Providers of systems that generate synthetic audio, image, video or text mark the output in a machine-readable format as AI-generated. For systems already on the market, the grace period ends on 2 December 2026.',
   'Machine-readable marking of generated output',
   '{provider}', '{EU}', '{high,limited}', 'Up to EUR 15M or 3% of global turnover', date '2026-08-02', null, null, 'approved', 152),
  ('eu_ai_act:art50(4)', 'eu_ai_act', 'eu_ai_act:art50', 'obligation', 'EU AI Act Article 50(4)', 'Art. 50(4)', 'Disclose deepfakes and AI-generated public text',
   'Deployers disclose deepfakes, and AI-generated or manipulated text published to inform the public on matters of public interest, unless it has had human review and editorial responsibility.',
   'Labelling of deepfakes and published AI-generated text',
   '{deployer}', '{EU}', '{high,limited}', 'Up to EUR 15M or 3% of global turnover', date '2026-08-02', null, null, 'approved', 154),
  ('eu_ai_act:art86', 'eu_ai_act', null, 'obligation', 'EU AI Act Article 86', 'Art. 86', 'Right to explanation of individual decision-making',
   'A person affected by a decision based on the output of an Annex III high-risk system, with legal or similarly significant effects, can obtain a clear and meaningful explanation from the deployer.',
   'An explanation process and records of requests and responses',
   '{deployer}', '{EU}', '{high}', null, date '2027-12-02', null, null, 'draft', 160),
  ('eu_ai_act:art99', 'eu_ai_act', null, 'penalty', 'EU AI Act Article 99', 'Art. 99', 'Penalties',
   'Fines of up to EUR 35M or 7% of worldwide turnover for prohibited practices, up to EUR 15M or 3% for other obligations, and up to EUR 7.5M or 1% for supplying incorrect information to authorities.',
   null,
   '{provider,deployer}', '{EU}', null, null, date '2025-08-02', null, null, 'approved', 170),

  -- UK GDPR
  ('uk_gdpr:art5', 'uk_gdpr', null, 'obligation', 'UK GDPR Article 5', 'Art. 5', 'Principles relating to processing of personal data',
   'Personal data is processed lawfully, fairly and transparently, for specified purposes, minimised, accurate, kept no longer than needed and secure, and the controller can show compliance.',
   'Records showing minimisation and purpose limitation, including controls on personal data sent to AI providers',
   '{controller}', '{UK}', null, 'Up to GBP 17.5M or 4% of global turnover', date '2021-01-01', null,
   'https://www.legislation.gov.uk/eur/2016/679/article/5', 'approved', 10),
  ('uk_gdpr:art6', 'uk_gdpr', null, 'obligation', 'UK GDPR Article 6', 'Art. 6', 'Lawfulness of processing',
   'Processing needs a lawful basis. From 5 February 2026 the bases include recognised legitimate interests (Article 6(1)(ea)).',
   'Lawful basis recorded for each processing activity involving AI',
   '{controller}', '{UK}', null, 'Up to GBP 17.5M or 4% of global turnover', date '2021-01-01', null,
   'https://www.legislation.gov.uk/eur/2016/679/article/6', 'approved', 20),
  ('uk_gdpr:art13-14', 'uk_gdpr', null, 'obligation', 'UK GDPR Articles 13 and 14', 'Arts. 13-14', 'Information to be provided to data subjects',
   'Controllers tell people how their personal data is used, including the existence of automated decision-making and meaningful information about the logic involved.',
   'Privacy notices that describe AI use and automated decisions',
   '{controller}', '{UK}', null, 'Up to GBP 17.5M or 4% of global turnover', date '2021-01-01', null,
   'https://www.legislation.gov.uk/eur/2016/679/article/13', 'approved', 30),
  ('uk_gdpr:art22', 'uk_gdpr', null, 'obligation', 'UK GDPR Article 22 (before 5 February 2026)', 'Art. 22', 'Automated individual decision-making (replaced)',
   'Restricted decisions based solely on automated processing with legal or similarly significant effects. Replaced by Articles 22A to 22D from 5 February 2026; still governs decisions taken before that date.',
   'Exception relied on, and safeguards, for decisions taken before 5 February 2026',
   '{controller}', '{UK}', null, 'Up to GBP 17.5M or 4% of global turnover', date '2021-01-01', date '2026-02-04',
   'https://www.legislation.gov.uk/eur/2016/679/article/22/2026-02-04', 'approved', 40),
  ('uk_gdpr:art22a-22d', 'uk_gdpr', null, 'obligation', 'UK GDPR Articles 22A to 22D', 'Arts. 22A to 22D', 'Automated decision-making safeguards',
   'Significant decisions based solely on automated processing are permitted for non-special-category data, subject to safeguards: inform the person, let them make representations, offer human intervention and let them contest the decision. Inserted by the Data (Use and Access) Act 2025 s.80.',
   'Which systems make significant decisions, and evidence for each of the four safeguards',
   '{controller}', '{UK}', null, 'Up to GBP 17.5M or 4% of global turnover', date '2026-02-05', null,
   'https://www.legislation.gov.uk/eur/2016/679/chapter/III/section/4A', 'approved', 41),
  ('uk_gdpr:art22b', 'uk_gdpr', 'uk_gdpr:art22a-22d', 'obligation', 'UK GDPR Article 22B', 'Art. 22B', 'Restrictions on decisions based on special category data',
   'Significant decisions based solely on automated processing of special category data are only allowed under narrow conditions.',
   'Confirmation, per system, of whether special category data feeds significant decisions',
   '{controller}', '{UK}', null, 'Up to GBP 17.5M or 4% of global turnover', date '2026-02-05', null,
   'https://www.legislation.gov.uk/eur/2016/679/article/22B', 'draft', 42),
  ('uk_gdpr:art22c', 'uk_gdpr', 'uk_gdpr:art22a-22d', 'obligation', 'UK GDPR Article 22C', 'Art. 22C', 'Safeguards for automated decision-making',
   'Controllers that take significant decisions based solely on automated processing put safeguards in place: information, representations, human intervention and the right to contest.',
   'Proof of each safeguard: information, representations, human intervention, contest',
   '{controller}', '{UK}', null, 'Up to GBP 17.5M or 4% of global turnover', date '2026-02-05', null,
   'https://www.legislation.gov.uk/eur/2016/679/article/22C', 'draft', 43),
  ('uk_gdpr:art25', 'uk_gdpr', null, 'obligation', 'UK GDPR Article 25', 'Art. 25', 'Data protection by design and by default',
   'Controllers build data protection into the design of processing and, by default, process only the personal data needed.',
   'Design records showing privacy controls in AI systems',
   '{controller}', '{UK}', null, 'Up to GBP 8.7M or 2% of global turnover', date '2021-01-01', null,
   'https://www.legislation.gov.uk/eur/2016/679/article/25', 'approved', 50),
  ('uk_gdpr:art28', 'uk_gdpr', null, 'obligation', 'UK GDPR Article 28', 'Art. 28', 'Processors',
   'Controllers use only processors that give sufficient guarantees, under a contract with the required terms.',
   'Processor terms with AI providers, linked to the assets that use them',
   '{controller,processor}', '{UK}', null, 'Up to GBP 8.7M or 2% of global turnover', date '2021-01-01', null,
   'https://www.legislation.gov.uk/eur/2016/679/article/28', 'draft', 60),
  ('uk_gdpr:art30', 'uk_gdpr', null, 'obligation', 'UK GDPR Article 30', 'Art. 30', 'Records of processing activities',
   'Controllers and processors keep records of their processing activities.',
   'Records of processing that include AI systems',
   '{controller,processor}', '{UK}', null, 'Up to GBP 8.7M or 2% of global turnover', date '2021-01-01', null,
   'https://www.legislation.gov.uk/eur/2016/679/article/30', 'draft', 70),
  ('uk_gdpr:art32', 'uk_gdpr', null, 'obligation', 'UK GDPR Article 32', 'Art. 32', 'Security of processing',
   'Controllers and processors implement security appropriate to the risk.',
   'Technical controls that stop unnecessary personal data reaching AI providers',
   '{controller,processor}', '{UK}', null, 'Up to GBP 8.7M or 2% of global turnover', date '2021-01-01', null,
   'https://www.legislation.gov.uk/eur/2016/679/article/32', 'draft', 80),
  ('uk_gdpr:art35', 'uk_gdpr', null, 'obligation', 'UK GDPR Article 35', 'Art. 35', 'Data protection impact assessment',
   'Controllers assess processing likely to result in a high risk to individuals before it starts.',
   'DPIA per high-risk processing, attached and dated on the asset',
   '{controller}', '{UK}', null, 'Up to GBP 8.7M or 2% of global turnover', date '2021-01-01', null,
   'https://www.legislation.gov.uk/eur/2016/679/article/35', 'approved', 90),
  ('uk_gdpr:chapter5', 'uk_gdpr', null, 'obligation', 'UK GDPR Chapter V', 'Ch. V', 'Transfers of personal data outside the UK',
   'Transfers of personal data outside the UK need adequacy regulations or appropriate safeguards. From 5 February 2026 safeguards are assessed against the data protection test inserted by the Data (Use and Access) Act 2025.',
   'Where personal data is processed, by whom and under what transfer mechanism',
   '{controller,processor}', '{UK}', null, 'Up to GBP 17.5M or 4% of global turnover', date '2021-01-01', null,
   'https://www.legislation.gov.uk/eur/2016/679/chapter/V', 'draft', 100),

  -- UK Acts
  ('uk_dpa_2018:s164a', 'uk_dpa_2018', null, 'obligation', 'Data Protection Act 2018 section 164A', 's.164A', 'Complaints to controllers',
   'Controllers facilitate data protection complaints and acknowledge them within 30 days.',
   'Complaint log with acknowledgement dates',
   '{controller}', '{UK}', null, null, date '2026-06-19', null,
   'https://www.legislation.gov.uk/ukpga/2018/12/section/164A', 'draft', 10),
  ('uk_fsma_2000:s19', 'uk_fsma_2000', null, 'obligation', 'Financial Services and Markets Act 2000 section 19', 's.19', 'The general prohibition',
   'Only authorised or exempt persons may carry on regulated activities, which include advising on investments. AI agents that give customers personalised recommendations can fall within the perimeter.',
   'Evidence that agents do not give unauthorised regulated advice',
   '{fca_firm}', '{UK}', null, null, date '2001-12-01', null,
   'https://www.legislation.gov.uk/ukpga/2000/8/section/19', 'draft', 10),

  -- EU GDPR
  ('eu_gdpr:art5', 'eu_gdpr', null, 'obligation', 'EU GDPR Article 5', 'Art. 5', 'Principles relating to processing of personal data',
   'Personal data is processed lawfully, fairly and transparently, for specified purposes, minimised, accurate, kept no longer than needed and secure, and the controller can show compliance.',
   'Records showing minimisation and purpose limitation, including controls on personal data sent to AI providers',
   '{controller}', '{EU}', null, 'Up to EUR 20M or 4% of global turnover', date '2018-05-25', null, null, 'draft', 10),
  ('eu_gdpr:art22', 'eu_gdpr', null, 'obligation', 'EU GDPR Article 22', 'Art. 22', 'Automated individual decision-making',
   'People have the right not to be subject to decisions based solely on automated processing with legal or similarly significant effects, except where necessary for a contract, authorised by law or based on explicit consent, with safeguards.',
   'Exception relied on, and the safeguards in place, per system',
   '{controller}', '{EU}', null, 'Up to EUR 20M or 4% of global turnover', date '2018-05-25', null, null, 'approved', 20),
  ('eu_gdpr:art32', 'eu_gdpr', null, 'obligation', 'EU GDPR Article 32', 'Art. 32', 'Security of processing',
   'Controllers and processors implement security appropriate to the risk.',
   'Technical controls that stop unnecessary personal data reaching AI providers',
   '{controller,processor}', '{EU}', null, 'Up to EUR 10M or 2% of global turnover', date '2018-05-25', null, null, 'draft', 30),
  ('eu_gdpr:art35', 'eu_gdpr', null, 'obligation', 'EU GDPR Article 35', 'Art. 35', 'Data protection impact assessment',
   'Controllers assess processing likely to result in a high risk to individuals before it starts.',
   'DPIA per high-risk processing, attached and dated on the asset',
   '{controller}', '{EU}', null, 'Up to EUR 10M or 2% of global turnover', date '2018-05-25', null, null, 'draft', 40),
  ('eu_gdpr:chapter5', 'eu_gdpr', null, 'obligation', 'EU GDPR Chapter V', 'Ch. V', 'Transfers of personal data to third countries',
   'Transfers of personal data outside the EEA need an adequacy decision or appropriate safeguards.',
   'Where personal data is processed, by whom and under what transfer mechanism',
   '{controller,processor}', '{EU}', null, 'Up to EUR 20M or 4% of global turnover', date '2018-05-25', null, null, 'draft', 50),

  -- DORA
  ('eu_dora:art17', 'eu_dora', null, 'obligation', 'DORA Article 17', 'Art. 17', 'ICT-related incident management process',
   'Financial entities define and implement a process to detect, manage and notify ICT-related incidents.',
   'Incident records with classification, linked to the AI systems involved',
   '{eu_financial_entity}', '{EU}', null, null, date '2025-01-17', null, null, 'draft', 10),
  ('eu_dora:art19', 'eu_dora', null, 'obligation', 'DORA Article 19', 'Art. 19', 'Reporting of major ICT-related incidents',
   'Financial entities report major ICT-related incidents to their competent authority.',
   'Classification and reporting records for major incidents',
   '{eu_financial_entity}', '{EU}', null, null, date '2025-01-17', null, null, 'draft', 20),
  ('eu_dora:art28', 'eu_dora', null, 'obligation', 'DORA Article 28', 'Art. 28', 'ICT third-party risk management',
   'Financial entities manage ICT third-party risk as part of their ICT risk framework and keep a register of information on all contractual arrangements with ICT third-party service providers.',
   'Register of information listing AI providers and the functions they support',
   '{eu_financial_entity}', '{EU}', null, null, date '2025-01-17', null, null, 'approved', 30),

  -- FCA
  ('fca:ai_approach', 'fca_ai_approach', null, 'expectation', 'FCA AI Update (April 2024) and AI approach', 'FCA AI approach', 'FCA approach to AI in financial services',
   'The FCA regulates AI through its existing rules rather than AI-specific ones: Consumer Duty, SM&CR, systems and controls, operational resilience and outsourcing.',
   'Mapping of each AI system to the FCA rules that apply to it',
   '{fca_firm}', '{UK}', null, null, date '2024-04-22', null, null, 'approved', 10),
  ('fca:ai_good_practice', 'fca_ai_good_practice', null, 'expectation', 'FCA AI in financial services: good practice and areas for improvement', 'FCA AI good practice', 'FCA good practice on AI',
   'The FCA expects firms to define the need and target market, test outcomes across customer groups, control bias and accuracy, explain decisions, tell consumers about AI use, monitor live outcomes and name an accountable senior manager.',
   'Evidence against each published good practice',
   '{fca_firm}', '{UK}', null, null, null, null, null, 'draft', 20),
  ('fca:prin2a', 'fca_handbook', null, 'obligation', 'FCA Consumer Duty (PRIN 2A)', 'PRIN 2A', 'Consumer Duty',
   'Firms act to deliver good outcomes for retail customers, avoid causing foreseeable harm and monitor outcomes for products and services, price and value, consumer understanding and consumer support.',
   'Outcome monitoring by customer group and evidence of acting on poor outcomes',
   '{fca_firm}', '{UK}', null, null, date '2023-07-31', null,
   'https://www.handbook.fca.org.uk/handbook/PRIN/2A', 'approved', 30),
  ('fca:smcr', 'fca_handbook', null, 'obligation', 'FCA Senior Managers and Certification Regime (SM&CR)', 'SM&CR', 'Senior manager accountability',
   'A named senior manager is responsible for each area of the firm''s activities, including the use of AI, recorded in a responsibilities map.',
   'Named senior manager and responsibilities map entry for AI use',
   '{fca_firm}', '{UK}', null, 'Individual sanctions, including prohibition from regulated activity', date '2019-12-09', null,
   'https://www.fca.org.uk/firms/senior-managers-certification-regime', 'approved', 40),
  ('fca:sysc4', 'fca_handbook', null, 'obligation', 'FCA SYSC 4', 'SYSC 4', 'General organisational requirements',
   'Firms have robust governance arrangements, with a clear organisational structure, effective risk management processes and internal control mechanisms.',
   'AI governance policy, ownership and control inventory',
   '{fca_firm}', '{UK}', null, null, null, null,
   'https://www.handbook.fca.org.uk/handbook/SYSC/4', 'approved', 50),
  ('fca:sysc8', 'fca_handbook', null, 'obligation', 'FCA SYSC 8', 'SYSC 8', 'Outsourcing',
   'Firms that outsource critical or important functions take reasonable steps to avoid undue additional operational risk and keep control of the outsourced activity.',
   'Third-party risk assessment for each AI provider',
   '{fca_firm}', '{UK}', null, null, null, null,
   'https://www.handbook.fca.org.uk/handbook/SYSC/8', 'approved', 60),
  ('fca:sysc15a', 'fca_handbook', null, 'obligation', 'FCA SYSC 15A', 'SYSC 15A', 'Operational resilience',
   'Firms identify important business services, set impact tolerances and are able to remain within them in severe but plausible disruption.',
   'Impact tolerance for services that rely on AI; provider concentration view and fallback plan',
   '{fca_firm}', '{UK}', null, null, date '2022-03-31', null,
   'https://www.handbook.fca.org.uk/handbook/SYSC/15A', 'draft', 70),
  ('fca:disp1', 'fca_handbook', null, 'obligation', 'FCA DISP 1', 'DISP 1', 'Complaint handling',
   'Firms handle complaints promptly and fairly, and analyse root causes.',
   'Complaints linked to the AI system involved, with root cause analysis',
   '{fca_firm}', '{UK}', null, null, null, null,
   'https://www.handbook.fca.org.uk/handbook/DISP/1', 'draft', 80),
  ('fca:fg21_1', 'fca_fg21_1', null, 'expectation', 'FCA FG21/1', 'FG21/1', 'Fair treatment of vulnerable customers',
   'Firms understand the needs of vulnerable customers and make sure they receive outcomes as good as other customers, including in automated journeys.',
   'Vulnerability signals and outcomes monitored in customer-facing AI',
   '{fca_firm}', '{UK}', null, null, date '2021-02-23', null, null, 'draft', 90),

  -- PRA
  ('pra:ss1_23', 'pra_ss1_23', null, 'expectation', 'PRA SS1/23', 'SS1/23', 'Model risk management principles for banks',
   'Banks identify and inventory their models, tier them by risk, validate them independently, control changes and monitor performance.',
   'Model inventory with tiers, validation records and a change log',
   '{pra_bank}', '{UK}', null, null, date '2024-05-17', null, null, 'approved', 10),

  -- ICO
  ('ico:accountability_framework', 'ico_accountability', null, 'expectation', 'ICO Accountability Framework', 'ICO Accountability Framework', 'Accountability framework',
   'The ICO''s framework for showing compliance: leadership and oversight, policies, training, records, risk assessment and monitoring.',
   'Policies, ownership and monitoring records for AI processing',
   '{controller}', '{UK}', null, null, null, null, null, 'approved', 10),

  -- ISO/IEC 42001
  ('iso_42001:cl6-9', 'iso_42001', null, 'benchmark', 'ISO/IEC 42001:2023 clauses 6 to 9', 'Clauses 6-9', 'AI management system: planning, support, operation and evaluation',
   'Planning and risk assessment (clause 6), support (7), operation including AI system impact assessment (8), and performance evaluation (9). A certification benchmark, not law.',
   'AI risk assessment, impact assessments and monitoring records',
   '{provider,deployer}', '{EU,UK}', null, null, date '2023-12-18', null, null, 'approved', 10)
)
insert into reg.requirements (
  key, source_id, kind, citation, short_citation, title, summary, evidence_expected,
  applies_to, jurisdictions, risk_tiers, penalty, effective_from, effective_to, official_url,
  review_state, reviewed_at, display_order
)
select v.key, s.id, v.kind, v.citation, v.short_citation, v.title, v.summary, v.evidence,
       v.applies_to, v.juris, v.tiers, v.penalty, v.eff_from, v.eff_to, v.official_url,
       v.state, case when v.state = 'approved' then now() end, v.ord
from v
join reg.sources s on s.key = v.src
on conflict (key) do nothing;

-- Parents and supersession, by key.
update reg.requirements r
set parent_id = p.id
from (values
  ('eu_ai_act:annex3(4)', 'eu_ai_act:art6'),
  ('eu_ai_act:annex3(5)(b)', 'eu_ai_act:art6'),
  ('eu_ai_act:annex3(5)(c)', 'eu_ai_act:art6'),
  ('eu_ai_act:art26(1)', 'eu_ai_act:art26'),
  ('eu_ai_act:art26(2)', 'eu_ai_act:art26'),
  ('eu_ai_act:art26(5)', 'eu_ai_act:art26'),
  ('eu_ai_act:art26(6)', 'eu_ai_act:art26'),
  ('eu_ai_act:art26(7)', 'eu_ai_act:art26'),
  ('eu_ai_act:art26(9)', 'eu_ai_act:art26'),
  ('eu_ai_act:art26(11)', 'eu_ai_act:art26'),
  ('eu_ai_act:art50(1)', 'eu_ai_act:art50'),
  ('eu_ai_act:art50(2)', 'eu_ai_act:art50'),
  ('eu_ai_act:art50(4)', 'eu_ai_act:art50'),
  ('uk_gdpr:art22b', 'uk_gdpr:art22a-22d'),
  ('uk_gdpr:art22c', 'uk_gdpr:art22a-22d')
) as l (child, parent)
join reg.requirements p on p.key = l.parent
where r.key = l.child and r.parent_id is null;

update reg.requirements r
set superseded_by = n.id
from reg.requirements n
where r.key = 'uk_gdpr:art22' and n.key = 'uk_gdpr:art22a-22d' and r.superseded_by is null;

-- ---------------------------------------------------------------- read surface (public)

create or replace function public.reg_requirements(
  p_as_of date default current_date,
  p_include_pending boolean default true
)
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
  source_key text,
  source_title text,
  source_url text,
  has_text boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.key, p.key, r.kind, r.citation, r.short_citation, r.title, r.summary, r.evidence_expected,
         r.applies_to, r.jurisdictions, r.risk_tiers, r.penalty, r.effective_from, r.effective_to,
         case
           when r.effective_to is not null and r.effective_to < p_as_of then 'repealed'
           when r.effective_from is not null and r.effective_from > p_as_of then 'pending'
           else 'in_force'
         end,
         sb.key, coalesce(r.official_url, s.url), s.key, s.title, s.url, r.captured_text is not null
  from reg.requirements r
  join reg.sources s on s.id = r.source_id
  left join reg.requirements p on p.id = r.parent_id
  left join reg.requirements sb on sb.id = r.superseded_by
  where r.review_state = 'approved'
    and (r.effective_to is null or r.effective_to >= p_as_of)
    and (p_include_pending or r.effective_from is null or r.effective_from <= p_as_of)
  order by s.display_order, r.display_order, r.key;
$$;

comment on function public.reg_requirements(date, boolean) is
  'Approved requirements applicable on a date, with status in_force or pending. Published read surface of the reg registry.';

create or replace function public.reg_requirements_by_keys(p_keys text[])
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
  source_key text,
  source_title text,
  source_url text,
  captured_text text,
  captured_url text,
  captured_at timestamptz,
  licence text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.key, p.key, r.kind, r.citation, r.short_citation, r.title, r.summary, r.evidence_expected,
         r.applies_to, r.jurisdictions, r.risk_tiers, r.penalty, r.effective_from, r.effective_to,
         case
           when r.effective_to is not null and r.effective_to < current_date then 'repealed'
           when r.effective_from is not null and r.effective_from > current_date then 'pending'
           else 'in_force'
         end,
         sb.key, coalesce(r.official_url, s.url), s.key, s.title, s.url,
         case when s.redistributable then r.captured_text end,
         case when s.redistributable then r.captured_url end,
         case when s.redistributable then r.captured_at end,
         s.licence
  from reg.requirements r
  join reg.sources s on s.id = r.source_id
  left join reg.requirements p on p.id = r.parent_id
  left join reg.requirements sb on sb.id = r.superseded_by
  where r.review_state in ('approved', 'retired')
    and r.key = any (p_keys)
  order by s.display_order, r.display_order, r.key;
$$;

comment on function public.reg_requirements_by_keys(text[]) is
  'Approved or retired requirements by key, any date, with captured text where the licence allows. For reports and dossiers that cite a fixed set.';

revoke all on function public.reg_requirements(date, boolean) from public;
revoke all on function public.reg_requirements_by_keys(text[]) from public;
grant execute on function public.reg_requirements(date, boolean) to anon, authenticated, service_role;
grant execute on function public.reg_requirements_by_keys(text[]) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- RegAnchor links (public points into reg)

alter table public.compliance_frameworks
  add column if not exists requirement_id uuid null references reg.requirements (id) on delete set null;

comment on column public.compliance_frameworks.requirement_id is
  'Registry requirement this obligation is RegAnchor''s reading of. Citation text moves to the registry in phase 1c.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'control_requirement_map_requirement_id_fkey'
      and conrelid = 'public.control_requirement_map'::regclass
  ) then
    alter table public.control_requirement_map
      add constraint control_requirement_map_requirement_id_fkey
      foreign key (requirement_id) references reg.requirements (id) on delete set null;
  end if;
end;
$$;

comment on column public.control_requirement_map.requirement_id is
  'Registry requirement for this map row (reg.requirements).';

create table if not exists public.requirement_citations (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references reg.requirements (id) on delete cascade,
  target_type text not null check (target_type in (
    'assessment_section', 'assessment_question', 'diagnostic_reg', 'diagnostic_question',
    'diagnostic_flag', 'guardrail', 'report_text'
  )),
  target_key text not null,
  is_primary boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint requirement_citations_unique unique (requirement_id, target_type, target_key)
);

create index if not exists requirement_citations_target_idx
  on public.requirement_citations (target_type, target_key);

comment on table public.requirement_citations is
  'Where RegAnchor cites a registry requirement: assessment sections, diagnostic rows and flags, guardrails, report text. RegAnchor data, not registry data.';

alter table public.requirement_citations enable row level security;

drop policy if exists rc_select on public.requirement_citations;
create policy rc_select
  on public.requirement_citations
  for select
  to anon, authenticated
  using (true);

drop policy if exists rc_mla_admin_write on public.requirement_citations;
create policy rc_mla_admin_write
  on public.requirement_citations
  for all
  to authenticated
  using (public.is_mla_admin())
  with check (public.is_mla_admin());

grant select on public.requirement_citations to anon, authenticated;
grant insert, update, delete on public.requirement_citations to authenticated;

-- Obligations to requirements (one to one).
update public.compliance_frameworks f
set requirement_id = r.id
from (values
  ('euaia_art9', 'eu_ai_act:art9'),
  ('euaia_art10', 'eu_ai_act:art10'),
  ('euaia_art11', 'eu_ai_act:art11'),
  ('euaia_art12', 'eu_ai_act:art12'),
  ('euaia_art13', 'eu_ai_act:art13'),
  ('euaia_art14', 'eu_ai_act:art14'),
  ('euaia_art15', 'eu_ai_act:art15'),
  ('euaia_art17', 'eu_ai_act:art17'),
  ('euaia_art26', 'eu_ai_act:art26'),
  ('euaia_art27', 'eu_ai_act:art27'),
  ('euaia_art50_1', 'eu_ai_act:art50(1)'),
  ('euaia_art50_2', 'eu_ai_act:art50(2)'),
  ('euaia_art50_4', 'eu_ai_act:art50(4)'),
  ('eugdpr_art22', 'eu_gdpr:art22'),
  ('fca_ai_approach', 'fca:ai_approach'),
  ('fca_consumer_duty', 'fca:prin2a'),
  ('pra_ss1_23', 'pra:ss1_23'),
  ('ukgdpr_art5', 'uk_gdpr:art5'),
  ('ukgdpr_art6', 'uk_gdpr:art6'),
  ('ukgdpr_art22a_d', 'uk_gdpr:art22a-22d'),
  ('ukgdpr_art25', 'uk_gdpr:art25'),
  ('ukgdpr_art35', 'uk_gdpr:art35')
) as l (obligation_key, requirement_key)
join reg.requirements r on r.key = l.requirement_key
where f.obligation_key = l.obligation_key and f.requirement_id is null;

-- Control map rows take the requirement of their obligation.
update public.control_requirement_map m
set requirement_id = f.requirement_id
from public.compliance_frameworks f
where f.id = m.obligation_id
  and f.requirement_id is not null
  and m.requirement_id is null;

-- Assessment section bases and diagnostic rows, as citations.
insert into public.requirement_citations (requirement_id, target_type, target_key, is_primary, display_order)
select r.id, l.target_type, l.target_key, l.is_primary, l.ord
from (values
  ('assessment_section', 's1', 'eu_ai_act:art6', true, 10),
  ('assessment_section', 's2', 'uk_gdpr:art5', true, 10),
  ('assessment_section', 's2', 'uk_gdpr:art6', false, 20),
  ('assessment_section', 's2', 'uk_gdpr:art25', false, 30),
  ('assessment_section', 's2', 'uk_gdpr:art35', false, 40),
  ('assessment_section', 's2', 'eu_ai_act:art10', false, 50),
  ('assessment_section', 's3', 'eu_ai_act:art13', true, 10),
  ('assessment_section', 's3', 'eu_ai_act:art50', false, 20),
  ('assessment_section', 's3', 'uk_gdpr:art22a-22d', false, 30),
  ('assessment_section', 's3', 'eu_gdpr:art22', false, 40),
  ('assessment_section', 's4', 'eu_ai_act:art14', true, 10),
  ('assessment_section', 's4', 'eu_ai_act:art26(2)', false, 20),
  ('assessment_section', 's4', 'uk_gdpr:art22a-22d', false, 30),
  ('assessment_section', 's5', 'eu_ai_act:art15', true, 10),
  ('assessment_section', 's6', 'eu_ai_act:art9', true, 10),
  ('assessment_section', 's6', 'eu_ai_act:art11', false, 20),
  ('assessment_section', 's6', 'eu_ai_act:art17', false, 30),
  ('assessment_section', 's6', 'eu_ai_act:art26', false, 40),
  ('assessment_section', 's6', 'fca:smcr', false, 50),
  ('assessment_section', 's7', 'eu_ai_act:art26', true, 10),
  ('assessment_section', 's7', 'fca:sysc8', false, 20),
  ('assessment_section', 's7', 'eu_dora:art28', false, 30),
  ('diagnostic_flag', 'pf_governance', 'fca:smcr', true, 10),
  ('diagnostic_flag', 'pf_governance', 'eu_ai_act:art26(2)', false, 20),
  ('diagnostic_flag', 'pf_oversight', 'uk_gdpr:art22a-22d', true, 10),
  ('diagnostic_flag', 'pf_oversight', 'eu_ai_act:art14', false, 20),
  ('diagnostic_flag', 'pf_no_policy', 'ico:accountability_framework', true, 10),
  ('diagnostic_flag', 'pf_no_policy', 'fca:sysc4', false, 20)
) as l (target_type, target_key, requirement_key, is_primary, ord)
join reg.requirements r on r.key = l.requirement_key
on conflict (requirement_id, target_type, target_key) do nothing;

-- Diagnostic overview rows, keyed by row id (matched here on their current display order).
insert into public.requirement_citations (requirement_id, target_type, target_key, is_primary, display_order)
select r.id, 'diagnostic_reg', d.id::text, l.is_primary, l.ord
from (values
  (10, 'eu_ai_act:art6', true, 10),
  (20, 'eu_ai_act:art14', true, 10),
  (30, 'eu_ai_act:art13', true, 10),
  (30, 'eu_ai_act:art12', false, 20),
  (40, 'eu_ai_act:art27', true, 10),
  (50, 'uk_gdpr:art35', true, 10),
  (60, 'uk_gdpr:art22a-22d', true, 10),
  (70, 'uk_gdpr:art13-14', true, 10),
  (80, 'fca:smcr', true, 10),
  (90, 'iso_42001:cl6-9', true, 10)
) as l (reg_order, requirement_key, is_primary, ord)
join public.diagnostic_regs d on d.display_order = l.reg_order and d.is_active
join reg.requirements r on r.key = l.requirement_key
on conflict (requirement_id, target_type, target_key) do nothing;
