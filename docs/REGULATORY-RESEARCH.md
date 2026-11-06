# Regulatory research: controls, monitoring and keeping current

Status: research, 4 Nov 2026. Not legal advice. Article references were checked against the sources linked in section 7 where marked "checked"; the rest are from working knowledge and should be checked before they are used in marketing or reports.

Purpose:

1. Record what has changed in the law since the methodology and risk diagnostic were built (March 2026).
2. Map each regulatory expectation to the evidence a supervisor would ask for, and to what RegAnchor produces today.
3. List the gaps worth building, and separate regulatory controls from nice-to-have safety features.
4. Propose a way to keep the regulatory library current without reworking the product each time the law moves.

---

## 1. What changed since March 2026

| Date | Change | Effect on RegAnchor | Checked |
|---|---|---|---|
| 5 Feb 2026 | UK GDPR Article 22 replaced by Articles 22A to 22D (Data (Use and Access) Act 2025 s.80, commenced by SI 2026/82). Solely automated significant decisions are now permitted for non-special-category data, subject to safeguards: tell the person, let them make representations, offer human intervention, let them contest. Special category data stays restricted (22B). Old Article 22 still governs decisions taken before 5 Feb 2026. | Library obligation `ukgdpr_art22`, control map rows for control 5, assessment section s3 basis ("UK GDPR Article 22") and the report generator (`pf_oversight`, "UK GDPR Art. 22") cite a provision that no longer exists in that form. The control is still right; the citation and the expected evidence change: evidence of the four safeguards, not of an exception. | Yes |
| 5 Feb 2026 | Other DUAA changes in force: recognised legitimate interests (Article 6(1)(ea)), new test for international transfers, subject access time limits (Article 12A). From 19 Jun 2026, controllers must acknowledge data protection complaints within 30 days (DPA 2018 s.164A). | Transfer evidence (where a model runs) and complaint handling are now more concrete asks. | Yes |
| 27 Jul 2026 | EU AI Act amended by Regulation (EU) 2026/1744 (the AI Omnibus). Annex III high-risk obligations now apply from 2 Dec 2027 (was 2 Aug 2026); Annex I product high-risk from 2 Aug 2028. | Any date shown to clients for high-risk deployer duties (Article 26, 27, 86) must move to 2 Dec 2027. | Yes |
| 27 Jul 2026 | Article 4 (AI literacy) rewritten: providers and deployers "take measures to support" AI literacy; no specific level of literacy has to be guaranteed. | Softer wording. Assessment question q4_3 (training) still useful, but scoring should not imply a hard legal duty to certify literacy. | Yes |
| 27 Jul 2026 | New Article 4a: providers of high-risk systems may process special category data for bias detection under strict necessity and safeguards. | Relevant to control 7 for clients that build (not only deploy) high-risk systems. | Yes |
| 2 Dec 2026 | New prohibition on AI practices generating non-consensual intimate content or child sexual abuse material applies. Content-marking (Article 50(2)) grace period for systems already on the market ends. | Prohibited-practice screening in the registry should include the new item. | Yes |
| 2 Aug 2026 | General application date of the AI Act, including Article 50 transparency duties. | Article 50 is live now, not future. | Yes |
| 2026 | FCA: still no AI-specific rules. Relies on Consumer Duty, SM&CR, SYSC, operational resilience, outsourcing and critical third parties, DISP. Published good and poor practice on AI in financial services; AI Live Testing cohort 2 from late April 2026, evaluation report due Q1 2027. | The FCA's own published expectations are the best source for FCA-facing controls: define need and target market, test outcomes across customer groups, control bias and accuracy, explain decisions, tell consumers about AI use, monitor live outcomes, named senior manager accountability. | Yes |

### Errors found in the current library

These are in production data (`compliance_frameworks`, `control_requirement_map`) or code, and are worth fixing regardless of anything else in this document.

