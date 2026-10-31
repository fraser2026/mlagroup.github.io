# Cloudflare AI Gateway for RegAnchor monitoring and controls

Source: planning session with Cloudflare's AI agent (2026-10-29). The original text is preserved below under "Original plan".

## Verified corrections (read first)

Checked against `supabase/functions/gateway-anthropic/index.ts`, `docs/GATEWAY.md`, the migrations, and Cloudflare documentation on 2026-10-29. Where this section and the original plan disagree, this section wins.

1. **No shared BYOK key.** The gateway already uses each asset's own Anthropic key from Supabase Vault (`provider_connection_read_secret`). Keep sending `x-api-key` per request. Storing one "default" Anthropic key in AI Gateway would route every client's traffic and spend through a single key.
2. **Prompts and completions are not stored today, by design.** `gateway-anthropic` and `docs/GATEWAY.md` state content is never persisted, and the Trust page says the same. Storing full prompts and responses in Supabase is a new product and privacy decision (opt-in per organisation, retention period, DPA and Trust page updates), not part of the gateway switch.
3. **Supabase region is EU (Ireland, eu-west-1)**, not Frankfurt. Render (PDF generation) is in Frankfurt.
4. **The custom controls do not exist yet.** There is no policy evaluation, risk scoring, redaction or human-review queue in `gateway-anthropic`. Today it authenticates the `ra_gw_` token, resolves the asset and Vault key, forwards to Anthropic and records tokens in `asset_usage_events`. Those controls are new build work.
5. **Identifiers.** RegAnchor has `org_id` (client) and `asset_id` (agent), not `client_id` / `agent_id`. Metadata is limited to 5 entries per request.
6. **AI Gateway logs are short-lived for this account.** Accounts whose first gateway is created on or after 24 Sep 2026 use Workers Logs retention (days, not years). Supabase stays the system of record: store `cf-aig-log-id`, cost, status, latency and DLP outcome on our own usage row.
7. **Logpush exports full payloads regardless of `cf-aig-collect-log-payload`.** Cloudflare: "The `cf-aig-collect-log` and `cf-aig-collect-log-payload` headers do not change what Logpush exports." Enabling Logpush would export prompts and responses (RSA-encrypted) even when payload collection is off. Only enable it after a retention decision, to an EU-jurisdiction R2 bucket.
8. **DLP on the current plan covers two profiles only:** Financial Information, and Social / Insurance / Tax / National Identifier Numbers. PII, credentials and custom profiles need a Cloudflare Zero Trust DLP subscription. Cloudflare ships these profiles with every detection entry switched off, so attaching a profile to a policy detects nothing until the entries are enabled (done 2026-10-30: 13/13 and 14/14).
9. **Guardrails are not free.** They run Llama Guard on Workers AI, billed per token, and need the request and response content to evaluate.
10. **Spend limits are best effort.** Eventually consistent (concurrent bursts can overshoot) and only for models with known pricing. Blocks return `429`.
11. **Step 9 `wrangler.jsonc` is the wrong file.** The repo-root `wrangler.jsonc` is `mla-report-generator`. The `reganchor-gateway` Worker source is not in this repo.
12. **Gateway authentication** (`cf-aig-authorization`) needs a Cloudflare API token with AI Gateway Run permission, stored as a Supabase Edge Function secret. Never in browser code.
13. **Payload collection off at Cloudflare for every organisation**, not only EU clients. Content capture, where an organisation opts in, happens in RegAnchor's EU storage instead (see Decisions).
14. **Per-organisation controls do not scale as Cloudflare rules.** DLP, rate limiting and caching are gateway-wide, and spend limits allow 20 rules per gateway. One "split by `org_id`" rule gives every organisation the same budget. Organisation-specific budgets and rate limits must be enforced in `gateway-anthropic`, with Cloudflare rules as a global backstop.
15. **Metadata is one header.** Send `cf-aig-metadata` as a JSON object (max 5 keys, string/number/boolean values), not one `cf-aig-metadata-*` header per key.
16. **DLP blocks return HTTP 400** with Cloudflare error code `2029` (request blocked) or `2030` (response blocked). A `2030` block happens after Anthropic has generated, and billed, the response.
17. **DLP response scanning buffers streamed answers.** With the check set to Request and Response, Cloudflare holds the whole stream before releasing it, which delays the first token. Latency-sensitive agents should use request-only scanning.

