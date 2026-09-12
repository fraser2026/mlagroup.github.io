# RegAnchor design

Structured and simple. This file is for **how the product should feel**, not a museum of early portal CSS.

Naming and legal entity: [BRAND.md](BRAND.md).  
App primitives: `app/src/ui`. Tokens: `app/src/styles/tokens.css` (product), `css/reganchor.css` (legacy web).

**Authority:** live product taste → this file → old portal CSS.  
The portal was an early implementation, not a forever cage. Prefer Cloudflare / Supabase / Cursor density and Apple-like clarity over copying every portal hairline.

---

## Philosophy (Apple-like)

1. **Clarity first.** One glance should tell you what matters. Hierarchy over decoration.
2. **Restraint.** Few colours, few weights, few radii. If it isn’t earning its place, remove it.
3. **Precision.** Alignments, padding, and boundaries are intentional. Nothing “almost” lined up.
4. **Density with calm.** Data-heavy screens (tables, charts, registries) stay compact and readable — small useful controls, not sparse marketing layouts and not cramped chaos.
5. **Tools that disappear.** Search, export, menus, drawers should feel native and inevitable — like the right-hand drawer, compact search, and ⋯ menus already almost do.

Premium is **quiet confidence**, not loud chrome.

---

## What “premium / native” means here

Borrow the *discipline* of Cloudflare, Supabase, and Cursor — not their logos.

| Do | Don’t |
|----|--------|
| Compact controls (search, buttons, chips ~32–34px) | Oversized marketing buttons in product chrome |
| Small, readable type with clear weight steps | Thin spindly body + random bold scores fighting each other |
| Perfect boundaries (1 surface language, consistent radius) | Mix of card styles, shadows, and radii on one page |
| Shadow only when something floats (menu, drawer, popover) | Ambient shadows on every panel |
| Keyboard-first where it matters (⌘K, row actions, focus) | Mouse-only chrome |
| Cards / menus that pop with obvious structure | Vague boxes with uneven padding |

**Reference feeling (when stuck):** Cloudflare dashboard tables + Supabase density + Apple HIG clarity. Attach screenshots in the chat if useful.

---

## Non‑negotiables (short)

- **Light product UI by default.** Paper canvas. Dark mode = Openlayer depth: jet-black `#000000` main work surface over a slightly lighter sidebar shell (`#111111`), pure white primary type, grey secondary, **minimal hairlines**. Desktop shell: equal top/bottom cushions, right cushion ≈ scrollbar gutter (`14px`), work card fully rounded (button radius) with a continuous hairline. Scrollbar tracks match their surface (thumb/arrows stay OS-native). Mobile keeps a simpler padded card. Blurple fills stay `#533AFD`; dark text/markers use a softer `--ra-blurple-fg`. No lifted navy cards around tables/stats.
- **Sentence case** in chrome. No stamped all-caps.
- **No em dashes** in product copy (use commas, periods, or hyphens).
- **Accent is scarce.** Blurple `#533AFD` for primary actions and meaningful meters — not backgrounds, not every heading.
- **Status colour on the word only** (risk / warn / ok). Never paint a whole block.
- **Product name = RegAnchor.** Legal issuer = **MLA Group Ltd** (see BRAND.md).
- **Whitespace is a feature** — calm margins around dense data, not empty deserts inside tables.

Everything else is open to improve.

---

## Type and hierarchy

Goal: writing feels **settled and useful**, not decorative.

| Role | Guidance |
|------|----------|
| UI / tables / forms | One UI family (Inter). Prefer **medium (500)** for labels and values — hierarchy by colour/size, not by thinning secondary copy. Primary content uses ink (white in dark). Field/metric labels and supporting body use `--ra-text-2`. Dates/placeholders use `--ra-text-3`. If a surface looks cheap or “all grey”, primary values or section titles were muted by mistake. |
| Page title | Clear, one line, not huge marketing clamp sizes in-app. |
| Supporting line | One short sentence under the title, muted tertiary. |
| Meta / descriptions | Field labels secondary; values ink. Dates tertiary. |
| Scores / big numerals | **Inter** via `--ra-font-num` / `.ra-num` / `<RaNum>` — same face as portal product UI. Tabular figures. IBM Plex is wordmark / marketing only, not in-app scores. Do not invent a second poster type scale inside tables. |

| Provider / vendor names | Official brand casing via `labelProvider()` (OpenAI, Anthropic, AWS Bedrock, Microsoft Foundry). Never raw slugs. **Model provider** ≠ cloud infrastructure (Azure/AWS/GCP) ≠ interface (MCP / API / Gateway). |

Size direction for product: **slightly smaller and tighter** (Cloudflare / Supabase), not brochure-large. Prefer consistency over “hero” type in the authenticated app.

### Section intros (logic over sameness)

A muted line under a section title is optional. Use it when the tab needs orientation (e.g. Connect Hosts / Providers). Keep it **readable body** (`--ra-fs-body`, `--ra-text-2`) on nav pages — not meta/tertiary whisper text. Reserve tiny meta for dense inventory asides (e.g. registry asset description under a name). Skip the section intro when the next content already explains (e.g. Overview fields).

