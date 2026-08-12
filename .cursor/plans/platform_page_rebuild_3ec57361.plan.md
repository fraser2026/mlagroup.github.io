---
name: Product page
overview: "Create product.html as the marketing page for the RegAnchor governance portal: index-aligned chrome, portal showcase with a blurred-lines motion visual (not a filmed video), and subscription tiers distinct from the diagnostic. Must not regress cloud agent fixes already on main (#11, #12)."
todos:
  - id: sync-guard
    content: Keep origin/main cloud fixes (checkout Auth, results bars, fines chart, light pin, CNAME, PDF domain)
    status: completed
  - id: shell
    content: New product.html with index home-chrome, tokens, blurple CTAs
    status: completed
  - id: showcase
    content: Portal capability bands + blurred-lines CSS/Canvas animation (no real video required)
    status: completed
  - id: subscriptions
    content: Essentials / Professional / Enterprise summary vs diagnostic; deep-link pricing.html
    status: completed
  - id: nav
    content: Wire Product in index nav + footer to product.html
    status: completed
  - id: reapply-brand-legal
    content: Re-apply favicon/brand + quiet reganchor.com legal/contact after sync (no touch of #12 files)
    status: completed
isProject: false
---

# Product page (`product.html`)

## Sync guard (do not regress)

Already on `main` from Cursor mobile / cloud:

| Commit | Keep intact |
|--------|-------------|
| `57d6e92` #12 | results checkout `Authorization`, purple maturity bars, fines chart mobile height, enforcement copy, light-only (no theme toggle) |
| `9d40707` #11 | PDF/certificate URLs → reganchor.com |
| `e175005` | `CNAME` |

Do **not** rewrite `results.html`, `index.html` theme wiring, fines-chart sources, or renderer/PDF templates unless fixing a clear conflict.

Local brand/legal/contact work was lost during sync and must be **re-applied** on top of current `main`.

## URL

- **Ship as** [`product.html`](product.html) (new file; simpler than `platform.html`)
- Optionally redirect or retire `platform.html` later; not required for v1
- Nav label: **Product**

## Product distinction

| | Diagnostic | Product (portal subscriptions) |
|--|--|--|
| Job | Point-in-time risk posture | Ongoing governance OS |
| Price | One-off premium report | Essentials / Professional / Enterprise (see pricing.html) |
| CTA | Start Diagnostic | Sign in / Get Started → pricing or login |

## Page arc

1. Hero — brand + one headline + one sub + CTAs (subscriptions / sign in)
2. Motion visual — blurred horizontal lines / soft data streaks (CSS or canvas), not a filmed walkthrough
3. Inside the portal — registry, controls/policies, assessments, certificate (quiet frames)
4. Subscriptions strip — three tiers + “not the diagnostic” callout → `pricing.html`
5. Close CTA — index-style box
6. Footer — MLA Group Ltd legal

## Motion (instead of video)

Cursor cannot ship a polished product video. Prefer a **looping abstract animation**: soft blurred lines, low opacity, Blurple/ink accents, reduced-motion fallback to a static poster. Optional later: replace with real screen capture.

## Chrome

Match `index.html`: sticky home-chrome, fade veil, blurple primary, IBM Plex wordmark, 4px geometry, no middots/em-dashes, no card hero.