---

## Decisions (2026-10-30)

- **Test with Fraser's own Anthropic asset first** (a new key may be needed).
- **Prompt and response capture is a per-organisation setting.** On for RegAnchor's own test organisation; off by default for clients; offered as an Enterprise capability with configurable retention.
- **Cloudflare never stores content.** `cf-aig-collect-log-payload: false` on every request. When an organisation opts in, content is written to RegAnchor's EU storage only.
- **Design for scale from the start:** partitioned event table, content in object storage rather than table rows, retention by plan, upgrade paths on Supabase and Cloudflare.

## Product principles for later builds (Fraser, 2026-10-31)

- **Many providers, one view.** Anthropic first, but clients will run OpenAI, Google and others, often through AWS Bedrock or Microsoft Foundry, across many models. Keep provider, infrastructure and interface as separate dimensions in data and UI. Monitoring must scale to many providers, keys and agents without becoming crowded: filter by provider, roll up by default, drill down on demand.
- **Simple for the user, rigorous underneath.** Governance and monitoring should feel simple even when the backend is complex.
- **Frictionless setup.** Not every client is comfortable with API keys. Connecting a provider and turning on monitoring should take as few steps as possible, with clear guidance and checks that confirm each step worked. Write the setup guide once the build reaches its target shape, not before.
- **Owner oversight.** RegAnchor (MLA Group) will need an operator view to manage every client's monitoring health. Not now; keep data shaped so it is possible.
- **Notifications before email.** Budget and control alerts appear in the app first; email is an opt-in per user.
- **Industry standards and security** are part of every build, not a later pass.

## Build plan

### Phase 0 — setup (Fraser)

1. Register a new Anthropic API key and connect it to a test Anthropic asset in the app (asset → Connection).
2. Create AI Gateway `reganchor-governance`: authentication on, logs on, cache off.
3. Create a Cloudflare API token with **AI Gateway: Run** only. Store it as Supabase secret `CF_AIG_TOKEN`.

### Phase 1 — route and record (no client impact)

Built in `supabase/migrations/20261030120000_gateway_request_events.sql` and `supabase/functions/gateway-anthropic/index.ts`.

- Deployed `gateway-anthropic` (version 7) confirmed identical to the repo before editing.
- `org_gateway_settings` per organisation: `route_via_ai_gateway` (off by default), `fail_mode` (`open` sends direct to Anthropic and records `direct_fallback` if Cloudflare is unreachable; `closed` refuses with 503), `capture_content` (off by default), content and event retention days.
- `gateway-anthropic` routes enrolled organisations through `reganchor-governance` with the asset's own key, `cf-aig-authorization`, `cf-aig-collect-log-payload: false`, and `cf-aig-metadata` = `org_id`, `asset_id`, `token_id`, `event_id`, `environment`. DLP blocks and Cloudflare rate limits are controls and are never bypassed by the fallback. Errors reach clients in Anthropic's own error format. Every response carries `x-reganchor-event-id`.
- `gateway_request_events`, partitioned by month (created through Dec 2027; the gateway tops up three months ahead on start-up, and a default partition catches anything else). One row per request, including blocked, failed, rate-limited and client-cancelled streams: route, outcome, HTTP status, error type and code, latency to first byte, total duration, requested and served model, Anthropic `request-id`, `cf-aig-log-id`, DLP action and findings, content path.
- `asset_usage_events` is still written on success so existing screens keep working.
- Content capture (opted-in organisations only): request and response, streamed text included (8 MB cap), gzipped to the private `gateway-content` bucket at `org/yyyy/mm/dd/event.json.gz`. Service role only; reading it in the app comes with Phase 2 (organisation admins and auditor engagements).

#### Cost accuracy

Cost is priced per request from the usage block Anthropic returns, which is what Anthropic bills on. Nothing is estimated.

