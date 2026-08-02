# AGENTS.md

## Cursor Cloud specific instructions

RegAnchor (trading name of MLA Group Ltd) is a **static site** plus a small **Node.js
Puppeteer PDF service**. There is no build step and no test suite — see `README.md` for the
page map and `docs/SMOKE-TEST.md` for the manual QA checklist. Node 22 and Google Chrome are
present; `npm install` (the update script) installs deps and Puppeteer's bundled Chromium.

### Services and how to run them

- **Static site** (marketing pages, diagnostic, portal, admin): served from the repo root.
  Run `npx serve . -l 3000`. Note `serve` 301-redirects `/index.html` to the clean URL
  `/`, so test clean paths (`/`, `/diagnostic`, `/pricing`), not the `.html` URLs. The
  client talks to a live Supabase project using the public/anon key hardcoded in
  `js/portal-core.js`; the diagnostic questionnaire and scoring run entirely client-side, so
  the core flow (fill "About You" → answer sections → see the scored `results` page) works
  locally with no secrets.
- **PDF generator CLI** (`generate-report.js`): `node generate-report.js --preview` renders
  a full report PDF from built-in mock data into `output/` with **no secrets required** —
  this is the quickest end-to-end check of the PDF pipeline. `--id <response_id>` (and
  `--store`) instead pull from Supabase and require `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`.
- **Renderer HTTP service** (`renderer-service.js`): `node renderer-service.js` starts an
  Express server on port 3001. `GET /health` returns ok; `POST /render` and
  `POST /render-certificate` take report/certificate JSON and return a PDF. Needs no secrets
  for `/render` with inline JSON.

### Gotchas

- Puppeteer launches headless Chrome with `--no-sandbox` already set in code; no extra flags
  are needed in this VM.
- Flows that depend on the live domain or third parties do NOT work locally: FormSubmit
  notification and Stripe checkout redirect (the Stripe publishable key in the repo is a
  **live** key). Supabase writes from the diagnostic hit the real project.
- `SITE_DOMAIN` env var overrides the domain printed in PDF footers (defaults to
  `mlagroup.co.uk`); relevant only for the domain cutover described in `docs/CUTOVER.md`.
