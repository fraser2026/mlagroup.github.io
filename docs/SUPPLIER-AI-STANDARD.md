# Supplier AI integration standard

How a client firm governs and monitors AI that a supplier runs on its behalf, using RegAnchor. Written for RegAnchor (MLA Group Ltd) to use with clients and their suppliers. Draft, 2026-10-31; updated 2026-11-02 (Enforced does not depend on whose cloud runs the model).

Example: a wealth firm (the client) uses an AI product from a supplier, and the supplier calls Anthropic models directly or through AWS Bedrock.

## Principle

The client firm stays responsible for outsourced activity. Under the FCA's outsourcing rules (SYSC 8) a firm cannot delegate its regulatory responsibility to a supplier, and the EU AI Act places monitoring and log-keeping duties on organisations that deploy high-risk AI systems, not only on the provider. So the client needs evidence that it oversees the supplier's AI, in proportion to the risk.

Oversight is set per supplier by risk tier. The client writes the required integration level into the supplier contract, using the clauses below, and RegAnchor supplies the technical route for each level.

## Terms

- **Client firm**: the RegAnchor customer, for example a wealth manager. Owns the obligation.
- **Supplier**: the company providing the AI product, for example an AI software vendor.
- **Model provider**: Anthropic, OpenAI and others. **Infrastructure**: Anthropic's own API, AWS Bedrock, Microsoft Foundry. Recorded separately.
- **RegAnchor**: the governance platform. Becomes a data processor for the client at the Enforced level, because requests pass through it.

## Risk tiers

| Tier | Typical supplier use | Minimum level |
|---|---|---|
| Low | Internal productivity, no client data, no client outcomes | Attested |
| Material | Processes client personal or financial data, or supports staff decisions | Reported or Observed |
| Critical | Produces client-facing output, advice, suitability or onboarding decisions, or runs at scale without human review | Enforced, with Observed or invoice reconciliation as the bypass cross-check |

The tier is recorded in the RegAnchor assessment for the supplier's asset and reviewed at least yearly, and whenever the supplier changes model, provider or use.

## Integration levels

### 1. Attested

The supplier provides evidence; nothing is measured.

- Evidence: security certification (for example SOC 2 Type II, ISO 27001, ISO 42001), data processing terms, subprocessor list including model provider and infrastructure, data location, training and retention terms, incident notification terms, model change notice terms.
- In RegAnchor: the supplier is a registry asset with an assessment and the AI Vendor Governance control; evidence is attached and reviewed.
- Limit: shows intent and terms, not behaviour. Not sufficient on its own for Material or Critical suppliers.
- Status: available (registry, assessment, controls, evidence review). A supplier upload link, so suppliers submit evidence directly, is to build.

### 2. Reported

The supplier sends RegAnchor a regular activity feed for the client's usage.

- Feed, per request or aggregated per day: timestamp, model and provider, infrastructure, input and output tokens, outcome, the supplier's own policy actions (for example refusals or redactions), cost if known, and a request identifier. No prompt or response content by default.
- In RegAnchor: spend, volume, model use and outcomes over time; alerts on budgets and unexpected models; observed evidence for monitoring controls.
- Limit: RegAnchor sees what the supplier reports and cannot block requests. Completeness is checked by comparing the feed with the supplier's invoices.
- Status: to build (ingestion API and schema). Prefer the OpenTelemetry generative AI conventions where the supplier already emits them.

### 3. Observed

The supplier runs the AI in the client's own cloud account, so the client already owns the logs. RegAnchor reads them with read-only access.

- AWS: the client creates an IAM role that trusts RegAnchor, with an external ID unique to the client, allowing read-only access to Bedrock invocation logging configuration, guardrail configuration, the invocation log group, cost data (`ce:GetCostAndUsage`) and CloudTrail events. RegAnchor reads metadata (model, tokens, timing, guardrail outcome, cost) and does not copy prompt or response content, which stays in the client's account.
- Enforcement happens in the client's cloud with AWS's own controls: Bedrock Guardrails (content and personal data filters), IAM limits on which models can be invoked, and AWS Budgets actions. RegAnchor checks these stay configured and reports drift.
- Limit: depends on invocation logging being switched on, and on the supplier deploying in the client's account.
- Status: to build (AWS connector). Permission list to be finalised and tested against a real account before offering it.

### 4. Enforced

The supplier sends the client's AI requests through the RegAnchor gateway. This does not depend on whose cloud account runs the model: the gateway forwards each request to the model in whichever account holds it.

- In RegAnchor: every request is authenticated per agent, priced, checked against budgets and data loss prevention rules, and can be refused; spend is reconciled with the provider's own figures; full audit trail. Everything in the Monitoring page today.
- Where the model runs:
  - Supplier's account (the usual case for a software vendor). Anthropic API: the supplier's Anthropic key is stored against the client's agent in RegAnchor. AWS Bedrock: the supplier deploys RegAnchor's CloudFormation role in its AWS account, a cross-account role with an external ID unique to the client that allows invoking approved Claude models and nothing else. The supplier keeps paying its provider as today.
  - Client's account. The client connects its own Anthropic key or AWS account the same way, and pays the provider directly. Observed can then run alongside as the bypass check.
