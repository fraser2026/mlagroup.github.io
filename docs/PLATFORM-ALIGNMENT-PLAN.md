# Platform alignment plan: regulation to evidence, end to end

Status: plan for discussion, 6 Nov 2026. Nothing here is built. Companion to [REGULATORY-RESEARCH.md](REGULATORY-RESEARCH.md), which covers what the law says; this document covers how the product should hold it.

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

Drafted 6 Nov, not applied:

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

The static pages hold about 80 regulatory lines across ten files, most of them duplicated between the repo root (public site) and `app/public/legacy/` (app). Correcting them by hand is the backwards loop this plan is meant to end, so the recommendation is: fix the penalty figures, the August 2026 deadline language and the Article 27 misuse by hand now (they are wrong in a way a client's lawyer would notice), and move the rest to registry-rendered text in phase 1.

### Phase 1: requirement registry (medium)

- New catalogue tables: sources (official identifier, URL, feed), requirements (clause key, captured text, hash, applies to, risk tiers, `effective_from`, `effective_to`), and requirement mappings (to controls, assessment questions, guardrails, report sentences).
- Migrate the 21 obligations, `diagnostic_regs` and section bases into it; fill the reserved `control_requirement_map.requirement_id`.
- Report generator, diagnostic and assessment render citations from the registry.
- Build-time citation check: fails when code or a page cites something not in the registry or past its `effective_to`.
- Outcome: one place to change a citation.

### Phase 2: baselines and client change notices (small to medium)

- Extend `methodology_versions` to include requirements; stamp `registry_assessments` (it already has `questionnaire_version`) and dossiers with the baseline.
- "Changed since your baseline" notice on assets and reports, listing affected answers and controls.
- Regulatory horizon view: pending dates (2 Dec 2026 prohibition, 2 Dec 2027 Annex III) shown per client.
- Outcome: clients are told when the law moves under them.

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
- Outcome: the right controls for the right assets, independent of how confidently a client answers.

### Phase 5: evidence spine and automated control tests (large, highest commercial value)

- One evidence model per control assignment: uploaded documents (reviewed), automated test results (dated, with pass, fail and freshness), and monitoring facts.
- Scheduled control tests from the table in section 1, starting with controls 2, 8, 12 and 5.
- Guardrail-to-control links move from `guardrails.ts` into the registry mappings, respecting regulatory versus Other.
- Dossiers and reports include automated evidence with dates.
- Incident record (research gap 1) so control 10 can be tested.
- Merge `system_compliance` into the control assignment model; retire the older usage tables once nothing reads them.
- Outcome: controls show "operating, last tested 2 hours ago" instead of "evidence uploaded in March".

### Phase 6: questionnaire answering (medium)

- Map common enterprise questionnaire items (ISO/IEC 42001 Annex A, NIST AI RMF, standard vendor security and bank third-party AI questions) to controls.
- Export answers with evidence links and dates for a buyer's security review.
- Outcome: a sales and renewal tool for enterprise buyers.

### Phase 7: monitoring after the request (medium)

- Flag checks after the request via a queue; Block in the request path with measured-latency notice; response checks after the request by default.
- Can run in parallel with phases 1 to 3, since it is independent of the registry.

### Suggested order

Phase 0 now. Phases 1 and 2 together next, because they fix the drift problem you described. Then phase 5 (starting with the automated tests that need no new data), with phase 4 alongside it. Phase 3 once the registry has settled. Phase 6 when the first enterprise questionnaire arrives. Phase 7 whenever latency becomes a client concern, or earlier if a large client is in the pipeline.

---

## 5. Decisions needed

1. Approve phase 0 (production data corrections and a new methodology version).
2. Whether existing clients' controls should be re-derived by applicability in phase 4, which will assign some controls they currently do not have (correct, but visible to them).
3. Whether Flag-after-request (phase 7) should become the default for all organisations or opt-in first.
4. Whether to price a commercial regulatory feed (for example CUBE or Corlytics) once phase 3 shows the real change volume.