1. **`fca_fg24_5` is mislabelled.** FG24/5 is "Prudential assessment of acquisitions and increases in control" (FCA, 1 Nov 2024), not AI guidance. The FCA's AI position is set out in its 2024 AI Update and the AI approach and good practice pages. Checked.
2. **`fca_ss1_23` is filed under the FCA.** SS1/23 (model risk management principles for banks) is a PRA supervisory statement. It applies to PRA-regulated banks; the FCA does not issue it.
3. **`ukgdpr_art22`** needs to become Articles 22A to 22D (see above), with old Article 22 kept only for decisions before 5 Feb 2026.
4. **Report generator, `pf_governance`,** cites "EU AI Act Art. 27" for named accountability. Article 27 is the fundamental rights impact assessment. It is very relevant to financial services (it applies to deployers of credit scoring and life and health insurance pricing systems), but it is not the basis for named accountability. For UK firms the basis is SM&CR; for the AI Act, deployer duties in Article 26(2) (assign human oversight to competent people) are closer.
5. **No EU GDPR entries.** The library has UK GDPR only. EU clients are under EU GDPR, where Article 22 is unchanged.
6. **Missing regimes** for financial services: DORA (EU), SYSC 8 outsourcing and SYSC 15A operational resilience (UK), DISP complaints, FG21/1 vulnerable customers.

---

## 2. Who our clients are under each law

Most clients are **deployers**: they use Claude, GPT and similar models inside their own processes. Some become **providers** of an AI system when they build a customer-facing assistant and put it into service under their own name. The obligations differ, so every mapping below says which role it applies to.

Which uses are high-risk for financial services under the AI Act (Annex III):

- Point 5(b): evaluating creditworthiness or establishing a credit score of natural persons (fraud detection is excluded).
- Point 5(c): risk assessment and pricing for natural persons in life and health insurance.
- Point 4: employment uses (recruitment, promotion, task allocation, monitoring), which apply to any firm.

Everything else most clients run (document processing, internal assistants, customer service chat) is usually not high-risk, but Article 50 transparency, Article 4 literacy and the prohibitions still apply, and UK and EU GDPR and FCA rules apply regardless.

---

## 3. Mapping: what a supervisor asks for, and what RegAnchor gives

Columns: the requirement, the evidence a supervisor or auditor would expect, what RegAnchor produces today, and the gap. Control numbers refer to the 12 governance controls.

### EU AI Act (deployer focus)

| Requirement | Evidence expected | RegAnchor today | Gap |
|---|---|---|---|
| Art. 26(1): use high-risk systems per the provider's instructions | Instructions for use on file; usage matches intended purpose | Registry entry with purpose and model (control 2); registered model guardrail proves the agent calls only its recorded model | Store the provider's instructions and intended purpose per asset; flag use outside it |
| Art. 26(2), Art. 14: human oversight by competent people with authority to intervene and stop | Named overseer per system; ability to halt; records of interventions | Control 5; pause an agent (an actual stop, audited); asset owners | Record who may pause each agent; report on overrides and pauses as oversight evidence |
| Art. 26(5): monitor operation; suspend and inform the provider on risk; report serious incidents | Monitoring records; incident and suspension records with timestamps | Gateway activity, guardrail findings, pause, audit log (controls 8, 10) | No incident record that links gateway events to a serious-incident decision and notification clock |
| Art. 26(6): keep automatically generated logs at least six months (financial institutions: as part of their financial-services documentation) | Retained logs, retrievable per system | Request records kept 400 days; prompt capture 30 days (control 12) | State the retention against Art. 26(6) in reports; allow per-organisation retention above six months for content where clients need it |
| Art. 26(7): inform workers' representatives before using high-risk AI at work | Notice records | None | Checklist item in the assessment |
| Art. 26(9): use provider information for the GDPR DPIA | DPIA referencing the system | Assessment question q2 and control 7 ask about DPIAs | Attach the DPIA to the asset |
| Art. 26(11), Art. 86: tell people a high-risk system is used in decisions about them; explain on request | Disclosure text; explanation process | Assessment questions q3_1, q3_2 (control 6) | Per-asset record of the disclosure and explanation route |
| Art. 27: fundamental rights impact assessment for credit scoring and life and health insurance pricing | FRIA document, notified to the market surveillance authority | Library has `euaia_art27`; registry risk classification (control 4) | Trigger the FRIA requirement automatically when an asset is classified under Annex III 5(b) or 5(c) |
| Art. 50: tell people they are interacting with AI (providers); label deepfakes and AI-generated text published to inform the public (deployers) | Disclosure in the interface; labelling | Control 6, assessment q3_1 | A monitoring check that customer-facing agents disclose AI (see section 5) |
| Art. 4: support AI literacy of staff (amended 2026) | Training measures | Assessment q4_3 | Re-word to match the softer duty |
| Art. 5: prohibited practices, plus the new item from 2 Dec 2026 | Screening record per system | Not explicit | Prohibited-practice screen in the registry entry |
| Art. 15 (provider duty, deployer interest): accuracy, robustness, cybersecurity including AI-specific attacks | Testing records; attack monitoring | Control 9; prompt injection guardrail (P1) flags or blocks injection attempts | Periodic red-team test records per asset |