- Limit: RegAnchor is in the request path, so the client and supplier agree a fail mode (fail open sends requests direct and records it; fail closed refuses them), and RegAnchor must meet the client's processor requirements (see RegAnchor's obligations). The supplier changes its configuration for the client's tenant (see the technical spec).
- Limit: when the supplier's account serves many customers, its provider bill cannot show on its own whether all of the client's traffic went through the gateway. Require per-customer usage tagging (clause 10) so the client's share can be reconciled.
- Status: available for Anthropic's API and for Claude on AWS Bedrock (verified 2026-11-02, see `docs/CLOUDFLARE-AI-GATEWAY.md`, Bedrock route). Bedrock requests use Anthropic's Messages format with Bedrock model IDs; suppliers calling Bedrock through the AWS SDK (Converse or InvokeModel) need a code change until the gateway accepts those formats.

## Contract clauses for the client firm

Plain-language starting points for the client's supplier agreement. They are not legal advice; the client's counsel adapts them.

1. **Integration level.** The supplier will integrate with the client's AI governance platform at the level set out in the schedule, within an agreed period, and maintain it for the term.
2. **No bypass.** At the Enforced level, the supplier will send all model requests made for the client through the gateway and will not route them around it, except under the agreed fail mode. At the Reported level, the feed will cover all model requests made for the client.
3. **Honour refusals.** The supplier will not retry or reroute requests refused by the gateway, and will show the refusal reason to the client's users where relevant.
4. **Change notice.** The supplier will give a set period of notice (for example 30 days) before changing model provider, model family, infrastructure, data location or subprocessors used for the client.
5. **Incidents.** The supplier will notify the client of AI-related incidents affecting the client within an agreed period (for example 24 hours of becoming aware), with the request identifiers involved.
6. **Data use.** Client data is not used to train or improve models, and is retained only for the agreed period.
7. **Logs and audit.** The supplier keeps request logs for the client for an agreed period and provides them, or access to them, on request and to the client's regulators.
8. **Evidence.** The supplier provides updated certifications and the subprocessor list at least yearly, and on material change.
9. **Exit.** On termination, the supplier provides logs and reasonable help to move the service.
10. **Usage tagging.** Where the supplier runs models in an account shared with other customers, it tags the client's model usage separately (for example an AWS application inference profile with a cost allocation tag for the client) and provides that tagged usage and cost, or read-only access to it, so the client can reconcile it with gateway records.

## Technical spec for suppliers (Enforced)

For the supplier's engineering team. Available now for Anthropic's API and for Claude on AWS Bedrock.

For Bedrock, the client first connects the AWS account that runs the model (the supplier's or its own) and links it to the agent, and the supplier sends Bedrock model IDs in the `model` field (for example `eu.anthropic.claude-haiku-4-5-20251001-v1:0`). Before the first request, the AWS account needs Anthropic's use case form submitted and one call to each Claude model by an AWS administrator, which creates the AWS Marketplace subscription that RegAnchor's role is deliberately not allowed to create.

1. The client registers the supplier's product as an agent in RegAnchor and mints a gateway token on its Connection tab. The token is shown once; the client gives it to the supplier through a secure channel.
2. For the client's tenant only, the supplier replaces the Anthropic address with the RegAnchor gateway address shown on the Connection tab, and sends the token as `Authorization: Bearer <token>` (or `x-reganchor-gateway-token` if the client library cannot set `Authorization`). The official Anthropic SDKs and Claude Code do this with `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN`.
3. The request and response formats are Anthropic's Messages API, including streaming. No other code change is needed.
4. A `403 permission_error` from the gateway is a policy refusal (for example a budget block). Do not retry it; show the message. `429` and `5xx` follow normal retry handling.
5. Every response carries `x-reganchor-event-id`. Log it with the supplier's own request record so incidents can be traced end to end.
6. Treat the token as a production secret: keep it in a secrets store, never in browser code or logs. Tokens do not expire; rotate on the client's schedule by minting a new token, switching, then revoking the old one.
7. Use one agent, and so one token, per distinct workload whose spend or risk the client wants to see separately. A multi-agent system that serves one purpose normally shares one agent.

Planned: an optional request header for sub-agent or task attribution within one agent.

## RegAnchor's obligations at the Enforced level

What a client's security review will ask of RegAnchor as a processor in the request path. These must be ready before Enforced is sold to regulated firms.

- Data processing agreement covering gateway traffic, with RegAnchor's subprocessors (Supabase, EU, Ireland; Cloudflare).
- Prompts and responses are not stored unless the client opts in to content capture; Cloudflare payload logging is off for every organisation.
- Documented fail modes, availability target and incident process.
- Security documentation and penetration test results; an independent certification (for example SOC 2) is the usual expectation for critical suppliers to regulated firms.

## Checking the supplier is not bypassing

- Enforced and Observed together: compare gateway records with the provider or AWS bills for the account that runs the model. RegAnchor's reconciliation already does this for Anthropic; AWS Cost Explorer reconciliation is to build. In a supplier's shared account, compare against the client's tagged usage (clause 10).
- Reported: compare the feed with the supplier's invoices to the client.
- All levels: a yearly supplier attestation that all model use for the client is covered.

## First questions to ask a supplier

1. Can you send all our model traffic through our governance gateway? If not, can you export usage and audit logs (API, security monitoring feed or file)?
2. Does the product run the models in our cloud account or yours, and if yours, is that account shared with other customers?
3. Which model providers and infrastructure does it use, and where is our data processed and stored?
4. Is our data used for training, and how long is it kept?
5. What certifications do you hold, and what are your incident and model change notice terms?

The first answer decides the level: yes means Enforced, logs only means Reported. The second decides the set-up, not the level: who connects the provider key or AWS role to RegAnchor, who pays the provider, whether Observed can run alongside as the bypass check (our account), and whether usage tagging is needed (a shared supplier account).
