# Domain Cutover Checklist — mlagroup.co.uk to reganchor.com

Phase one of the rebrand renamed the trading brand while staying on the current domain.
This document is everything that still has to happen to move to `reganchor.com`.

Most of it is **not in this repository**. The repo is a static site; the parts that can
actually break a payment or a login live in Supabase, Stripe, and EmailJS. None of it is
verifiable from the codebase, so each item below has to be checked in its own dashboard.

Work top to bottom. Do not flip DNS until sections 1 to 5 are done.

---

## 0. Before you start

- [ ] Run the full checklist in [SMOKE-TEST.md](SMOKE-TEST.md) against the current domain
      and record the result, so you have a known-good baseline to compare against.
- [ ] Confirm `reganchor.com` is in your registrar account and you can edit its DNS.
- [ ] Decide whether you also want `portal.reganchor.com`. The design mockups in
      `reganchorsystem.html` show the portal on a subdomain, but the live portal is
      `portal.html` on the main domain. GitHub Pages serves one custom domain per repo,
      so a portal subdomain would need separate hosting. Simplest path is to keep the
      portal on the main domain for now.

---

## 1. Supabase

Project: `hueftewwenjaiagdoqmb`

### Authentication → URL Configuration
- [ ] Set **Site URL** to `https://reganchor.com`
- [ ] Add `https://reganchor.com/**` to **Redirect URLs**
- [ ] Keep `https://mlagroup.co.uk/**` in the list during the transition so existing
      sessions and any in-flight emails still resolve. Remove it once traffic has moved.

The repo only uses `signInWithPassword`, `signUp` and `updateUser`, with relative
redirects, so nothing in the code needs changing. This is dashboard-only.

### Edge Functions
These contain Stripe return URLs that are almost certainly hardcoded to the old domain.
Their source is not in this repo — check each one.

- [ ] `create-checkout-session` — `success_url` / `cancel_url`
- [ ] `create-subscription-session` — `success_url` / `cancel_url`
- [ ] `link-diagnostic` — any absolute URLs
- [ ] `generate-report` — any absolute URLs

The one-off report flow returns to `payment-success.html?session_id=...`, so the success
URL must point at `https://reganchor.com/payment-success.html`.

### Certificate ID prefix
New certificates should be issued as `RGA-GOV-`; existing `MLA-GOV-` IDs stay valid.

`certificate_id` is generated server-side — `js/portal-cert.js` inserts a row without
supplying one and reads it back from the result. Find the default, sequence or trigger on
`governance_certificates` and change the prefix there.

- [ ] Update the generator to produce `RGA-GOV-YYYY-NNNN`
- [ ] Confirm the `verify_certificate` RPC still matches on the full string. It does an
      exact lookup on uppercased input, so both prefixes work with no code change.
- [ ] Issue one test certificate and verify it
- [ ] Verify an existing `MLA-GOV-` certificate still resolves

Then update the two places that document the old format to the user:
- [ ] `verify.html` — the input placeholder and the `search-hint` line below it

The pricing FAQ no longer quotes the format or the domain, so it needs no change.

---

## 2. Stripe

- [ ] Checkout branding: business name, logo, colours
- [ ] Any webhook endpoints pointing at the old domain
- [ ] Customer portal return URL
- [ ] Confirm the live publishable key in `results.html` and `js/portal-plans.js` is still
      correct if you create new Stripe products

Price IDs are not domain-bound and do not need to change. Stripe can keep showing
MLA Group Ltd as the legal business name; that is correct and should not be changed.

---

## 3. EmailJS

Template content lives in the EmailJS dashboard, not in this repo. Any links or branding
inside these templates will still say MLA Group.

- [ ] Service `service_amfeqty`, template `template_xczn8bt` — post-diagnostic client email
- [ ] Service `service_umdte26`, template `template_o6h9et7` — alerts, admin support
      replies, enterprise inquiries
- [ ] Update the from-name and any logo or footer links in each

---

## 4. Email addresses

Phase one deliberately left these on `@mlagroup.co.uk` because the mailboxes still work.