### UK GDPR and Data (Use and Access) Act 2025, and EU GDPR

| Requirement | Evidence expected | RegAnchor today | Gap |
|---|---|---|---|
| UK Arts. 22A to 22D (from 5 Feb 2026): significant automated decisions need safeguards; special category data restricted | Which systems make significant decisions; proof of the four safeguards (information, representations, human intervention, contest) | Control 5, assessment s3 and s4 (cite old Art. 22) | Re-cite; ask for each safeguard separately; record "meaningful human involvement" evidence |
| EU Art. 22 (unchanged): right not to be subject to solely automated decisions, with exceptions | Exception relied on; safeguards | Same as above, UK-worded | Add EU GDPR entries and choose by client jurisdiction |
| Art. 5(1)(c) minimisation, Art. 32 security | Controls stopping unnecessary personal data reaching providers | DLP guardrails (financial information, national identifiers), privacy check (S7), prompt capture off by default | DLP covers two profiles only; no names, addresses, health or other special category detection |
| Art. 35 DPIA | DPIA per high-risk processing | Assessment question; control 7 | Attach and date the DPIA on the asset |
| Chapter V transfers (UK: new data protection test from 5 Feb 2026) | Where personal data is processed, by whom, under what transfer mechanism | Gateway records provider, infrastructure and region (for example AWS Bedrock, Europe (London)) | A region guardrail: refuse or flag requests to models outside approved regions, and a transfer report per asset |
| Art. 28, Art. 30 | Processor terms; records of processing | Vendor governance (control 3) | Link provider terms (Anthropic, AWS) to assets |
| DPA 2018 s.164A (from 19 Jun 2026): acknowledge complaints within 30 days | Complaint log | None | Out of scope unless complaints are linked to AI decisions (see DISP) |

### FCA and PRA

