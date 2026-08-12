# Design reference — RegAnchor portal aesthetic

**This is the visual source of truth for agents and humans.**  
Naming / legal entity rules live in [BRAND.md](BRAND.md).  
Tokens live in `css/reganchor.css` and `css/portal.css`.  
Report skin: `css/reganchor-report.css`.

If a surface could pass for a generic AI dark dashboard or a purple startup template after removing the wordmark, it is wrong.

---

## Reference surfaces (match these)

| Priority | Open and match |
|----------|----------------|
| 1 | `portal.html` + `css/portal.css` |
| 2 | Shared tokens in `css/reganchor.css` |
| 3 | Reports: `report.html`, `system-report.html`, `report-template.html` |

Do not invent a parallel theme. Extend the portal language.

---

## Locked tokens

| Role | Value |
|------|--------|
| Paper / canvas | `#FFFFFF` |
| Mist / quiet fill | `#F6F9FC` |
| Hairline | `#E6EBF1` |
| Ink | `#0A0E14` / `#061B31` |
| Navy heading | `#0A2540` |
| Body | `#425466` |
| Muted | `#697386` |
| Blurple (actions + meters only) | `#533AFD` |
| Blurple hover | `#4434E0` |
| Risk | `#CD3D64` |
| Warn | `#C45C26` |
| OK | `#24B47E` |
| Control radius | **4px** (not pills) |

**Buttons (source of truth: `index.html`):**
- **Primary:** Blurple fill → Blurple-hover on hover; white label stays.
- **Ghost / outline:** white (or paper) fill, ink label, hairline border → on hover **Blurple border + Blurple label**, quiet paper hover only. **Never** ink / navy solid fill on ghost hover.
- **Menus / major actions** (bulk actions, row kebab, any list that commits a change): rest = ink label (muted grey if disabled). Hover = keep the quiet grey wash (`--ra-hover`) **and** paint the label Blurple — same signal as hovering the RegAnchor wordmark / ghost button. Disabled items stay grey and do not take the accent. Do not replace the grey wash with a solid Blurple fill.

**Type:** Inter for UI/body and the live `.ra-wordmark`. Favicon / brand-mark R must match that Inter Medium R (outlined path so browsers do not need a webfont). Score numerals may use tabular figures; do not swap the public wordmark to a different family to “fix” the favicon.

---

## Hard rules

1. **Portal is the reference.** White paper, ink, hairlines, quiet hierarchy. Stripe / Palantir calm ledger — not fintech neon.
2. **Sentence case everywhere.** No stamped all-caps section bars, table eyebrows, severity pills, or nav chrome. Prefer `text-transform: none`.
3. **Blurple is scarce.** Buttons, links that are primary actions, and score/maturity meters. Not backgrounds, not decorative gradients, not every heading.
4. **Severity is typographic.** Risk colour on the label/weight only. Never paint an entire header block red via `color` on a parent. Never pink/red number bars.
5. **Ledgers over cards.** Prefer hairline rows and domain tables. Cards only when they contain a real interaction. No glass, glow, multi-layer shadows, radial grids.
6. **One job per section.** One headline, one short support line, then content. Quiet numbered sections (`Section 04`), not marketing hero scale.
7. **Product = RegAnchor; issuer = MLA Group Ltd.** Certificates and legal signature lines stay MLA Group Ltd (see BRAND.md).
8. **Light only** for portal, reports, results, verify. Do not reintroduce dark navy canvases or theme toggles on those surfaces.
9. **PDF templates are self-contained.** Puppeteer `setContent` cannot rely on relative CSS URLs. Inline or embed the same tokens as the web skin; do not dual-maintain `generate-pdf.html` (jsPDF orphan).

---

## Forbidden (agents keep shipping these — stop)

- Dark navy / `#070b18` / `#020617` report canvases
- Instrument Serif, DM Sans, or default browser serif on report headings
- Multi-stop purple–orange gradients; glow; glassmorphism
- Full-width coloured bars behind roadmap action numbers
- Cascading `style="color:${risk}"` on a parent that wraps titles + scores + labels
- Huge marketing `h2` clamp sizes on report section titles (override with report/portal type scale)
- Rounded-full pills, emoji chrome, animated badges
- “Vibe” remaps that change CSS variables but leave old dark-layout class CSS deleted — **layout must exist for every class the JS emits**

---

## Reports checklist (before claiming done)

- [ ] Domain chapter: ink concept title; Blurple thin meter; risk label only on the status word
- [ ] Priority findings: ledger rows, hairline left edge, sentence-case labels
- [ ] Roadmap: compact number cell + action + owner — no phase-coloured slabs
- [ ] Radar (if present): light grid + Blurple fill, readable on white
- [ ] Section titles: IBM Plex / Inter at ~1.35rem, not 32px marketing clamp
- [ ] Hard-refresh verified on the real `report.html?rid=` / portal View path

---

## Out of scope unless asked

- Rewriting scoring / `recon` / `buildRoadmap` logic for cosmetics
- Stripe / Supabase / auth / schema
- Marketing homepage redesign (`index.html`) or shelved `product.html`
- Force-pushing or dual-editing cloud + local without `git fetch` / pull first
---

## Quick paste for a new chat

> Follow DESIGN.md and BRAND.md. Portal aesthetic is mandatory for portal, reports, certificates, verify. Match portal.css. Sentence case, Blurple sparingly, no dark fintech, no pink/red vibe bars. RegAnchor product / MLA Group Ltd issuer.