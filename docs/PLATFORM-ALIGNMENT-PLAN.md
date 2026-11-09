# Platform alignment plan: regulation to evidence, end to end

Status: phase 0 shipped 6 Nov 2026 (library corrected, methodology version published the same day). Phase 1 in progress: steps 1a (registry schema and seed) and 1b (Control Centre Requirements page) shipped 6 Nov; 1c (readers switch) shipped 6 Nov; 1d (citation check) built 6 Nov and its findings fixed; the three cited documents added as drafts were approved 7 Nov. Phase 2 (baselines, change notices, regulatory horizon) shipped 9 Nov; dossier and Reports page notices next. Companion to [REGULATORY-RESEARCH.md](REGULATORY-RESEARCH.md), which covers what the law says; this document covers how the product should hold it.

Goal: a client can take RegAnchor to an audit and every claim is current, cited to the law as it stands today, and backed by evidence that is either uploaded and reviewed or measured automatically from monitoring.

---

## 1. Answers to the questions

### Where does the regulatory registry live?

In the same Supabase database, as MLA-owned catalogue tables, next to `governance_controls` and `compliance_frameworks`. It is not the client-facing AI registry (`ai_systems`), and clients never edit it. They read it through the controls, assessments and reports that cite it.

- **Editing:** the existing admin Control Centre (`admin/`), which already has Mappings, Assessment questions, Diagnostic regs and Methodology versions pages.
- **Watching:** a scheduled Supabase edge function (or a Cloudflare Worker cron) fetches the sources, stores the captured text in Supabase Storage and writes change records.
- **Why not a separate service:** a requirement has to sit beside the controls, questions, guardrails and dossiers that reference it, so one query answers "what does this change affect". It does get its own schema and boundary (section 3), so it can be offered on its own later without being pulled out of RegAnchor.

### Once it exists, can we change the assessment, controls and citations everywhere at once?

For everything that reads from the database, yes, in one approval. Part of this exists already:

- Controls, obligations, the control-to-obligation map, assessment questions and diagnostic rows are all in the database and editable in Control Centre.
- `methodology_versions` already freezes the catalogue into a named version (current: `2026.09.16`), and dossiers already stamp the catalogue hash they were built against.

What blocks "everywhere at once" today is that citations are copied as free text into at least four separate places, none of which reference each other:

| Where | What it holds |
|---|---|
| `compliance_frameworks` | 21 obligations (13 EU AI Act, 5 UK GDPR, 3 FCA) |
| `diagnostic_regs` | A separate copy for the diagnostic PDF, marked "Not the methodology catalogue" |
| `assessment_sections.regulatory_basis` | One free-text citation string per section |
| Code and pages | Hard-coded citations in about 30 files, including `generate-report.js`, `report-template.html`, `report.html` (41), `methodology.html`, `diagnostic.html`, `privacy.html`, with most pages duplicated between the repo root and `app/public/legacy/` |

Once all of these reference requirement IDs, one approved change updates every database-driven surface together, and a build-time citation check catches the static pages.

One deliberate exception: **completed assessments and signed dossiers are never rewritten.** What a client attested on a date must stay as it was, or it is useless at audit. Instead they are stamped with the baseline they used, and the client is told what changed since ("UK GDPR Article 22 was replaced on 5 Feb 2026; three answers may need revisiting"). That is both the correct audit behaviour and a re-engagement prompt.

### How scalable is it if a new AI assurance framework appears?

With the registry in place, a new framework is data, not a rebuild:

1. Add the source (for example a UK AI bill, ISO/IEC 42001 revision, NIST AI RMF update, a US state AI law).
2. Add its requirements with effective dates and who they apply to.
3. Map each requirement to existing controls. Where nothing fits, add a control.
4. Publish a baseline. Clients in scope see the new requirements against controls they may already have evidenced.

This is the "common controls" approach that SOC 2 and ISO 27001 platforms use: controls are the stable middle layer, frameworks map onto them many-to-many, and evidence is collected once per control and reused across every framework. The 12 controls are a good start for that middle layer. The schema is about half there: `control_requirement_map` is already many-to-many, but `compliance_frameworks.framework` is a plain text field with three values, and client custom frameworks (`org_frameworks`) are a separate parallel structure rather than the same model scoped to one organisation.

### Is the backend aligned, or confusing now that monitoring exists?

It works, but it is two systems that do not talk to each other.