| Requirement | Evidence expected | RegAnchor today | Gap |
|---|---|---|---|
| Consumer Duty (PRIN 2A): avoid foreseeable harm; good outcomes on products, price and value, understanding, support; monitor outcomes | Outcome monitoring by customer group; evidence of acting on poor outcomes | Activity, findings and incident links (controls 8, 10) | Outcome sampling of customer-facing conversations (asynchronous, not in the request path); vulnerable customer signals (FG21/1) |
| SM&CR: a senior manager accountable for AI use | Named SMF, responsibilities map | Asset owners; control 1 | Record the accountable senior manager per asset and in reports |
| SYSC: systems and controls proportionate to the risk | Controls inventory and testing | 12 controls, guardrail switchboard with tests and audit | Scheduled guardrail tests as ongoing control testing evidence |
| SYSC 8 outsourcing, SYSC 15A operational resilience | Third-party risk assessment; impact tolerance for important business services; fallback | Provider and infrastructure per asset; fail mode (open or closed) is recorded | Concentration view (how much depends on one provider); fallback plan per asset |
| Regulated advice perimeter | Evidence that unauthorised advice is not given by agents | Specialised advice guardrail (S6) flags or blocks | The guardrail is general (financial, medical, legal); a finance-specific advice check would be stronger |
| DISP: complaints, root cause analysis | Complaints linked to the AI system involved | None | Link complaints to assets and gateway events |
| PRA SS1/23 (banks): model inventory, tiering, validation, change control, monitoring | Model inventory with tiers; validation records; change log | Registry (control 2), risk classification (control 4), registered and blocked model guardrails, model changes visible in activity | Validation records per model version; alert when an agent's model version changes |

### DORA (EU financial entities, applies from 17 Jan 2025)

| Requirement | Evidence expected | RegAnchor today | Gap |
|---|---|---|---|
| ICT third-party risk and register of information | Every ICT provider supporting functions, including AI providers | Provider per asset | Export of AI providers in a register-of-information shape |
| ICT incident classification and reporting | Incident records with classification | Gateway errors and outages are recorded | Incident record with DORA classification fields |

---

## 4. Guardrails: regulatory evidence versus other safety checks

The Cloudflare content checks are model-based classifiers, and clients should be told so:

- S1 to S14 use Llama Guard 3 8B, a language model fine-tuned to classify text as safe or unsafe and name the category. This is close to "LLM as a judge", but strictly it is a safety classifier built on a language model, not a general model asked to grade output against criteria.
- P1 (prompt injection) uses Prompt Guard 2 (86M), a small BERT-style classifier. It is not a large language model.
- Both are probabilistic: they can miss or over-flag. Recommended client wording: "checked by AI safety classifiers (Llama Guard 3 and Prompt Guard 2) running on Cloudflare; results are probabilistic".

| Guardrail | Regulatory link | Keep as |
|---|---|---|
| Pause an agent | AI Act Art. 14 and 26(5) (ability to stop), SM&CR | RegAnchor control evidence |
| Registered model only, blocked models | AI Act Art. 26(1), PRA SS1/23 inventory and change control, vendor governance | RegAnchor control evidence |
| Budget limits | Operational control, SYSC | RegAnchor control evidence |
| Your own rules | Client policy enforcement (control 1) | RegAnchor control evidence |
| Financial information, national identifiers (DLP) | GDPR Art. 5(1)(c) and 32 | Regulatory evidence |
| Privacy (S7) | GDPR | Regulatory evidence |
| Specialised advice (S6) | FCA advice perimeter, Consumer Duty foreseeable harm | Regulatory evidence |
| Prompt injection (P1) | AI Act Art. 15 cybersecurity, closest fit | Regulatory evidence |
| Rate limit | Operational resilience | Operational |
| Defamation (S5), intellectual property (S8) | Civil law, not financial regulation | Other |
| S1 to S4, S9 to S14 (crimes, weapons, hate, self-harm, sexual content, elections, code interpreter abuse) | Content safety | Other |

Decision (Fraser, 4 Nov 2026): "Other" checks stay available but are not presented as evidence for a governance control, even where they could support incident and harm response. Today the app still shows "Evidence for 10. Incident and harm response process" on those rows, and S5 and S8 sit in the main Cloudflare group; both should change.

Design direction from the same discussion: monitoring (Flag) should move out of the request path and run after the request, so it adds no delay; Block stays in the request path only where a client needs it, and response checks default to after the request.

---

## 5. Gaps worth building, in priority order

Ranked by regulatory weight for UK and EU financial services, and by how much of the work RegAnchor already has.