- Every billed dimension is stored separately: input, 5-minute cache writes, 1-hour cache writes, cache reads, output, thinking tokens (already inside output), web searches, web fetches, code execution requests, service tier, inference region and speed.
- `model_prices` holds Anthropic's published rates per exact model ID (dated snapshots match too), with an effective period and source URL. It covers cache multipliers (including the 0.05x and 0.025x read rates on newer models), fast mode, Haiku 5.5's over-100k prompt pricing, the 1.1x US-only inference multiplier, and $10 per 1,000 web searches.
- A database trigger prices each row on insert. The row keeps the price row used, the rate basis and every line item, so each figure can be traced. `gateway_events_reprice` re-prices a window if a rate is corrected.
- `cost_status` says how far each figure can be trusted. `priced` is exact at list price. `partial` means part of the charge is billed elsewhere, such as code execution hours. `unpriced` means no rate is on record for the model, and the cost is never guessed. `needs_reconciliation` covers priority tier, an unknown region, cancelled streams and DLP response blocks. `not_billable` means nothing was charged.
- Verified on 2026-10-30 against 12 worked cases in a local Postgres. All matched hand-calculated amounts to the cent fraction.

Reconciliation (Phase 2): compare daily totals per Anthropic API key with the Admin API cost report, and per event with AI Gateway's logged cost. Negotiated discounts appear as a steady gap, which can then be held as an organisation rate override. Add new models to `model_prices` the day they launch; `unpriced` events surface in the review index until then.

### Phase 2 — monitoring in the app

Built 2026-10-30:

- Asset → Connection → Gateway activity: summary (requests, exact spend, DLP findings, issues, median and p95 latency, tokens), daily spend chart, activity table (time, model, outcome, DLP, tokens, cost, latency) with All / DLP findings / Issues filters, and a request drawer (cost line items and rates, cost status, usage, DLP findings by detection, route, Anthropic and Cloudflare IDs).
- Organisation → Monitoring (`/gateway`): enforcement posture (routing, fail mode, capture, retention), the same summary across all agents, spend by agent and by model.
- `gateway_usage_summary(org, asset, since)` runs as the caller, so event RLS applies; anon cannot execute it.
- Tokens: name at mint, rename (audited), created time, last used (`asset_gateway_tokens.last_used_at`, written by the gateway at most once a minute per token) and request count for the window.
- Captured content: `gateway-content` returns it to organisation owners and admins only, refuses content past the retention period, and writes `gateway_content_viewed` to the asset audit log on every read.
- Costs below one cent keep three significant digits (for example $0.0000321); full eight-decimal values show on hover and in the drawer.

Budgets (2026-10-30):

- `gateway_budgets`: one monthly budget per organisation and one per agent, in USD to the cent, with a warning level (default 80%). Members can read; writes go through `gateway-budget` (owners and admins), and every set, change and removal is written to the audit log with from and to values. `enforcement` is `monitor` or `block` (see Enforcement below).
- `gateway_budget_status(org, at)` measures spend for the calendar month in UTC (the boundary providers bill on), using half-open bounds so a request at 00:00:00.000 on the 1st belongs to the new month.
- Spend = exact (`priced`) + awaiting reconciliation (`needs_reconciliation`, `partial`). Requests with no price are counted separately and shown as a warning, because spend is incomplete while any exist; they are never estimated.
- States: Over budget at 100%, Warning level reached at the warning level, Projected over when spend divided by the elapsed share of the month passes the budget. Projections start after three full days, so an early spike cannot produce a misleading forecast.
- Verified in a local Postgres against month-edge timestamps, every state, projection cut-off and RLS (non-members see nothing, anon cannot execute).

Reconciliation (2026-10-31):

