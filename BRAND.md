# Brand Reference — RegAnchor

RegAnchor is the trading name of **MLA Group Ltd**. The legal entity is unchanged. This document
is the single reference for deciding, at any given occurrence, whether "MLA" becomes "RegAnchor"
or stays as it is.

**Visual / portal aesthetic** (colours, type, report/portal UI rules) lives in [DESIGN.md](DESIGN.md).
Agents must follow both files.

## The entity

| Field | Value |
|-------|-------|
| Legal entity | MLA Group Ltd |
| Trading name | RegAnchor |
| Company registration | 16117562 (England and Wales) |
| ICO registration | ZB826186 |
| Registered address | 45 Fitzroy Street, 4th Floor, London, England, W1T 6EB |
| Telephone | 0151 558 0162 |
| Primary domain | reganchor.com |
| Legacy domain | mlagroup.co.uk (redirects during transition) |

The standing formula, already used in `privacy.html` and `terms.html`, becomes:

> **MLA Group Ltd** (trading as RegAnchor)

---

## The decision rule

Ask: *is this sentence describing who the contract is with, or is it describing the product?*

- **Contract, liability, data protection, registration, signature** → stays MLA Group Ltd.
- **Product, service, brand, marketing, UI copy** → becomes RegAnchor.

When genuinely ambiguous, prefer leaving the legal entity in place. An over-cautious legal
reference is harmless; an under-cautious one is not.

---

## Becomes RegAnchor

### Wordmark
The text pattern `mla<em>group.</em>` in every nav, sidebar, and footer. Replaced by `RegAnchor`
in CamelCase, set in IBM Plex Sans Medium, no italic, no trailing full stop inside the mark.

Affects: `index.html`, `platform.html`, `pricing.html`, `methodology.html`, `contact.html`,
`login.html`, `diagnostic.html`, `results.html`, `verify.html`, `privacy.html`, `terms.html`,
`payment-success.html`, `generate-pdf.html`, `assessment.html`, `report.html`,
`system-report.html`, `portal.html`, `admin.html`.

### Page titles
`… | MLA Group` becomes `… | RegAnchor` across all production pages.

### Product and marketing copy
Any sentence where "MLA Group" or "MLA" names the product or the service provider in a
non-contractual voice:

- `index.html` — hero body copy, "About MLA" footer link
- `platform.html` — "The MLA diagnostic produces…", "MLA provides the structured position…"
- `methodology.html` — "The MLA diagnostic…", "the MLA output…", "briefing through MLA Group"
- `pricing.html` — "MLA expert support" in the comparison table
- `contact.html` — "A member of the MLA Group team will respond"
- `results.html` — "MLA governance specialist"
- `verify.html` — "Back to MLA Group", "Enter an MLA Group certificate ID", the expired and
  revoked states
- `assessment.html` — "Anything MLA Group should know"
- `report.html`, `system-report.html` — advisory notes and findings copy
- `admin.html` — "MLA Admin Dashboard", "Need MLA action"
- `js/portal-core.js` — activity feed strings
- `js/portal-registry.js` — "Awaiting MLA Review", "MLA Group will review", "MLA Controls Issued"
- `js/portal-controls.js` — support thread labels, "Reply to MLA Group"

### Product naming
"MLA Governance Risk Report" becomes "RegAnchor Governance Risk Report". The generated PDF
filename prefix `MLA-Governance-Report_` becomes `RegAnchor-Governance-Report_`.

---

## Stays MLA Group Ltd

### Data protection — `privacy.html`
The data controller block, the ICO registration, and every sentence describing who holds and
processes personal data. Only the trading-name parenthetical changes.

### Contract — `terms.html`
The registered entity block, company number, VAT and IP ownership clauses, governing law, and
the definitions clause. Note that the definitions clause needs its defined term updated so the
document remains internally consistent:

> References in these Terms to "we", "us", or **"RegAnchor"** refer to MLA Group Ltd.

### Legal entity block — `contact.html`
Registered address, company number, telephone.

### Footer copyright
`© 2026 MLA Group Ltd` stays. The trading-name line is added alongside it, not in place of it.