1. **Incident record linked to gateway events.** Turns guardrail findings and pauses into an incident with a decision, owner, notification clock and outcome. Serves AI Act Art. 26(5), DORA incident reporting, Consumer Duty, control 10.
2. **Region and transfer guardrail.** Allow models only in approved regions (for example UK and EU), with a transfer report per asset. Serves GDPR Chapter V and the UK data protection test; the gateway already records region.
3. **Automated decisions record (UK 22A to 22D, EU 22, AI Act Art. 86).** Per asset: is it a significant decision, is there meaningful human involvement, and evidence for each safeguard.
4. **High-risk triggers.** When an asset is classified under Annex III 5(b) or 5(c), require the FRIA, Art. 26 duties and Art. 86 explanation route, dated to 2 Dec 2027.
5. **Asynchronous outcome monitoring.** Sample customer-facing conversations after the fact for Consumer Duty outcomes, vulnerability signals and AI disclosure (Art. 50). No added delay.
6. **Accountable senior manager per asset** (SM&CR) shown in reports.
7. **Model change alert** when an agent's model version changes (SS1/23 change control), using data the gateway already has.
8. **Scheduled guardrail tests** as ongoing control-testing evidence (SYSC), reusing the switchboard's test path.

---

## 6. Keeping the regulatory library current

### The problem

The methodology, controls, assessment questions and report wording were derived from the law once, in March 2026, and the citations were copied into many places: `compliance_frameworks`, `control_requirement_map`, assessment section bases, `generate-report.js` strings, guardrail evidence labels and marketing copy. When the law changes, nothing notices, and every copy must be found and fixed by hand. Section 1 shows three changes since March that went unnoticed.

### The idea: make the regulatory text the source, and point everything else at it

The groundwork exists: `control_requirement_map.requirement_id` is already reserved for a "Requirement Registry" row (the three-tier split). Build that registry and make every other part of the product cite requirement IDs instead of free text.

**Tier 1, sources.** One row per legal source: AI Act, UK GDPR, EU GDPR, DUAA, FCA Handbook modules, PRA supervisory statements, DORA, ICO guidance, FCA AI pages. Stored with its official identifier and machine-readable address:

- EU law: EUR-Lex ELI identifiers (for example `eli/reg/2024/1689/oj` and the amending `eli/reg/2026/1744/oj`), consolidated versions, the Publications Office CELLAR SPARQL endpoint, and EUR-Lex alerts. All free.
- UK law: legislation.gov.uk serves every Act and SI as XML and Atom feeds, with point-in-time versions and "changes to legislation" tables showing what amends what and when it commences (SI 2026/82 is a clear example). Free, open licence.
- FCA and PRA: Handbook and PRA Rulebook pages, monthly Handbook Notices, policy statements, consultation papers and the Regulatory Initiatives Grid. Mostly HTML and PDF, so scraping and hashing rather than structured feeds.
- EU AI Office guidelines, codes of practice; EDPB and ICO guidance.

One exception to "everything is free": standards (ISO/IEC 42001, and the CEN-CENELEC harmonised standards being written for the AI Act) are sold, not published. Track their status and titles; do not depend on their text.

**Tier 2, requirements.** One row per clause we rely on, for example `eu_ai_act:art26(6)`, with the clause text as captured, a content hash, the source version it came from, who it applies to (provider, deployer, financial institution), risk tiers, `effective_from` and `effective_to`. Dates such as 2 Dec 2027 become data, so "what applies on date X" is a query, not a code change.

**Tier 3, mappings.** Controls, assessment questions, guardrails, report sentences and sales claims reference requirement IDs. `generate-report.js` and the assessment `regulatory_basis` stop holding citation strings and render them from the registry.

### The workflow