- Source: Anthropic Usage and Cost Analytics API (beta `analytics-usage-cost-2026-08-24`), read with the organisation Admin key. Usage is grouped by API key and model per UTC day; cost is also split by `cost_type`. Amounts arrive as cents with six decimals and are held as integer units of $0.00000001, so nothing is rounded.
- One row per organisation, provider API key and UTC day in `gateway_reconciliation_days`, with Anthropic's token counts, list cost and billed cost (after discounts, before credits) beside what the gateway recorded. Members can read; only the `gateway-reconcile` function writes.
- Every event now carries `provider_api_key_id`, so reconciliation stays exact after a key rotation. Older events were backfilled from the asset's current key.
- Status: Matched (every token type identical and recorded cost within $0.000001 plus $0.00000001 per request of list price), Anthropic reports more (usage on the key outside the gateway, or tokens generated after a cancelled stream), Gateway recorded more, Price difference (tokens match, list price differs: the price table needs updating), Awaiting Anthropic (day ends after `data_refreshed_at`).
- Known, labelled differences: priority tier list price is excluded because Anthropic reports no token cost for commitment traffic; code execution hours and session charges are billed outside requests and shown, not compared; request counts are for reference only.
- Final once Anthropic stops revising (about seven days after month end); provisional until then. Runs daily at 06:30 UTC via `pg_cron` (trailing eight days, plus the previous month during days 1 to 8) and on demand from Monitoring (owners and admins, audited).
- Verified in a local Postgres and against the shared comparison module: midnight boundary, key rotation, revoked connections, priority tier, cancelled streams, exact tolerance edge, settlement dates, privileges and RLS.

Budget alerts (2026-10-31):

- `gateway_budget_alerts_sync()` runs every 10 minutes via `pg_cron`, and straight after a budget is saved. It raises one in-app alert per budget, month, level (warning, over, projected over) and budget amount, so changing a budget re-arms its alerts. Alerts appear on Notifications with a link to Monitoring.
- Email is opt-in per user and per organisation in Settings (`notification_preferences`, off by default, each user reads and edits only their own). When someone opted in, the database hands the alert to `send-mail` through `pg_net`, authenticated by a Vault secret generated in the database. `send-mail` claims the alert once, sends only to current members who opted in, and releases the claim if every send fails.
- Governance alerts from Check now no longer email automatically; they follow the same opt-in.
- Verified in a local Postgres: wording and amounts, each level once per month, re-arm on change, new month, organisation scoping, email no-op when nobody opted in, privileges and preference RLS.

Contracted pricing (2026-10-31):

- `gateway_price_agreements`: a discount off Anthropic list price per organisation, for all models or one model, with a UTC start date (inclusive) and optional end date (exclusive). A model-specific agreement takes precedence over an all-models one. Agreements for the same models cannot overlap (trigger, advisory lock, `23P01`). Members read; writes go through `gateway-pricing` (owners and admins), audited with from and to values.
- Each event keeps `cost_usd` at list price and adds `contract_cost_usd` (list less the discount in effect on the day, equal to list when there is no agreement) plus `price_agreement_id`. Spend, budgets, alerts and the usage summary all use contracted spend; reconciliation still compares list price and token counts with Anthropic, so a discount cannot hide a usage difference.
- Saving or removing an agreement re-prices the organisation's requests from the earliest affected day, then re-runs budget alerts.
- The Pricing section suggests the discount Anthropic actually billed (`gateway_price_agreement_suggestion`, last 30 days of settled reconciliation) once there are at least seven days and $1 of list spend, and flags a recorded discount that differs from billing by half a point or more.

Enforcement (2026-10-31):

- A budget set to block refuses new requests once contracted spend reaches 100%. Agent budgets are checked before the organisation budget. The gateway returns Anthropic-shaped `permission_error` 403 (not retried by SDKs) naming the budget, and records the request as `blocked_budget`, not billable. Requests already in flight finish, so spend can end slightly above the limit.
- While any blocking budget applies, a model with no verified price is refused (`blocked_unpriced_model`), because its spend cannot be counted. Monitor-only budgets never block.
- Spend is read from `gateway_spend_counters` (organisation, agent, UTC month), kept by a row trigger on every insert, re-price and delete, and rebuilt nightly at 00:20 UTC for the current and previous month as a consistency check.
- If the check itself fails, the organisation's fail mode applies: open sends the request, closed refuses it with 503 and records a gateway error.
- An owner or admin can lift a block for the rest of the UTC month with a written reason (10 to 500 characters), and reinstate it. Both are audited; a lift never carries into the next month.
- Verified in a local Postgres: contract pricing at the UTC midnight boundary, model precedence and dated snapshots, overlap rejection, counters equal to budget status after insert, re-price and delete, agent and organisation blocks, unpriced refusal, lift and reinstate, privileges and RLS.

Still to do: daily rollups once volume needs them, CSV export, per-event cross-check with AI Gateway logged cost, multi-provider pricing agreements.

### Bedrock route (plan, 2026-10-31)

