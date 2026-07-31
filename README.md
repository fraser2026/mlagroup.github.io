# RegAnchor

Marketing site, diagnostic, and client governance portal for **RegAnchor**, the trading
name of MLA Group Ltd.

Served as a static site from GitHub Pages. Currently live at `mlagroup.co.uk`; moving to
`reganchor.com` — see [docs/CUTOVER.md](docs/CUTOVER.md).

## Layout

There is no build step and no framework. Every page is a standalone HTML file with its own
inline `<style>` block, which is why brand changes are a wide sweep rather than a single
edit.

| Path | What it is |
|------|-----------|
| `index.html`, `platform.html`, `pricing.html`, `methodology.html`, `contact.html` | Marketing pages |
| `privacy.html`, `terms.html`, `cookies.html` | Legal pages |
| `diagnostic.html`, `results.html` | The AI governance diagnostic and its scored output |
| `payment-success.html` | Post-Stripe account creation |
| `login.html`, `portal.html` | Client portal, with logic split across `js/portal-*.js` |
| `admin.html` | Internal assessment queue and support console |
| `report.html`, `system-report.html`, `generate-pdf.html` | Report rendering |
| `verify.html` | Public certificate verification |
| `certificate-template.html`, `report-template.html` | Puppeteer render templates, not browsed directly |
| `css/portal.css` | Portal styles |
| `css/reganchor.css` | RegAnchor brand layer: RGA-001 tokens and RGA-002 primitives |

## Services

| Service | Used for |
|---------|----------|
| Supabase | Database, auth, storage, edge functions |
| Stripe | One-off report purchases and subscriptions |
| EmailJS | Client and admin notification email |
| FormSubmit | Diagnostic lead notification |
| Render | `mla-pdf-service`, the Puppeteer PDF renderer |

## PDF generation

```bash
npm install
node generate-report.js --preview          # render from mock data
node generate-report.js --id <response_id> # render from a Supabase record
node renderer-service.js                   # run the HTTP renderer locally
```

Requires `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`. Set `SITE_DOMAIN` to override the
domain printed in PDF footers.

## Brand

[BRAND.md](BRAND.md) is the reference for when a reference becomes "RegAnchor" and when it
stays "MLA Group Ltd". RegAnchor is the trading name; MLA Group Ltd remains the legal
entity, the data controller, the contracting party, and the certificate issuer.

## Docs

- [BRAND.md](BRAND.md) — trading name versus legal entity
- [docs/SMOKE-TEST.md](docs/SMOKE-TEST.md) — manual test checklist, run before and after changes
- [docs/CUTOVER.md](docs/CUTOVER.md) — everything required to move to `reganchor.com`
