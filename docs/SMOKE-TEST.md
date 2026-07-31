# Smoke Test Checklist

There are no automated tests in this repo. Run this checklist manually before and after each
rebrand phase, and again after the domain cutover.

Rollback point: `git tag pre-reganchor-rebrand` (the last commit before rebrand work began).
To roll back entirely: `git checkout main`.

Record the date and the result of each run at the bottom of this file.

---

## How to run the site locally

GitHub Pages serves these files statically from the repo root. To reproduce that locally:

```bash
npx serve .
```

Some flows will not work locally because they depend on the live domain: the FormSubmit
redirect in `diagnostic.html`, and Stripe redirect-mode checkout. Those are marked below.

---

## 1. Public pages load

Every page should render with no console errors and no missing fonts.

- [ ] `index.html` — hero, pricing section, footer
- [ ] `platform.html`
- [ ] `pricing.html` — three tiers, monthly/annual toggle
- [ ] `methodology.html`
- [ ] `contact.html`
- [ ] `privacy.html`
- [ ] `terms.html`
- [ ] `cookies.html`
- [ ] `login.html`
- [ ] `verify.html`

Check on each: the RegAnchor wordmark renders in IBM Plex Sans, the favicon appears, nav
links resolve, and footer links resolve.

## 2. Diagnostic flow

- [ ] `diagnostic.html` loads and the question sequence advances
- [ ] Completing the diagnostic writes a row to Supabase `diagnostic_results`
- [ ] EmailJS fires (service `service_amfeqty`, template `template_xczn8bt`)
- [ ] FormSubmit notification is received — **live domain only**
- [ ] Browser lands on `results.html` with the score rendered
- [ ] `localStorage` contains `mla_diagnostic_result` and `mla_result_id`

## 3. Payment flow

Use Stripe test mode if available. Note the publishable key in the repo is a **live** key,
so a real card will create a real charge.

- [ ] `results.html` — "unlock report" opens embedded Stripe checkout
- [ ] Edge function `create-checkout-session` returns a client secret
- [ ] After payment, browser reaches `payment-success.html?session_id=...`
- [ ] Edge function `link-diagnostic` associates the diagnostic with the new user
- [ ] Account creation on `payment-success.html` succeeds
- [ ] `pricing.html` subscription checkout redirects correctly (`create-subscription-session`)

## 4. Auth and portal

- [ ] `login.html` sign-in with an existing account succeeds
- [ ] Sign-up creates a `profiles` row
- [ ] Redirect to `portal.html` works
- [ ] Portal sidebar renders and the dashboard loads the organisation
- [ ] Registry tab lists AI systems
- [ ] Controls tab loads governance controls
- [ ] Policies tab loads policy documents
- [ ] Alerts / compliance engine runs without console errors
- [ ] Plans tab shows correct pricing and current tier
- [ ] Password change via `updateUser` succeeds

## 5. Certificates

- [ ] Certificate card renders in the portal
- [ ] Activation is correctly blocked when criteria are unmet (score < 70, no systems,
      no assessment, unacknowledged policies)
- [ ] Activation succeeds when criteria are met and a `certificate_id` is returned
      from Supabase
- [ ] Download triggers `https://mla-pdf-service.onrender.com/render-certificate`
- [ ] **The advisory signature image appears in the generated PDF** — this is the most
      fragile item in a domain change; it is loaded from an absolute URL
- [ ] PDF uploads to the `governance-reports` bucket at `certificates/{org_id}/{cert_id}.pdf`
- [ ] Signed URL opens the PDF

## 6. Verification

- [ ] `verify.html` with a real active certificate ID returns valid
- [ ] `verify.html?id=...` auto-verifies from the URL parameter
- [ ] An unknown ID returns the invalid state
- [ ] An expired or revoked certificate returns the correct state
- [ ] Old `MLA-GOV-` IDs still verify after any prefix change

## 7. Reports

- [ ] `report.html?rid=...` renders a real report
- [ ] `system-report.html` renders a per-system report
- [ ] `generate-pdf.html` produces a client-side PDF
- [ ] `node generate-report.js --preview` renders without error (needs `SUPABASE_URL`
      and `SUPABASE_SERVICE_KEY`)

## 8. Admin

- [ ] `admin.html` loads the assessment queue
- [ ] Support threads load and a reply sends via EmailJS

---

## Domain cutover additions

Run these only during the `reganchor.com` cutover.

- [ ] HTTPS certificate provisioned by GitHub Pages for the new domain
- [ ] `https://mlagroup.co.uk` 301-redirects to `https://reganchor.com`
- [ ] Supabase Auth Site URL and Redirect URLs accept the new domain
- [ ] Stripe checkout returns to the new domain
- [ ] Emails link to the new domain
- [ ] Newly generated certificate PDFs show the new verify URL
- [ ] Previously issued certificate PDFs still verify (they carry the old URL text)

---

## Run log

| Date | Phase | Result | Notes |
|------|-------|--------|-------|
|      |       |        |       |