1. **Watch.** A scheduled job (Supabase cron or a Cloudflare Worker cron; weekly, daily for the EU Official Journal and UK SIs) fetches each source, extracts the relevant clauses, normalises whitespace and hashes them.
2. **Detect.** A changed hash, a new amending act, or a new commencement order creates a "regulatory change" record holding the before and after text.
3. **Find the impact.** Because everything references requirement IDs, the change record lists exactly which controls, questions, guardrails, report sentences and sales notes depend on it. No searching.
4. **Draft.** A language model summarises the change, classifies it (editorial, date change, substantive) and drafts proposed wording and mapping edits. It never publishes anything.
5. **Review.** An MLA admin approves or rejects in the existing Control Centre. Reviewer, date and reasoning are recorded. That record is itself evidence of a governed methodology, which auditors and buyers value.
6. **Publish a baseline.** Approved changes go out as a dated regulatory baseline (for example "Baseline 2026.11"). Every assessment, dossier and diagnostic report states the baseline it was run against, so old reports stay reproducible.

### What this gives the product

- **Clients get told what changed for them.** "Your assessment used Baseline 2026.03. Since then, UK GDPR Article 22 was replaced; three answers may need revisiting." That is a renewal and re-engagement hook, and for the diagnostic tool a reason to bring old leads back.
- **A regulatory horizon view.** Pending items (proposals, consultations, commencement dates) shown with expected dates. A natural product feature in its own right.
- **A citation check in the build.** A script that scans code and docs for regulatory citations and fails if one is not in the registry or is past its `effective_to`. It would have caught "UK GDPR Art. 22" in `generate-report.js` on 5 Feb 2026.
- **The diagnostic tool stops drifting** because it reads the same registry as the product, so it no longer needs separate rework.

### How to start small

1. Move the existing 21 obligations into the registry with source links, effective dates and clause text; fix the six errors in section 1.
2. Watch about ten sources: the AI Act and its amendments on EUR-Lex, UK GDPR and DUAA commencement on legislation.gov.uk, FCA AI pages, Handbook Notices, PRA supervisory statements, ICO AI guidance, EDPB guidelines, DORA.
3. Review changes monthly by hand with model-drafted summaries. Measure how often real changes arrive before automating further.
4. Point the report generator and assessment bases at the registry; add the citation check.

### Build or buy

Regulatory change management is an established RegTech category (for example CUBE and Corlytics) that monitors regulators at scale. Buying a feed is worth pricing once the registry exists, but the registry and the mapping to RegAnchor's own controls are what make it useful, and that part has to be ours either way.

---

## 7. Sources

- Regulation (EU) 2026/1744 (AI Omnibus): https://eur-lex.europa.eu/eli/reg/2026/1744/oj/eng
- European Commission, AI Omnibus enters into force: https://digital-strategy.ec.europa.eu/en/news/ai-omnibus-enters-force
- Council AI Act timeline: https://www.consilium.europa.eu/en/policies/artificial-intelligence-act/timeline-artificial-intelligence/
- AI Act Article 26 text: https://artificialintelligenceact.eu/article/26/
- Data (Use and Access) Act 2025, automated decision-making: https://www.legislation.gov.uk/ukpga/2025/18/part/5/chapter/1/crossheading/automated-decisionmaking
- SI 2026/82 (DUAA commencement No. 6): https://www.legislation.gov.uk/uksi/2026/82/made
- FCA, AI approach: https://www.fca.org.uk/firms/innovation/ai-approach
- FCA, AI in financial services, good practice and areas for improvement: https://www.fca.org.uk/publications/good-poor-practice/ai-financial-services
- FCA, AI Lab and Live Testing: https://www.fca.org.uk/firms/innovation/ai-lab
- FCA FG24/5 (change in control, confirms the library mislabel): https://www.fca.org.uk/publications/finalised-guidance/fg24-5-prudential-assessment-acquisitions-and-increases-control
- Cloudflare Guardrails usage considerations (models, latency, languages): https://developers.cloudflare.com/ai-gateway/features/guardrails/usage-considerations/
- Meta, Llama Prompt Guard 2 model card: https://dev.meta.ai/llama/docs/model-cards-and-prompt-formats/prompt-guard