### Certificates
The issuer line, the signatory organisation, and the certificate footer in
`certificate-template.html` and the portal thumbnail in `js/portal-cert.js`. A certificate is a
legal attestation, so it names the entity. The RegAnchor brand may appear alongside, but the
issuer remains MLA Group Ltd.

This matches the pattern already used in your own design work: `reganchorsystem.html` shows
"Director · MLA Group Ltd" on the dossier signature and "Operated by MLA Group Ltd" in the footer.

---

## AI governance terminology (registry, dossier, audit copy)

RegAnchor uses distinct terms for the AI value chain. Do not collapse them into "platform".

| Term | Use for | Example |
|------|---------|---------|
| **Provider** | Third party that develops or places a general-purpose AI model on the market (EU AI Act Art. 3(3)). Registry field: `provider_slug`. UI label: **Provider**. | Anthropic, OpenAI, Google |
| **Model** | Specific model identifier under that provider. Registry field: `model_name`. | Claude Haiku 4.5 |
| **Vendor** | Who supplies or built the AI capability for the organisation (may be in-house or a systems integrator). Registry field: `vendor`. | In-house, Accenture |
| **Deployer** | The RegAnchor customer's legal role when they **use** a third-party AI system in a professional context (EU AI Act Art. 3(4)). Dossier and assessment copy, not a registry column. | The law firm running the agent |
| **Provider connection** | Live API integration (runtime + admin keys, usage insights) between a registered asset and its model provider. UI tab: **Connection**. | Anthropic Admin API snapshot |
| **Platform** | RegAnchor the product, or marketing "explore the platform". **Never** for Anthropic/OpenAI in the registry. | "Governance platform" |

**Audit answer:** In an EU AI Act sense, Anthropic is the **provider** of the foundation model. Your customer is the **deployer** of that model in their agent or system. They may also be **provider** of their own branded AI system if they place it on the market under their name, but that is a separate classification from `provider_slug`.

Vanta and similar trust/GRC tools use **vendor** for third-party AI risk questionnaires; RegAnchor aligns with that for procurement (`vendor`) and with the AI Act for the model layer (`provider`).

Backend identifiers stay `provider_slug`, `provider_connections`, `provider_catalog` — already correct.

---

## Deferred, not part of phase one

| Item | Current | Reason for deferral |
|------|---------|---------------------|
| Email addresses | Public + ops default `info@reganchor.com` via `js/ra-contact.js` | Update EmailJS dashboard branding; FormSubmit must re-confirm |
| `CNAME` | Moving to `reganchor.com` | Confirm GitHub Pages custom domain in one step |
| Certificate ID prefix | `MLA-GOV-` | Generated in Supabase; new issues become `RGA-GOV-` at cutover, old IDs stay valid |
| Stripe product names | MLA Group | Cosmetic, dashboard-side |
| Render service hostname | `mla-pdf-service.onrender.com` | Internal, not user-visible |

## Done ahead of the domain cutover (RGA-002 phase)

The visual theme (dark navy → ink-on-paper) and the report/certificate layouts were originally
scheduled for the cutover itself. They shipped earlier than planned, at the user's request, covering
everything past login — the portal, the diagnostic/assessment/results flow, and the issued PDF
templates (`certificate-template.html`, `report-template.html`, `generate-pdf.html`). The public
marketing site (`index.html` and siblings) is explicitly **not** included in this pass and needs its
own dedicated design effort before it ships.

Certificate **fields** (score, level, issued/expiry, ID) stay frozen at activation. Certificate
**layout** follows the live `certificate-template.html` on every download: the portal re-renders
via the PDF service and overwrites storage so branding upgrades ship without leaving customers on
March-era cream/MLA PDFs. Issuer, signatory, and footer legal entity remain **MLA Group Ltd**.

---

## Brand rules that constrain the copy

From the RGA-001 guidelines, the ones that affect text:

- **CamelCase always.** "RegAnchor", never "reganchor" or "REGANCHOR" in prose. Lowercase is
  acceptable only inside a URL.
- **No mark, no icon.** No anchor symbol. The capital R serves as the favicon.
- **Tagline is editorial.** "Infrastructure for AI Governance" may sit near the wordmark but is
  never locked into it as a lockup.