- **Governance side:** `ai_systems`, `registry_assessments`, `control_assignments`, `evidence_uploads`, `system_compliance`, `governance_dossiers`, `governance_score_history`.
- **Monitoring side:** `gateway_request_events`, `org_guardrails`, `gateway_agent_pauses`, budgets, `gateway_inventory`, `asset_eval_runs`.

The only link between them is a number in `app/src/lib/guardrails.ts` (`evidence: 10`) used to print a label. It is not data. The dossier generator reads no monitoring data at all, so control 8 (model monitoring) still asks the client to upload "monitoring dashboards" while RegAnchor is the monitoring.

Other overlaps worth resolving:

- Two status tracks for the same idea: `system_compliance` (per asset, per obligation) and `control_assignments` (per asset, per control).
- Two usage stores: the older `asset_usage_events` and `asset_usage_snapshots` against the newer `gateway_request_events`.
- A small rule engine (`compliance_rules`, 5 rules, `compliance_automation_log`) separate from the assessment triggers.
- Control triggering runs in the browser (`assessment.html` inserts `control_assignments` directly), so the logic that decides which controls a client must meet lives in client-side code.
- Duplicated legacy pages in the repo root and `app/public/legacy/`.

None of this is broken. It is the normal result of building fast in phases, and it is the right time to join it up before more clients and frameworks sit on top.

### Can monitoring be measured and automated to satisfy controls for enterprise questionnaires?

Yes, and this is the strongest commercial opportunity in the plan. The pattern is **automated control tests**: each control gets checks that run on a schedule against data RegAnchor already holds, and each result is stored as dated evidence. Examples from today's data:

| Control | Automated test | Data it reads |
|---|---|---|
| 2. AI system inventory | No AI traffic from agents missing from the registry in the last 30 days | `gateway_inventory`, `ai_systems` |
| 3. Vendor governance | Every provider in use has an owner and terms on file | gateway events, asset providers |
| 5. Human oversight | Each production agent has a named person who can pause it; pause tested in the last 90 days | `gateway_agent_pauses`, owners |
| 8. Model monitoring | Agent traffic is monitored; error and block rates within thresholds; model version changes reviewed | `gateway_request_events` |
| 9. Security testing | Scheduled guardrail tests passed (prompt injection, data loss checks) | switchboard test path |
| 10. Incident response | Every block and flag reviewed within the agreed time | needs the incident record (research gap 1) |
| 12. Audit logging | All production agents routed through the gateway; retention at least six months | gateway settings, events |

Control status then comes from both sources: uploaded, reviewed documents for design (policies, procedures, approvals), and automated tests for operation (is it actually happening). Enterprise questionnaires (vendor security questionnaires, ISO/IEC 42001 Annex A, NIST AI RMF, bank third-party AI questionnaires) are mostly asking the same things in different words, so mapping their questions to controls lets one evidenced control answer many questionnaires.

One honest limit for sales: an automated test proves a control is operating, not that it is well designed. Policy and accountability controls still need a person to approve them. Your "Other" guardrails decision fits this model: they can feed incident review, but they never count as a control test.

### Is the per-asset risk assessment mapped to regulations the best framework?

The core idea is right: assess each AI system, work out what applies, and assign controls. That matches how the law is written (the AI Act is per system and risk-tiered; PRA SS1/23 is a model inventory with tiers; ISO/IEC 42001 has an AI system impact assessment). The way it is wired today has three problems that will not scale:

1. **Applicability and maturity are mixed together.** Controls are assigned when an answer scores 1 or below (`trigger_rules` with `any_below`, threshold 1). So a client who answers "yes, we have documented human oversight" is never assigned control 5 at all, and has nothing to evidence. In law the opposite holds: the obligation applies because of what the system is (customer-facing, makes significant decisions, processes personal data), and a good answer means the client should be able to prove it, not skip it. An auditor will ask for the evidence either way.
2. **The law is decorative.** Questions trigger controls directly. The regulation only appears as a text label on the section, so changing the law changes nothing downstream.
3. **It is a one-time self-attestation.** Answers age from the day they are given, while monitoring already knows some of them better than the client does (q3_3 logging, q5_2 performance monitoring, q6_4 audit trail).

The scalable shape keeps the per-asset idea but separates four layers:

```
Asset facts (role, use case, jurisdiction, personal data, customer-facing, decision significance)
  -> Applicable requirements (from the registry, for the date in question)
    -> Required controls (the common controls layer)
      -> Evidence (uploaded and reviewed, or automated tests from monitoring)
        -> Status and maturity score (derived, never the trigger)
```

