# RegAnchor sales notes

Shipped features worth telling clients about, newest first. Source for the public site, the weekly change log email and sales conversations.

Rules for entries:

- Live in production only. Planned work goes under "Coming, do not market yet".
- One bold headline, one or two plain sentences on what the client gets. No hype, no em dashes, sentence case.
- Add a "Limits" line when a claim needs a qualifier to stay accurate. Accuracy beats reach: our buyers answer to the FCA and MFSA.

## 6 Nov 2026

- **Dossiers list every regulation they cite, with its status and a link to the official text.** The AI Governance Dossier now has a regulatory references table showing each cited article or rule, whether it is in force or the date it applies from, and a link to EUR-Lex, legislation.gov.uk or the regulator. Requirements that apply later, such as EU AI Act high-risk duties from 2 December 2027, are marked "applies from" wherever they appear.
  - Limits: covers requirements RegAnchor maps to its frameworks. Signed dossiers keep the references they were signed with.
- **One reviewed source for every citation.** Every article reference, penalty and date in assessments, the diagnostic and dossiers now comes from one requirement registry that MLA Group reviews against the official text. A correction made once appears everywhere, and dates roll from "applies from" to in force automatically.
- **Regulatory library updated to the law as it stands in November 2026.** Controls, assessments and reports now cite UK GDPR Articles 22A to 22D (in force since 5 February 2026), the EU AI Act dates set by the AI Omnibus (high-risk duties for credit scoring and insurance pricing from 2 December 2027), the final AI Act penalty levels, and the full scope of the fundamental rights impact assessment. EU GDPR and PRA expectations now appear as their own frameworks.
  - Limits: assessments and dossiers completed before this update keep the wording they were issued with.
- **Sharper high-risk screening in the AI governance diagnostic.** The diagnostic now asks about life and health insurance pricing, and no longer treats simple identity checks as high-risk biometric use, so the exposure score reflects how the EU AI Act actually classifies financial services AI.
- **Guardrails show which checks are governance evidence.** Checks that support a governance control say which one. General safety checks, such as hate, violence or defamation, sit under "Other safety checks" and are not presented as control evidence.

## 4 Nov 2026

- **Switch, test and prove every AI guardrail in one place.** The Guardrails tab in Monitoring lists every control on your agents' requests. Each one can be set to off, flag or block, tested on the spot with a real request sent as one of your agents, and opened to the requests where it fired, with the governance control it is evidence for. Every change and test is in the audit log.
  - Limits: applies to requests through the RegAnchor gateway (Anthropic and Claude on Amazon Bedrock today). Calls made straight to the provider are not covered. Test requests are labelled and left out of spend, budgets and reports.
- **Check prompts and responses for harmful content, prompt injection and sensitive data.** Through your organisation's own Cloudflare AI Gateway, RegAnchor checks prompts, responses or both for financial information, national identifiers, prompt injection and 14 harmful content categories, including specialised financial advice, privacy and defamation.
  - Limits: adds about half a second per request, and checking responses holds back a streamed reply until it has been checked. Content categories are judged by a safety model that supports English and seven other languages, and it can miss or over-flag. Cloudflare bills the checks as Workers AI usage. A change to these checks takes up to about a minute to apply everywhere. If the organisation sends requests direct while Cloudflare is unavailable, these checks do not apply to those requests.
- **Pause an agent at once.** Owners and admins can refuse every request from one agent, with a written reason, from the Guardrails tab or the asset page, and resume it later. Both are audited.
- **Control which models agents use, and add your own rules.** Each agent may only call the model in its registry entry plus any extra models you allow, an organisation-wide blocked list stops models you have not assessed, and your own phrases or patterns, such as a client account number format, can be flagged or blocked in prompts.
  - Limits: your own rules check prompts, not responses. Agents with no model in their registry entry and no extra models are not checked for model use.

## 2 Nov 2026

- **Know Claude on Bedrock works before your agents call it.** When you connect or check an AWS account, RegAnchor makes a one-token test call to Claude in each region in use. If AWS still needs Anthropic's use case form or a first call by an AWS admin, the account shows that step with a link to the right page in the AWS console.
  - Limits: Anthropic Claude models only. AWS bills each test call at a fraction of a cent.
- **Monitor and budget Claude on Amazon Bedrock through the RegAnchor gateway.** Agents running Claude on Bedrock in your own AWS account send requests through RegAnchor, and every request is recorded and priced at AWS's rate for that region, with the AWS account, region and route shown. Bedrock spend counts towards the same monthly budgets and hard limits as Anthropic spend, and your data protection policies check prompts and responses the same way.
  - Limits: Anthropic Claude models only. Prices are AWS list prices, not yet reconciled against your AWS bill. Data protection applies once the organisation is routed through Cloudflare AI Gateway. The AWS account needs Anthropic's use case form and one first call to the model by an AWS admin before the gateway can use it.
- **Connect your AWS accounts for Claude on Amazon Bedrock.** Connect each AWS account once through a guided CloudFormation setup that creates a narrowly scoped role, then choose which account and region each Bedrock asset uses. RegAnchor shows the Claude models each account can use in that region.
  - Limits: Anthropic Claude models only. Each AWS account is connected separately; AWS Organizations roll-out is guidance only.
- **See exactly what an agent did with its tools.** The prompt viewer shows each tool the model used, what it asked the tool for, and what came back, step by step, for normal and streamed replies.
  - Limits: needs prompt capture switched on, and only owners and admins can open it. Every view is audited.

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

- Bedrock spend reconciled against your AWS bill (AWS Cost Explorer).
- Agent and run tracking, so a multi-agent task shows as one trail with every model call, cost and control outcome.
- Supplier AI integration standard: what to require from AI suppliers, by risk tier, so a firm can monitor and control a supplier's AI used on its behalf.