**Detail tabs:** the selected tab already names the surface. Do not repeat that title when content exists. Overview and Audit never repeat the tab title. Assessment, Controls, and Connection keep title + short blurb only while empty, then drop them once there is data to show.

### Corners

No sharp 90° product rectangles. Cards, buttons, inputs, tags, and panels use `--ra-radius-control` (or `--ra-radius-panel` for larger surfaces).

---

## Colour (floor, not a prison)

| Role | Light | Dark (Openlayer-leaning) |
|------|-------|--------------------------|
| Canvas / sidebar / panels | `#FFFFFF` (sidebar mist `#F6F9FC`) | Canvas `#000000`, sidebar/shell `#111111` — main card over shell |
| Border | `#E6EBF1` when needed | `rgba(255,255,255,0.08)` — scarce |
| Ink (titles, primary) | `#0A0E14` | `#FFFFFF` — must pop |
| Body / muted | `#425466` / `#697386` | `#A3A3A3` / `#737373` |
| Accent | Fills `#533AFD` / hover `#4434E0`. Light text accents = blurple. Dark text accents = white (`--ra-blurple-fg`); keep blurple on fills, chip boxes, borders, and marker lines — not body labels |
| Risk / warn / ok | `#C8102E` / `#B45309` / `#0F766E` | Same families on dark soft fills |

### Dividers and hairlines

Do **not** wrap every section in a bordered box. Good dark UI (and calm light UI) uses lines sparingly:

- **Prefer** one subtle rule under a table header, or between chrome and content.
- **Avoid** outer boxes around ledgers/stats in dark mode; light mode may keep a quiet border for structure.
- **Avoid** lining every card, row group, and sidebar edge “just because.”
- Floating surfaces (menus, drawers) still get a border + shadow — that is not a ledger box.

Dark mode reference feel: **Openlayer** — sidebar shell as layer 0, fully rounded jet-black work card as layer 1 (equal Y gaps, wider right gutter for scroll), scrollbar tracks painted to the surface, white primary type, softer blurple for labels.

Borders and dividers should feel **structural**, not like a grid of hairlines for their own sake.

---

## Layout and components

- **Dense data belongs in tables / ledgers** with stable columns and truncation — not stretched descriptions.
- **Cards** when they group a real interaction or a floating surface (drawer, menu, dialog). Flat rows for inventory.
- **Drawer / popover / menu:** clear hierarchy, compact items, obvious hover, keyboard-friendly — this is currently closest to the target feel; extend that language.
- **Buttons:** primary = accent fill; secondary/ghost = quiet border; menus = grey wash + accent label on hover (never ink-solid ghost hover). Two product sizes: **md** (~32px, page/header) and **sm** (~28px, forms/keys/drawers/row actions). Same 4px radius as marketing. Marketing hero CTAs stay larger; do not reuse that height in product chrome.
- **Radius:** small and consistent (about 4–6px). No pill clusters.
- **Motion:** short, purposeful (open/close, focus). No decorative glow.

Prefer extending `app/src/ui` over adding a second visual kit. Headless primitives (e.g. Radix) are fine for behaviour; **do not** paste a default shadcn/MUI look.

---

## Product app vs legacy portal

| Surface | Expectation |
|---------|-------------|
| `app/` → `app.reganchor.com` | Design forward using this document. Native, dense, premium. |
| Legacy `portal.html` / reports / PDFs | Keep usable; improve when touched. Not a veto on app design. |
| Marketing `index.html` | Own pass later; don’t conflate with product chrome. |

Migration may keep behaviour from the portal. **Look** follows this file.

---

## Connect terminology (layers)

Keep these distinct in product copy and future builds. Do not collapse them into one “integrations” blob.

| Layer | What it is | Examples |
|-------|------------|----------|
| **Model provider** (also AI provider / provider) | Who serves the model | Anthropic, OpenAI, Google, AWS Bedrock, **Microsoft Foundry** (slug may still be `azure`; logo stays; never label as Azure the cloud) |
| **Infrastructure** | Where compute/network runs | AWS, Azure, GCP, Kubernetes |
| **Interface** | How systems talk | MCP, API, Gateway |
| **Host** | Where the agent client runs | Cursor, Claude Desktop, other MCP clients |
| **Gateway** | Per-asset model traffic (`ra_gw_…`) | Asset **Connection** tab |
| **MCP** | Governance tools to hosts (`ra_mcp_…` / OAuth) | Org **Connect → Hosts** |
| **Data sources** (future, under DPA) | Read-access integrations later | Warehouses, DBs, cloud storage, business systems, documents, AI app logs/traces, SIEM. Product surface: **Data backends** (`/data-backends`) for BigQuery, Snowflake, Databricks, Redshift, Postgres first. |

Org **Connect** section order: **Hosts → Providers → Gateway** (Gateway is a pointer; minting stays on the asset).

---

## Agents — quick brief

> Follow DESIGN.md (feel) and BRAND.md (names/legal). Aim for Apple-like clarity and Cloudflare/Supabase density; dark mode leans Openlayer (near-black, white type, minimal hairlines). Prefer `app/src/ui`. No dark fintech, no all-caps chrome, no em dashes, no generic purple SaaS starter look. Model provider ≠ infrastructure ≠ interface; Microsoft Foundry is the model-provider name for the former Azure AI Studio surface.