Why: suppliers to financial services firms often run Anthropic models on AWS Bedrock, frequently in the client's own AWS account. This is the Enforced level of `docs/SUPPLIER-AI-STANDARD.md` for Bedrock. Model provider stays Anthropic; infrastructure becomes AWS Bedrock (separate dimensions, per product principles).

Confirmed in Cloudflare documentation (Bedrock provider page, updated 2026-09-10):

- AI Gateway has an `aws-bedrock` provider, including Bedrock's Anthropic-native Messages API on the `bedrock-mantle` endpoint: `https://gateway.ai.cloudflare.com/v1/<ACCOUNT_ID>/<GATEWAY_ID>/aws-bedrock/bedrock-mantle/<AWS_REGION>/anthropic`, with `/v1/messages` appended. Requests, responses and server-sent events pass through without translation, so suppliers keep sending Anthropic Messages format and our usage parser should apply unchanged.
- Model IDs carry the `anthropic.` prefix (for example `anthropic.claude-opus-5`). Stored credentials need the IAM action `bedrock-mantle:CreateInference`. Not every region supports `bedrock-mantle`.
- Authentication to Bedrock is either AWS credentials (Signature Version 4) or an Amazon Bedrock API key.

Design:

1. **Per-organisation AWS credentials, never a shared gateway key.** AI Gateway's stored provider keys are gateway-wide, which would put every client's Bedrock traffic on one AWS account (the same reason as verified correction 1). `gateway-anthropic` supplies credentials per request instead.
2. **Preferred: cross-account role.** The client creates an IAM role in its AWS account that trusts RegAnchor's AWS principal, with an external ID unique to the organisation, allowing only `bedrock-mantle:CreateInference` on the approved models (plus the read-only permissions of the Observed level if wanted). RegAnchor assumes it with AWS STS, caches the temporary credentials until shortly before expiry, and signs each request. Billing, data location and Bedrock logs stay in the client's account. Needs a RegAnchor AWS principal whose only permission is `sts:AssumeRole`, held as an Edge Function secret.
3. **Fallback: Bedrock API key** stored per asset in Vault, like the Anthropic key today. Simpler to set up; AWS recommends short-term keys, so treat as a pilot option.
4. **Connection model.** An asset's connection gains infrastructure (`anthropic_api` or `aws_bedrock`), AWS region, and role ARN or key reference. Tokens, budgets, enforcement, DLP and content capture work unchanged; events record `infrastructure` and region.
5. **Pricing.** Add Bedrock rows to `model_prices` only from AWS's published Bedrock pricing, per region and inference type, with source URL and verification date. Never assume Anthropic list price. Until a model is priced it records as unpriced, and blocking budgets refuse it (existing behaviour).
6. **Reconciliation.** Anthropic's Admin API does not cover Bedrock. Use AWS Cost Explorer (`ce:GetCostAndUsage`, daily, filtered to Bedrock and grouped by usage type) through the same role. Later phase.
7. **Fail mode.** Open sends direct to Bedrock, signed the same way, and records `direct_fallback`; closed refuses with 503.

