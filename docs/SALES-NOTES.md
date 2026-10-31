# RegAnchor sales notes

Shipped features worth telling clients about, newest first. Source for the public site, the weekly change log email and sales conversations.

Rules for entries:

- Live in production only. Planned work goes under "Coming, do not market yet".
- One bold headline, one or two plain sentences on what the client gets. No hype, no em dashes, sentence case.
- Add a "Limits" line when a claim needs a qualifier to stay accurate. Accuracy beats reach: our buyers answer to the FCA and MFSA.

## 31 Oct 2026

- **See every model and tool your AI agents use.** RegAnchor lists the models and tools behind each agent, including MCP servers, with when each was first and last used. After a 7-day learning period it alerts you the moment an agent starts using a model or tool it has not used before.
  - Limits: records tool names only, never tool inputs or results. Requests must go through the RegAnchor gateway (Anthropic today).
- **Hard budget limits for AI spend.** Set a monthly budget per agent or for the whole organisation to block new requests once it is reached, not just warn. Admins can lift a block for the rest of the month with a written reason, and every lift is audited.
- **Spend at your contracted price.** Record the discount in your Anthropic contract and every request, budget and alert uses what you actually pay. RegAnchor also checks the discount against Anthropic's billing and tells you if they differ.
- **Budget alerts in app and by email.** RegAnchor checks spend every 10 minutes and raises an alert when a budget hits its warning level, goes over, or is projected to. Each person chooses whether they also get an email.
- **Independent check against the provider's own figures.** Daily reconciliation compares RegAnchor's request records with Anthropic's usage and cost reports, so a gap in either shows up.
- **Monthly AI budgets with projections.** Budgets for the organisation and each agent, showing confirmed spend, spend awaiting reconciliation, and where the month is heading.

## 30 Oct 2026

- **A monitored gateway for AI agents.** Agents send requests through RegAnchor instead of straight to the provider. Every request is recorded and priced to a fraction of a cent, with model, tokens, speed and outcome.
- **Data loss prevention on prompts and responses.** Through Cloudflare AI Gateway, your data protection policies can flag or block sensitive data on the way in and out.
  - Limits: applies once the organisation is routed through Cloudflare AI Gateway.
- **You choose what happens if monitoring is down.** Keep requests flowing and recorded, or refuse them until monitoring is back.
- **Prompt capture you control.** Off by default. When on, prompts and responses are kept for a retention period you set, and every time someone views one, that is recorded in the audit log.
- **A monitoring page for the whole organisation.** Spend, requests, data protection findings and issues across all agents, with a full record for each request.

## Coming, do not market yet

- AWS Bedrock route, so agents running on Bedrock can be monitored the same way.
- Supplier AI integration standard: what to require from AI suppliers, by risk tier, so a firm can monitor and control a supplier's AI used on its behalf.
