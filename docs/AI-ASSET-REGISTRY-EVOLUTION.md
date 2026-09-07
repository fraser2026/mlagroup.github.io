# AI Asset Registry — evolution (living status)

Canonical detailed plan: Cursor plan `AI Asset Registry Evolution` (`ai_asset_registry_evolution_05daa9fd`).

This file is the **repo-facing status** so local and production stay aligned with intent.

## Where we are (2026-09-04)

| Phase | Status |
| --- | --- |
| 1 Taxonomy / Registry UI | Done |
| 2 Provider connections + Vault | Done |
| 3 Anthropic live connector | **Done locally** (verify, attribution, insights, cost copy polish) |
| 3b Org-level Admin API keys UX | **Done locally** — Organisation → Providers |
| 4 Usage / monitoring product | **Done locally** — snapshots, sync edge, Analytics ledger, cost estimates |
| 5 Developer CLI | **Done locally** — `cli/` + Connection tab commands |
| 6 RegAnchor MCP | **Done locally** — `mcp/` |
| 7 More providers | **Done locally** — OpenAI + Google verify; Bedrock/Azure honest IAM stubs |
| 8 Governed Anthropic gateway | **Done locally** — see `docs/GATEWAY.md` |

**Go-live still required:** apply migrations `20260904120000`–`20260904150000`, deploy new/updated edge functions, point `gateway.reganchor.com`, push portal static assets. Do not test via `file://`.

## Locked product model

- **Admin key** — once per provider at organisation level (Anthropic first). UI: Organisation → Providers.
- **Runtime key** — on the AI asset Connection tab (same key in Cursor/apps/CLI).
- **Tokens** — asset-scoped when runtime key is matched.
- **Cost** — org/workspace context from Admin cost report; estimated asset $ is a signal only.
- **CLI / MCP** — ops and in-workflow governance; do not replace Admin metering.
- **Gateway** — optional hard path for controlled prod traffic (`docs/GATEWAY.md`).