- [ ] Set up the RegAnchor equivalents and forwarding
- [ ] `info@` — `terms.html`, `privacy.html`
- [ ] `hello@` — `index.html`, `pricing.html`
- [ ] `governance@` — `results.html`, `payment-success.html`
- [ ] `fraser@` — `portal.html`, `js/portal-plans.js`, and the FormSubmit endpoint plus
      the `fraser_email` parameter in `diagnostic.html`

Note the FormSubmit endpoint is `https://formsubmit.co/fraser@mlagroup.co.uk`. Changing the
address means re-confirming the new one with FormSubmit before it will deliver.

---

## 5. Hardcoded absolute URLs left in the repo

Phase one converted everything it safely could to `location.host` / `location.origin`, so
those pages follow the domain automatically. What remains is deliberately absolute, because
it is rendered off-site by Puppeteer where relative URLs resolve against `about:blank`.

Change these four:

- [ ] `renderer-service.js` — `SITE_DOMAIN` constant, or set the `SITE_DOMAIN` env var on
      Render, which is preferable since it avoids a redeploy for a config change
- [ ] `generate-report.js` — `CONFIG.siteDomain`, same env var applies
- [ ] `report-template.html` — `SITE_DOMAIN` constant near the top of the script block
- [ ] `certificate-template.html` — the `SITE_DOMAIN` constant **and** the signature
      `<img src="https://mlagroup.co.uk/advisory-signature.png">`, which is two separate
      edits in that one file

The signature image is the single most fragile item in the whole cutover. If the old domain
is retired before this is changed, every newly generated certificate silently loses the
signature, because the `<img>` has an `onerror` handler that just hides it. Consider
inlining the image as a data URI to remove the network dependency permanently.

---

## 6. The flip

- [ ] Point DNS for `reganchor.com` at GitHub Pages
      (A records to the four GitHub IPs, or a CNAME to `mlagroup.github.io`)
- [ ] Change the `CNAME` file in the repo root to `reganchor.com`
- [ ] Wait for GitHub Pages to provision the HTTPS certificate, then enable
      "Enforce HTTPS" in the repository settings
- [ ] Redeploy the Render PDF service if you edited the templates rather than using env vars
- [ ] Set up 301 redirects from `mlagroup.co.uk` to `reganchor.com`, preserving paths so
      that `mlagroup.co.uk/verify?id=...` still lands correctly

Keep the old domain and its redirects alive indefinitely. Every certificate already issued
carries `mlagroup.co.uk/verify/...` printed into the PDF, and those PDFs are immutable and
sitting with customers and their regulators.

---

## 7. After the flip

- [ ] Re-run [SMOKE-TEST.md](SMOKE-TEST.md) in full against `reganchor.com`
- [ ] Verify an old `MLA-GOV-` certificate through the redirect from the old domain
- [ ] Generate one new report PDF and one new certificate PDF, and confirm the footer
      domain and the signature image are both correct
- [ ] Complete one real end-to-end purchase
- [ ] Update the repo `README.md`
- [ ] Update any external listings: Companies House trading name, LinkedIn, email
      signatures, business cards, pitch decks

---

## Still deferred after cutover

These are tracked but intentionally out of scope for both phase one and the cutover:

- The public marketing site (`index.html`, `platform.html`, `pricing.html`, `methodology.html`,
  `contact.html`, `login.html`, and the legal pages). It carries a shared override stylesheet
  (`css/reganchor-site.css`) for basic token consistency, but a real ink-on-paper rebuild of the
  landing page is its own project — this is a sales asset and needs more care than a token pass.
- Renaming the Supabase columns `mla_notes`, `mla_response`, and the `sender_type` value
  `'mla'`. These are schema identifiers, invisible to users, and renaming them buys
  nothing while risking real breakage.
- The Render service hostname `mla-pdf-service.onrender.com`, which is internal.

**No longer deferred:** the full RGA-001 visual conversion (portal, diagnostic/assessment/results
flow) and the report and certificate template redesigns shipped ahead of the domain cutover — see
`BRAND.md` for what changed and what stayed as MLA Group Ltd. Certificates and reports already
issued keep their stored PDF exactly as generated; only new issuances pick up the new template.
