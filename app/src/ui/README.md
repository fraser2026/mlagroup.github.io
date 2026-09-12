# RegAnchor UI kit

Product primitives for `app.reganchor.com`. Import from `@/ui` (or `../ui`).

## Interaction philosophy

- Click gives immediate visual response (`:active`, `selected`, `pending`)
- Destination UI appears in-place (drawer, rail, route content)
- Data fills progressively (`Skeleton` / `SkeletonRows`), layout does not jump
- Motion only communicates state change (rail, page presence, icon hover)
- Shell never remounts on route change

## Layout model

See [LAYOUT.md](./LAYOUT.md): mist nav / white work / On this page rail.

## Rules

See repo [DESIGN.md](../../../DESIGN.md): Apple-like clarity, Cloudflare/Supabase density.

- Compact controls; clear type weights; precise boundaries
- Blurple scarce; status colour on the label only
- Cards/menus for floating interaction; tables for inventory
- Sentence case; no em dashes in chrome copy
- Extend this kit — don’t paste a default component-library look

## Components

| Export | Use |
|---|---|
| `AppShell` / `NavSection` | Persistent product chrome |
| `TopChrome` / `Breadcrumbs` / `CopyLink` | Sticky utilities |
| `PageFrame` / `ContextRail` / `Section` | Work + On this page |
| `PageTransition` | Outlet presence |
| `DataTable` | Cloudflare-calm sortable tables |
| `PageHeader` | Title + one sentence + actions |
| `Button` | Primary / ghost. `md` (~32px) page actions; `sm` (~28px) forms, keys, drawers, rows. `pending` / `selected` |
| `Icon` | Lucide wrapper (weighted stroke) |
| `Skeleton` / `SkeletonRows` | Progressive load placeholders |
| `SummaryCard` / `Stat` | Home metrics |
| `SelectMenu` | Portal-style select card |
| `DateField` | Portal-style date card (no system picker) |
| `DelayTip` | Long-hover tip; `mode="always"` for chrome, truncate for clipped text |
| `RaNum` / `.ra-num` / `--ra-font-num` | Product numerals (portal Inter + tabular): scores, %, counts, L-codes, dates. Not IBM Plex. |
| `FilterBar` | Search + chips |
| `Ledger` / `LedgerRow` | Work queues |
| `ConnectorRow` | Integrations |
| `StatusLabel` | OK / warn / risk typography |
| `Drawer` | Detail without leaving the list |
| `EmptyState` / `Notice` | Quiet empty and alerts |
| `usePageChrome` | Set breadcrumbs / title per page |
