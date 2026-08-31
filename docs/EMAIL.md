# Outbound email (EmailJS + FormSubmit)

The site does **not** send mail from your own SMTP. Two browser-side third parties do.

| Provider | Role | Config lives |
|----------|------|--------------|
| [EmailJS](https://www.emailjs.com/) | Client diagnostic summary; portal alerts; admin support ping; enterprise inquiry; **contact form** | Dashboard: service + template HTML |
| [FormSubmit](https://formsubmit.co/) | Silent lead form when someone finishes diagnostic; contact form fallback | Address in `js/ra-contact.js` → `ops` |

Public keys and service IDs also live in `js/ra-contact.js` (and were previously hardcoded).

## Addresses (Phase 0)

All code paths use `@reganchor.com` via `RA_CONTACT`:

| Key | Default | Used for |
|-----|---------|----------|
| `info` / `support` / `sales` | `info@reganchor.com` | Legal pages, payment help, sales CTAs |
| `ops` | `info@reganchor.com` | FormSubmit + enterprise EmailJS `to_email` |

When you add `governance@` or `fraser@` mailboxes, change only `js/ra-contact.js`.

## What you must do in each dashboard

### EmailJS (required for good branding)

1. Open each template; replace MLA / mlagroup copy with **RegAnchor**, `reganchor.com`, IBM Plex / simple ink footer.
2. Set **From name** → `RegAnchor` (domain must be a verified EmailJS domain if using custom From).
3. **Reply-To** → `info@reganchor.com` (or your ops inbox).
4. Templates in use:
   - `service_amfeqty` / `template_xczn8bt` — after diagnostic (to prospect)
   - `service_umdte26` / `template_o6h9et7` — alerts, support, enterprise (variable `to_email`)

Without this step, the **code** uses the right addresses but **inbox appearance** stays “vibe coded MLA”.

### FormSubmit

FormSubmit only delivers after the destination email clicks their confirmation once.

1. Deploy with `ops` = address that exists.
2. Complete one diagnostic (or POST once) so FormSubmit emails the confirmation.
3. Confirm the link. Until then, lead pings fail silently (`console` only).

## Later upgrade (not Phase 0)

For branded, reliable mail: Supabase Edge + Resend/Postmark/SendGrid, templates in repo, no public EmailJS key. Fine after cutover; not required to market if EmailJS templates are cleaned.

## Quick test

1. `mailto:` links open `info@reganchor.com` on results / payment-success.
2. Finish diagnostic on staging / live → check client EmailJS + FormSubmit lead.
3. Portal: trigger an alert (or admin support reply) → template arrives branded.
4. `contact.html`: submit the form → EmailJS ops mail to `info@` (FormSubmit fallback if EmailJS fails).