- The assessment becomes mostly **scoping questions** (facts), which change rarely and are easy for clients to answer, plus **maturity questions** that produce the score and the report narrative.
- Monitoring **pre-fills or overrides** answers it can measure, and says so.
- The diagnostic and its PDF become a light consumer of the same registry and scoping logic, so the lead tool stops needing its own rework.

---

## 2. Monitoring placement: in the request path or after it

Today every Cloudflare guardrail, including those in Flag mode, runs inside the request and adds about half a second, and response checks hold back streaming.

Proposal:

- **Flag runs after the request by default.** The request goes straight to the provider; the prompt and response are checked afterwards (a queue calling the same classifier models on Workers AI directly). No added delay. Findings appear in Activity seconds later.
- **Block stays in the request path,** because it has to decide before the provider sees the prompt. When a client switches a check to Block, the app shows the delay measured on their own traffic ("Blocking adds about 480 ms to each request for this agent, based on the last 7 days"), so the choice is informed rather than a generic warning.
- **Response checks default to after the request,** with Block on responses as an explicit opt-in that notes it disables streaming.
- **Fail behaviour stays a client choice,** recorded as evidence (open: send and record; closed: refuse).

Running the classifiers ourselves (rather than through AI Gateway's guardrail feature) also answers the earlier question about having only RegAnchor guardrails: one consistent set of checks, one place to measure latency, the same models underneath, and nothing that depends on a gateway feature's propagation time.

---

## 3. Keeping the regulatory registry separable

Priority is RegAnchor's own workflow. The aim here is only that, if the registry is built well, offering it later to firms on their own platforms ("regulatory change monitoring for your own controls, mapped in real time") is a packaging step, not a rebuild. These rules cost little now and keep that option open:

1. **Own schema.** Registry tables live in a separate Postgres schema (for example `reg`), not mixed into `public`. No foreign keys from the registry into RegAnchor tables; RegAnchor tables point at registry IDs, never the other way.
2. **The law is shared; the mapping is the customer's.** The registry holds sources, requirements, versions and change records. Which control a requirement maps to belongs to the consumer. RegAnchor's mappings to its 12 controls are RegAnchor's data, exactly as a future customer's mappings to their own controls would be theirs.
3. **RegAnchor reads it like a customer would.** Product code reads the registry through a small set of published views or functions (requirements as of a date, changes since a baseline, impact for a set of requirement IDs), not ad hoc table joins. Those same functions become the external API later.
4. **Stable public IDs.** Requirement keys follow official identifiers where they exist (EUR-Lex ELI, legislation.gov.uk URIs), so they mean the same thing inside and outside RegAnchor.
5. **Provenance and licence per item.** Every captured text records its source, retrieval date and licence. Free sources (EUR-Lex, legislation.gov.uk under the Open Government Licence) can be redistributed with attribution. Paid feeds usually cannot be passed on to your customers without a reseller agreement, so the licence field decides what an external customer may see.
6. **Changes go out as events.** Each approved change emits an event (requirement changed, new requirement, effective date reached). RegAnchor's change notices are the first subscriber; a webhook for an outside customer is the same event delivered elsewhere.
7. **Feeds are pluggable.** Each source is fetched by a connector with one shape (fetch, extract clauses, hash, diff). Free sources are the first connectors; a paid feed later is one more connector, not a redesign.

What this deliberately leaves out: no separate service, billing, tenant management or public API until RegAnchor has run on the registry for a few months and the change volume and review effort are known. That evidence is also what tells you whether a paid feed is worth buying.

---

## 4. Phased plan

Each phase is shippable on its own and leaves the product in a better state. Sizes are rough.

### Phase 0: correct the library (small, do first)

- Fix the six errors in research section 1: FG24/5 label, SS1/23 moved to PRA, UK GDPR Article 22 to Articles 22A to 22D, the Article 27 citation in the report generator, add EU GDPR entries, update AI Act dates to the Omnibus.
- Move the "Other" guardrails off control evidence in the app (your 4 Nov decision).
- Publish a new methodology version so dossiers cite the corrected catalogue.
- Outcome: what clients see today is correct. Production data change, needs approval.

Shipped 6 Nov 2026. Both migrations applied, static pages corrected, app, admin and dossier function deployed, methodology version published in Control Centre. The question banks were also brought up to date in `20261106120000_question_banks_current_law.sql` (insurance pricing added to the diagnostic, identity checks no longer counted as biometrics, safeguard wording for Articles 22A to 22D).

- `supabase/migrations/20261106090000_library_corrections_phase0.sql`: corrects obligations in place (ids unchanged, so the 481 per-asset status rows and all mappings keep their links); renames keys `fca_fg24_5` to `fca_ai_approach`, `fca_ss1_23` to `pra_ss1_23`, `ukgdpr_art22` to `ukgdpr_art22a_d`; fixes the Article 27 description, which omitted credit scoring and life and health insurance deployers (the main financial services case); adds `eugdpr_art22` mapped to control 5; removes em dashes from obligation copy; updates assessment section s3 and the diagnostic overview rows; widens the framework check to allow `eu_gdpr` and `pra`.
- App: "Other safety checks" group (Defamation and Intellectual property moved into it), no evidence label on those rows; framework labels for EU GDPR and PRA in the app, admin and dossier function.

Further errors found while drafting, in the diagnostic overview table and the static report pages:

| Error | Where | Correct position |
|---|---|---|
| AI Act penalties shown as "EUR 30M or 6%" for classification and human oversight | `diagnostic_regs`; `report.html`, `report-template.html` and their legacy copies | Those figures are from the 2021 proposal. Final Article 99: EUR 35M or 7% for prohibited practices only; EUR 15M or 3% for high-risk and other obligations; EUR 7.5M or 1% for incorrect information. Fixed in the draft migration for `diagnostic_regs`. |
| UK GDPR DPIA (Article 35) shown with the higher penalty tier | Same | DPIA sits in the standard tier: GBP 8.7M or 2%. Fixed in the draft migration for `diagnostic_regs`. |
| "Prudent compliance planning treats August 2026 as the binding deadline"; the Omnibus "could extend" Annex III dates | `report.html` (root and legacy) | The Omnibus is law: Annex III high-risk obligations apply from 2 Dec 2027. |
| "August 2026" deadlines and "Next scheduled framework review: August 2026" | `report.html`, `diagnostic.html`, `report-template.html` (root and legacy) | 2 Dec 2027 for Annex III duties; review date should come from the registry. |
| "EU AI Act Art. 27 requires providers and deployers to maintain technical documentation"; Art. 27 cited for named accountability and for AI inventory | `report.html` (root and legacy), `generate-report.js`, `report-template.html` | Article 27 is the fundamental rights impact assessment. Documentation is Article 11 (providers); deployer oversight assignment is Article 26(2); named accountability for UK firms is SM&CR. |
| UK GDPR "Art. 22" throughout findings, section bases and transparency text | `report.html`, `report-template.html`, `system-report.html`, `methodology.html` (root and legacy), `generate-report.js` | Articles 22A to 22D for UK decisions from 5 Feb 2026; EU GDPR Article 22 for EU data subjects. |
| Claims to check before reuse: "FCA AI Update (2025) explicitly states firms must identify a named individual"; "SM&CR Prescribed Responsibility 24"; "PS7/21" as the SM&CR accountability source; "Commission classification guidance (February 2026)" | `report.html` | Not verified. Remove or re-source. The FCA AI Update was published in April 2024. |

The static pages hold about 80 regulatory lines across ten files, most of them duplicated between the repo root (public site) and `app/public/legacy/` (app). Correcting them by hand is the backwards loop this plan is meant to end, so the penalty figures, the August 2026 deadline language and the Article 27 misuse were fixed by hand in phase 0, and the rest moves to registry-rendered text or the citation check in phase 1.

Left for later phases on purpose: new diagnostic questions (the scoring maximums are hard-coded, so they wait for a versioned questionnaire in phase 4), and the missing regimes in research section 1 error 6 (seeded in phase 1, mapped to controls after review).

### Phase 1: requirement registry (medium)

- New catalogue tables: sources (official identifier, URL, feed), requirements (clause key, captured text, hash, applies to, risk tiers, `effective_from`, `effective_to`), and requirement mappings (to controls, assessment questions, guardrails, report sentences).
- Migrate the 22 obligations, `diagnostic_regs` and section bases into it; fill the reserved `control_requirement_map.requirement_id`.
- Report generator, diagnostic and assessment render citations from the registry.
- Build-time citation check: fails when code or a page cites something not in the registry or past its `effective_to`.
- Outcome: one place to change a citation.

Current state (checked 6 Nov): 22 active obligations in `compliance_frameworks` (13 EU AI Act, 5 UK GDPR, 2 FCA, 1 PRA, 1 EU GDPR), 9 `diagnostic_regs` rows, 8 free-text section bases, 0 of 21 map rows with `requirement_id` filled. Ten places read these tables: the dossier and report functions, `generate-report.js`, `report-template.html`, `assessment.html` and `portal-registry.js` (root and legacy), the app Frameworks pages, and four admin pages.

Design, following section 3:

- **Schema `reg`, not exposed to the API.** Tables `reg.sources` and `reg.requirements`. Nothing in `reg` references `public`.
- **`reg.sources`:** key, title, issuer (EU, UK Parliament, FCA, PRA, ICO, EDPB), jurisdiction, official identifier (ELI or legislation.gov.uk URI), URL, feed URL, licence, kind (law, rule, guidance, supervisory statement).
- **`reg.requirements`:** stable key in official form (for example `eu_ai_act:art26(6)`), source, citation in long and short form, title, summary in our words, **evidence expected** (the middle column of research section 3), applies to (provider, deployer, controller, financial institution), jurisdictions, risk tiers, `effective_from`, `effective_to`, `superseded_by`, status (in force, pending, repealed), penalty tier, and captured text with hash, retrieval date and licence.
- **Read surface in `public`:** a few functions, readable by signed-in users and by the anonymous diagnostic: requirements as of a date, one requirement by key, and requirements for a list of keys. Phase 2 adds "changes since a baseline". These are the future external API.
- **Mappings stay RegAnchor's.** `compliance_frameworks.requirement_id`, `control_requirement_map.requirement_id` (already reserved), `diagnostic_regs.requirement_id`, and a new `assessment_section_requirements` table. All point into `reg`, never the reverse.
- **Additive first.** Existing tables and readers keep working while readers move to the registry one at a time. `compliance_frameworks` becomes RegAnchor's view of the law (which requirements it uses, with its own guidance text), not a second copy of the citation.

Seed, from the research:

- The 22 obligations, 9 diagnostic rows and 8 section bases, de-duplicated into requirements.
- Every requirement row in research section 3, with its evidence expected.
- The missing regimes in research section 1 error 6 (DORA, SYSC 8, SYSC 15A, DISP, FG21/1), plus Article 4, Article 4a, Article 5 including the item applying from 2 Dec 2026, and the DUAA transfer test. Seeded but not mapped to controls or shown to clients until reviewed in Control Centre.
- Sources from research section 7, with ELI and legislation.gov.uk identifiers.

Steps, each shippable:

1. **1a, schema and seed.** Migration creates `reg`, the read functions and the link columns, and seeds sources and requirements. Nothing reads it yet. No client-visible change.
2. **1b, Control Centre page.** Requirements list and edit in `admin/`, showing what links to each requirement (obligations, map rows, diagnostic rows, sections).
3. **1c, readers switch.** Dossier and report functions, `generate-report.js`, the app Frameworks pages and assessment section bases render citations from the registry. Methodology snapshot includes requirements.
4. **1d, citation check.** A build script exports the registry to a JSON file and scans pages and code for citations (Article, Art., SS, FG, SYSC, PRIN patterns). It fails on a citation that is not in the registry or past its `effective_to`. Runs in the app prebuild; the static marketing pages are checked rather than rendered.

Phase 1 does not fetch or watch anything. Captured text is filled once by a one-off script; watching is phase 3.

1a applied 6 Nov 2026 (verified: 34 approved requirements readable by signed-in users and the anonymous diagnostic through the read functions; `reg` itself refuses direct access; 481 `system_compliance` rows unchanged):

- `supabase/migrations/20261106140000_reg_requirement_registry.sql`: schema, read functions, links, and a seed of 16 sources and 65 requirements (34 approved because RegAnchor already cites them, 31 drafts from the research).
- `supabase/migrations/20261106140100_reg_captured_text.sql`: verbatim text for 51 requirements, generated by `scripts/reg-capture-text.mjs`. EU text comes from the Publications Office (CELLAR) by CELEX number, because EUR-Lex pages answer scripts with a bot challenge; the AI Act is the consolidated version of 27 Jul 2026, which includes the Omnibus. UK text comes from legislation.gov.uk, including UK GDPR Article 22 as it stood on 4 Feb 2026. FCA, PRA, ICO and ISO items hold a link and summary only.
- Dry run on production inside a rolled-back transaction: all 22 obligations and 21 map rows link to a requirement, 38 citations created, old UK Article 22 returned for January 2026 and not for today.

1b shipped 6 Nov 2026:

- `supabase/migrations/20261106160000_reg_admin_review.sql`: admin-only functions to list all requirements with their links, edit wording and dates, approve, return to draft or retire, and read the history. Every edit and decision is written to `reg.review_log` with who, when, what changed and an optional note. Also links the remaining three diagnostic priority flags (41 citations in total).
- Control Centre, Methodology, Requirements (`admin/src/pages/RequirementsPage.tsx`): filter by review state and source, search, CSV export; drawer with review actions, wording, links, the verbatim text and history. Captured text is read-only.
- For 1d: the diagnostic flags cite "ICO AI Guidance 2023" (DPIA flag) and "FCA DP5/22" (AI inventory flag), neither in the registry. The AI inventory flag also cites Article 9, a provider duty, for an inventory gap.

1c shipped 6 Nov 2026, after Fraser approved all 65 requirements (first sync updated 9 obligation references, 9 diagnostic rows and 7 section bases; 481 `system_compliance` rows unchanged):

- `supabase/migrations/20261106180000_reg_citation_sync.sql`. RegAnchor keeps its display copies (obligation article references, the diagnostic regulatory table, assessment section bases) and `public.reg_sync_citations()` derives them from approved requirements. It runs after every registry edit or review decision, daily at 00:05 UTC so pending dates roll into force, and once at apply. The registry is the only place a citation, penalty or date is edited; the copies are read-only in Control Centre where a row is linked.
- Composition rules. Obligation references drop the framework name, which every reader prints beside them ("UK GDPR Article 5" becomes "Article 5", so the dossier no longer prints "UK GDPR, UK GDPR Article 5"). Section bases group by source and add a role where the duty is one-sided ("EU AI Act Articles 9, 11 and 17 (providers) and Article 26 (deployers); FCA SM&CR"). Diagnostic rows take regime, article, penalty and deadline from the primary requirement; deadline is the effective date while pending, "Immediate" once in force, "Ongoing" for benchmarks.
- Corrections that fall out of the sync: diagnostic "PS7/21 & PRs" becomes "SM&CR" under regime "FCA", ISO "Sections 6-9" becomes "Clauses 6-9", UK GDPR transparency "Art. 13-14" becomes "Arts. 13-14", and penalties use the registry wording.
- Dossier (generator 2.7.0): each obligation and mapped requirement carries its registry key and, while pending, "applies from"; section 6 gains a regulatory references table (citation, requirement, in force or applies from, official text link). The catalogue hash now covers the requirements behind the obligations.
- Methodology publish snapshot version 2 includes approved requirements (citation, summary, dates, captured text hash, reviewed at) and all citations. The next publish freezes the registry baseline phase 2 needs.
- Not changed: no new control mappings; registry requirements that RegAnchor does not use stay out of client views. `generate-report.js`, the report function, `assessment.html` and the app Frameworks pages read the synced copies, so they pick up registry wording without code changes. Hard-coded fallbacks in static pages (`report.html`, `diagnostic.html` flags) are left for the 1d check.

1d built 6 Nov 2026:

- `scripts/reg-export.mjs` writes the approved registry to `scripts/data/reg-registry.json` (read-only CLI query; rerun after registry changes). `scripts/check-citations.mjs` scans the public pages, `js/`, `app/src` and the edge functions for article citations (EU AI Act, UK and EU GDPR, DORA), FCA and PRA codes (SS, PS, DP, FG, SYSC, PRIN, DISP) and named guidance with a year. It fails when a citation is not an approved requirement or is past its `effective_to`. Runs first in the app `prebuild`. MLA Group's own legal pages and retired design studies are skipped.
- First run found 24 distinct findings (38 occurrences). Fraser chose to fix the copy and add the missing current documents as drafts. Fixed the same day in `index.html`, `pages.html`, `methodology.html`, `diagnostic.html`, `generate-pdf.html`, `report.html` and `report-template.html`; `supabase/migrations/20261106190000_reg_cited_guidance_drafts.sql` adds FCA PS22/9, PRA SS2/21 and the ICO guidance on AI and data protection as drafts, and moves the "no AI inventory" flag from Article 9 to Article 6 and the FCA AI approach. `scripts/data/citation-baseline.json` now holds only the PS22/9 and SS2/21 mentions, which clear when those drafts are approved and `scripts/reg-export.mjs` is rerun.
- What the first run found:
  - FCA DP5/22, a 2022 discussion paper, in 13 places including the homepage line "Aligned with FCA DP5/22".
  - PS7/21 and SS1/21 presented as FCA rules; both are PRA documents (outsourcing; operational resilience). The FCA equivalents in the registry are SYSC 8 and SYSC 15A.
  - EU AI Act Articles 16, 72 and 73, provider duties, cited to deployers in the report template and methodology page. The deployer duty is Article 26(5).
  - Old UK GDPR Article 22 in the report template section 5 basis and the methodology page.
  - PS22/9 (Consumer Duty policy statement; the registry cites PRIN 2A), PRA SS2/21 and "ICO AI Guidance 2023", current documents not yet in the registry.
- 7 Nov: Fraser approved the three drafts; registry re-exported and the baseline is empty (0 known findings).

### Phase 2: baselines and client change notices (small to medium)

- Extend `methodology_versions` to include requirements; stamp `registry_assessments` (it already has `questionnaire_version`) and dossiers with the baseline.
- "Changed since your baseline" notice on assets and reports, listing affected answers and controls.
- Regulatory horizon view: pending dates (2 Dec 2026 prohibition, 2 Dec 2027 Annex III) shown per client.
- Outcome: clients are told when the law moves under them.

Client base for every surface in this plan: organisations deploying or developing AI agents in their workflows, mostly in the UK and also the EU, across regulated sectors (financial services, law, AI and digital, manufacturing and logistics, healthcare, public sector and others). Financial services is a major segment, not the only one. Client copy is addressed to the client, sector-neutral unless a requirement is sector-specific, and shows the role a duty applies to (providers, deployers, controllers, regulated firms).

Phase 2 shipped 9 Nov 2026 (dry run on production first; applied, app deployed; 481 `system_compliance` rows unchanged):

- `supabase/migrations/20261109170000_reg_baselines_and_changes.sql`:
  - Article-level links for the 38 EU AI Act, EU GDPR and DORA requirements (EUR-Lex anchors, checked in the browser; the AI Act uses the consolidated text of 27 Jul 2026). Each change is written to the review log. FCA, PRA, ICO and ISO items keep their document links, which already open the exact document.
  - `registry_assessments.methodology_version_id`, set by trigger to the current methodology version when an assessment is completed. The 42 completed assessments predate the first version (16 Sep 2026), so they stay unstamped. Dossiers already record their methodology version in the snapshot.
  - Draft requirement `eu_ai_act:art5(1)(ba)-(bb)` (non-consensual intimate imagery and child sexual abuse material), applying from 2 Dec 2026, with the verbatim text from the consolidated Act. Article 113 is not captured, so confirm the date when approving.
  - `asset_regulatory_changes(system_id)`: for the requirements behind an asset's latest completed assessment, its obligations and its assigned controls, what has changed since that assessment, measured by legal dates (now applies, replaced, repealed). Against a version 2 baseline it also reports wording updates and newly cited requirements. Returns the affected sections with answer counts, the affected controls and the official link. Dry run: 39 changes, all Article 50 (applies from 2 Aug 2026) for 12 assets assessed before that date.
  - `org_regulatory_horizon(org_id)`: approved requirements applying from a future date that touch the organisation's assets, with the roles they apply to and the number of assets. Prohibitions count for every asset. Dry run: 12 EU AI Act requirements applying from 2 Dec 2027.
- App: "Changes since your last assessment" on the asset Assessment tab (`AssetRegulatoryChanges.tsx`; paragraph rows fold into their article) and "Coming into force" on the Frameworks page (`RegulatoryHorizon.tsx`). Both are hidden when empty and use the shared `Ledger` and `DataTable`.
- After apply: publish a new methodology version so the first version 2 baseline exists; assessments completed from then on are stamped with it.
- Not in this step: change notices inside dossiers and on the Reports page.

### Phase 3: regulatory watcher (medium)

- Scheduled fetch of about ten sources (EUR-Lex, legislation.gov.uk feeds, FCA Handbook Notices and AI pages, PRA, ICO, EDPB, DORA).
- Change records with before and after text; impact list from the mappings; model-drafted summary and proposed edits; human approval in Control Centre; publish as a new baseline.
- Monthly manual review first; automate further once real change volume is known.
- Outcome: changes are noticed in days, not months.

### Phase 4: applicability engine (medium to large)

- Asset scoping facts on the registry entry (role, use case and Annex III category, jurisdictions, personal and special category data, customer-facing, significant decisions).
- Applicability rules on requirements; required controls derived from applicable requirements.
- Trigger rules replaced: controls assigned by applicability; scores kept as maturity only.
- Control assignment moves server-side (a database function or edge function), out of browser code.
- Existing assessments migrated by mapping today's answers to facts where possible; the rest flagged for a short re-scope.
- Scoping facts from the research: prohibited-practice screen including the 2 Dec 2026 item (research 3), significant automated decision with the four UK safeguards and the EU Article 22 exception recorded separately (research gap 3), Annex III 5(b) and 5(c) triggering the FRIA, Article 26 duties and the Article 86 explanation route (research gap 4), accountable senior manager per asset (research gap 6), provider instructions and intended purpose (Art. 26(1)), workers' representatives notice (Art. 26(7)).
- Versioned questionnaire: the diagnostic and asset assessment get these questions in a new version with rebuilt scoring, so old reports keep their version.
- Outcome: the right controls for the right assets, independent of how confidently a client answers.

### Phase 5: evidence spine and automated control tests (large, highest commercial value)

- One evidence model per control assignment: uploaded documents (reviewed), automated test results (dated, with pass, fail and freshness), and monitoring facts.
- Scheduled control tests from the table in section 1, starting with controls 2, 8, 12 and 5.
- Guardrail-to-control links move from `guardrails.ts` into the registry mappings, respecting regulatory versus Other.
- Dossiers and reports include automated evidence with dates.
- Incident record (research gap 1) so control 10 can be tested.
- Merge `system_compliance` into the control assignment model; retire the older usage tables once nothing reads them.
- From the research: model version change alert (gap 7) and scheduled guardrail tests (gap 8) as the first automated tests; region and transfer guardrail with a transfer report per asset (gap 2); DPIA and FRIA attached and dated on the asset; provider terms linked to assets; validation records per model version (SS1/23); red-team test records (Art. 15); complaints linked to assets and gateway events (DISP); provider concentration view and fallback plan (SYSC 8, SYSC 15A); AI providers exported in DORA register-of-information shape, and DORA classification fields on the incident record.
- Outcome: controls show "operating, last tested 2 hours ago" instead of "evidence uploaded in March".

### Phase 6: questionnaire answering (medium)

- Map common enterprise questionnaire items (ISO/IEC 42001 Annex A, NIST AI RMF, standard vendor security and bank third-party AI questions) to controls.
- Export answers with evidence links and dates for a buyer's security review.
- Outcome: a sales and renewal tool for enterprise buyers.

### Phase 7: monitoring after the request (medium)

- Flag checks after the request via a queue; Block in the request path with measured-latency notice; response checks after the request by default.
- Can run in parallel with phases 1 to 3, since it is independent of the registry.
- From the research: outcome sampling of customer-facing conversations for Consumer Duty, vulnerability signals (FG21/1) and AI disclosure (Art. 50) (gap 5); wider data loss checks covering names, addresses and special category data; a finance-specific advice check alongside S6. All run after the request, so they add no delay.

### Suggested order

Phase 0 now. Phases 1 and 2 together next, because they fix the drift problem you described. Then phase 5 (starting with the automated tests that need no new data), with phase 4 alongside it. Phase 3 once the registry has settled. Phase 6 when the first enterprise questionnaire arrives. Phase 7 whenever latency becomes a client concern, or earlier if a large client is in the pipeline.

---

## 5. Research coverage

Where each part of [REGULATORY-RESEARCH.md](REGULATORY-RESEARCH.md) lands, so none of it is left behind.

| Research section | Where it goes |
|---|---|
| 1. What changed since March, and errors 1 to 5 | Phase 0, shipped. Later changes arrive through the phase 3 watcher. |
| 1. Error 6, missing regimes | Phase 1 seed; mapped to controls after review |
| 2. Who our clients are (deployer or provider, Annex III points) | Phase 1 `applies_to` and risk tiers; phase 4 scoping facts |
| 3. Supervisor evidence tables | Phase 1 seed (requirement and evidence expected per row); each gap column item is assigned in phases 4, 5 or 7 above |
| 4. Guardrails, regulatory versus other | Phase 0 (app labels); phase 5 (links move into registry mappings); phase 7 (after-request design) |
| 5. Gaps 1, 2, 7, 8 | Phase 5 |
| 5. Gaps 3, 4, 6 | Phase 4 |
| 5. Gap 5 | Phase 7 |
| 6. Keeping the library current | Phases 1 to 3. "How to start small" steps 1 and 4 are phase 1; steps 2 and 3 are phase 3; "build or buy" is decision 4 below |
| 7. Sources | Phase 1 seed for `reg.sources` |

---

## 6. Decisions needed

1. Phase 0: approved and shipped 6 Nov 2026.
2. Whether existing clients' controls should be re-derived by applicability in phase 4, which will assign some controls they currently do not have (correct, but visible to them).
3. Whether Flag-after-request (phase 7) should become the default for all organisations or opt-in first.
4. Whether to price a commercial regulatory feed (for example CUBE or Corlytics) once phase 3 shows the real change volume.