Spike before building (Fraser's own AWS account):

- Prerequisites: an AWS account with Anthropic model access on Bedrock in a region that supports `bedrock-mantle` (prefer EU; confirm which), and a test IAM role.
- Send one streamed and one non-streamed request through `reganchor-governance` via `bedrock-mantle`. Confirm: usage fields including cache tokens, `cf-aig-log-id`, DLP applies on the Bedrock path, error shapes, added latency, and whether client-side signing or a Bedrock API key passes through cleanly.
- Then build in order: connection schema and role setup flow, gateway route, verified price rows, Connection tab UI, Cost Explorer reconciliation.

### Phase 3 — controls

- DLP (Financial Information, national identifiers) on request and response. Two gateways, `reganchor-flag` and `reganchor-block`, so each organisation's DLP mode is a routing choice rather than a per-org rule.
- Organisation and asset budgets and rate limits enforced in `gateway-anthropic`; one Cloudflare spend limit split by `org_id` as a backstop.
- Alerts for DLP matches, in-app first with opt-in email, the same way as budget alerts.

### Phase 4 — enterprise

- Retention tiers by plan; scheduled purge of expired content and partitions.
- Logpush to an EU-jurisdiction R2 bucket (encrypted) for long-term archive, only for organisations with capture enabled (correction 7).
- Guardrails (Llama Guard) as a billed Enterprise option; custom policy engine, redaction and human review queue.
- Fuller DLP (personal data, credentials, custom patterns) if Cloudflare Zero Trust DLP is added.

### Before any client traffic

- Trust page and privacy notice: Cloudflare purpose includes AI request monitoring; optional content capture, where it is stored and for how long.
- DPA wording for optional content capture.

---

## Original plan

> This document captures the complete context from a planning session with Cloudflare's AI agent.
> It covers architecture decisions, compliance analysis, control layers, and setup instructions.

### 1. What RegAnchor Is

RegAnchor is an AI governance platform that lets clients (financial services firms in UK/EU) monitor and control their AI agents under regulatory scrutiny (GDPR, EU AI Act, FCA, ESMA). Clients connect their AI agents through RegAnchor, which provides monitoring, enforcement controls, and audit trails.

The goal: a Chief Risk Officer at a finance company can see exactly what their AI agents asked, what the AI answered, what policy applied, whether sensitive data was detected, and can export this for regulators.

### 2. Current Architecture (as of 2026-10-29)

```
Client agent
    │
    ▼
Cloudflare Worker (reganchor-gateway)     ← thin edge proxy, just CORS + forwarding
    │
    ▼
Supabase Edge Function (gateway-anthropic) ← governance logic lives here
    │
    ▼
Anthropic API (direct, using user's own key)
```

- **4 Cloudflare Workers** on account `40074a03408bb2b183c964e22d1e2bea`:
  - `reganchor-gateway` — edge proxy, forwards `/v1/messages` to Supabase Edge Function. Observability (logs) at 100% sampling. Traces not enabled. No bindings.
  - `reganchor-mcp-host` — edge proxy for MCP OAuth endpoints, forwards to Supabase. Uses `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
  - `reganchor-admin` — deployed but empty/unknown
  - `reganchor-app` — deployed but empty/unknown
- **Supabase project** `hueftewwenjaiagdoqmb.supabase.co`: Edge Function `gateway-anthropic`, MCP OAuth functions, PostgreSQL, Auth, storage, realtime.
- **Current monitoring**: cost, tokens, model only (via Anthropic admin API). Not enough.
- **Account plan**: Cloudflare Free. Workers Paid ($5/mo) for Logpush and higher log retention.

### 3. Target Architecture

```
Client agent
    │
    ▼
Cloudflare Worker (reganchor-gateway)          ← edge proxy, global low-latency
    │
    ▼
Supabase Edge Function (gateway-anthropic)      ← CUSTOM CONTROLS (client-specific)
    │  - Client-specific policy rules
    │  - Custom risk scoring
    │  - Human-in-the-loop queuing
    │  - Custom redaction
    │  - Regulatory-specific rules (FCA, ESMA, GDPR)
    │  - Audit trail with business context
    │
    ├─ Blocked → return 403 (never reaches AI Gateway)
    ├─ Redacted → modify prompt, forward
    ├─ Human review → queue, return "pending"
    │
    ▼ (if allowed)
Cloudflare AI Gateway (reganchor-governance)    ← BUILT-IN CONTROLS (no code)
    │  - DLP (PII/financial data detection — flag or block)
    │  - Spend limits (per client/agent/model, blocks at threshold)
    │  - Rate limiting (sliding window)
    │  - Guardrails (content screening)
    │  - Automatic logging: cost, tokens, model, latency, status, prompt, response
    │
    ▼
Anthropic API
    │
    ▼ (response flows back through all layers)
    ├─ AI Gateway: logs response, DLP checks response, logs guardrails
    ├─ Supabase: inspects response, writes audit record (linked via cf-aig-log-id)
    └─ Worker: returns to client
```

| Layer | Platform | Controls |
|---|---|---|
| Custom governance | Supabase | Client-specific policies, risk scoring, human review, custom redaction, regulatory rules, audit trail |
| Built-in controls | Cloudflare AI Gateway | DLP, spend limits, rate limiting, guardrails, cost/token/latency logging |

### 4. The gateway switch

In `gateway-anthropic`, change `https://api.anthropic.com/v1/messages` to:

```
https://gateway.ai.cloudflare.com/v1/40074a03408bb2b183c964e22d1e2bea/reganchor-governance/anthropic/v1/messages
```

Headers: `cf-aig-authorization: Bearer <CF_AIG_TOKEN>`, `cf-aig-metadata-client_id`, `cf-aig-metadata-agent_id`, `cf-aig-metadata-policy_version`, `cf-aig-metadata-risk_score`, `cf-aig-metadata-environment`. Capture `cf-aig-log-id` from the response. For EU clients: `cf-aig-collect-log-payload: false`.

### 5. Setup steps (original order)

1. Create AI Gateway `reganchor-governance`: collect logs, authentication on, cache TTL 0, rate limit 100 req / 60s.
2. Store Anthropic key (BYOK), or keep passing `x-api-key` per request. *(See correction 1: keep per-request.)*
3. Update `gateway-anthropic`: URL, `cf-aig-authorization`, metadata headers, capture `cf-aig-log-id`, write `aig_log_id` to the audit record, payload off for EU.
4. Test with own Anthropic key; verify logs, cost, tokens, latency.
5. DLP: profiles, Flag or Block, Request + Response. *(See correction 8.)*
6. Guardrails. *(See correction 9.)*
7. Spend limits per client / per model, up to 20 rules per gateway.
8. Logpush to R2 `reganchor-archive`. *(See correction 7.)*
9. Traces on `reganchor-gateway`. *(See correction 11.)*

### 6. Headers reference

| Header | Purpose |
|---|---|
| `cf-aig-authorization` | `Bearer <CF_AIG_TOKEN>` — gateway auth |
| `x-api-key` | Anthropic key (per asset, from Vault) |
| `cf-aig-metadata-{key}` | Custom metadata (up to 5 pairs) |
| `cf-aig-collect-log-payload` | `false` to suppress prompt/response storage |
| `cf-aig-collect-log` | `true`/`false` to override gateway log setting |
| `cf-aig-cache-ttl` | Override cache TTL |

Response headers: `cf-aig-log-id` (UUIDv7, store in Supabase), `cf-aig-request-id`, `cf-aig-dlp` (JSON: action, matched policy, profile and entry IDs, only when DLP matched).

### 7. AI Gateway Logs API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/logs` | List logs |
| GET | `/accounts/{account_id}/ai-gateway/gateways/{gateway_id}/logs/{id}` | Log detail |
| GET | `.../logs/{id}/request` | Request body |
| GET | `.../logs/{id}/response` | Response body |
| PATCH | `.../logs/{id}` | Feedback / score / metadata |

Filterable by time range, model, status code and custom metadata.

### 8. Workers Observability (GraphQL)

`POST https://api.cloudflare.com/client/v4/graphql`

```graphql
{
  viewer {
    accounts(filter: {accountTag: "40074a03408bb2b183c964e22d1e2bea"}) {
      workersInvocationsAdaptive(
        filter: { scriptName: "reganchor-gateway", datetime_geq: "2026-10-22T00:00:00Z", datetime_leq: "2026-10-29T00:00:00Z" }
        limit: 10000
        orderBy: [datetimeHour_ASC]
      ) {
        sum { requests errors }
        dimensions { datetimeHour }
      }
    }
  }
}
```

### 9. Data residency

| Platform | EU available? | Notes |
|---|---|---|
| Supabase | Yes | Primary database (Ireland, see correction 3) |
| Cloudflare D1 / R2 / KV | Yes | `eu` jurisdiction |
| Cloudflare AI Gateway logs | No | Keep payload collection off |
| Cloudflare Workers processing | No (Free/Pro) | Regional Services is Enterprise |

Decision: stay with Supabase for storage and governance logic.

### 10. Client dashboard (CRO view)

Questions: what agents asked, what the AI answered, sensitive data exposure, what was blocked, spend, budget status, who approved high-risk requests, regulator export, EU residency, output safety.

Views: Live agent monitor, Client summary, Spend by agent, DLP findings, Cost over time, Audit detail (exportable).

### 11. What not to change

- Keep governance logic in Supabase.
- Apply changes to the existing `gateway-anthropic`; do not replace it with a template.
- Keep the `reganchor-gateway` edge Worker.
