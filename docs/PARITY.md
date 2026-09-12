# Portal → React parity checklist

Source of truth: `portal.html` + `js/portal-*.js`. Destination: `app.reganchor.com`.

Do not mark a React view **Full** until the acceptance rule below is met. Until then, the same-origin bridge at `/legacy/portal.html` remains available.

## Bridge (required first)

- [x] Legacy portal hosted same-origin at `/legacy/portal.html` (`app/scripts/copy-portal.mjs` → `public/legacy/`)
- [x] Related pages under `/legacy/` (assessment, diagnostic, reports, pricing, CSS/JS/brand)
- [x] App login at `/login`; portal auth bounce → `/login?next=…`
- [x] Invite token stashed from `?invite=` on login
- [x] Shared Supabase session (same origin / same project)
- [x] Default authenticated landing → `/registry` (app); soft portal redirect still opt-in
- [x] `/portal` and `/portal/:view` React routes hand off to legacy hashes

## Auth / org

- [x] `ensureProfile` / `ensureOrg` / role helpers in `app/src/lib/org.ts`
- [x] `AuthProvider` exposes org, role, canManageMembers, canWriteRegistry, canDeleteRegistry, isPaidTier
- [x] `consumePendingInvite` via `accept_org_invite`
- [x] Seat limits via `orgSeatLimit`

## Per-view status

| View | Bridge | React route | Parity notes |
|------|--------|-------------|--------------|
| Dashboard / Home | `#dashboard` | `/home` partial | **Parked.** Portal dashboard was never finished. Do not port My Tasks, cert card, or maturity posters into the app until Connectors/MCP expose enough real data to design a proper home. Keep `/home` quiet; do not block cutover on it. |
| Reports | `#reports` | `/reports` | Diagnostic list + PDF edge + assessment links |
| Registry list | `#registry` | `/registry` | Add/edit/delete/bulk/request assessment in React |
| Registry detail | `#registry-detail-*` | `/registry/:id` | Overview/Assessment/Controls/Connection/Audit + gateway |
| Controls | `#controls` | `/controls` | List → `/controls/:id` |
| Control detail | `#control-detail-*` | `/controls/:id` | Assignment, evidence, implement, support |
| Policies | `#policies` | `/policies` | Adopt templates |
| Policy detail | `#policy-detail-*` | `/policies/:id` | Acknowledge (e-sign deferred; portal handlers missing) |
| Organisation | `#org` | `/organisation` | Profile + org Admin providers + members link |
| Users | `#users` | `/users` | Invites/roles/seats RPCs |
| Integrations / MCP | `#integrations` / `#mcp-device` | `/integrations` | Sessions, issue, device approve (`?code=`), linked assets → registry Connection. Live on app.reganchor.com. |
| Billing | `#billing` | `/billing` | Overview + Stripe portal session |
| Plans | `#plans` | `/plans` | Checkout redirect + enterprise inquiry |
| Alerts | `#alerts` | `/alerts` | Resolve/dismiss; Check Now / `compliance_rules` engine still portal-boot |
| Settings | `#settings` | `/settings` | Profile + password + sign out |
| Certificates | dashboard card | portal only | **Parked with dashboard.** Bring forward later with maturity once connector data justifies a home surface. Do not display on app yet. |

## Parked (explicit)

- **Dashboard / certificates / maturity chrome on Home** — wait for richer connector + MCP data before designing what to list. Not a merge blocker.
- Policy e-sign — portal handlers were missing; React stays click-ack until a real e-sign path exists.
- Marketplace-ready MCP tool expansion — after merge.

## Acceptance rule

Before removing the bridge for a view:

1. Same user-visible actions as portal
2. Same tables / RPCs / edge functions / audit side effects
3. Same role and plan gates
4. No marketing `reganchor.com/portal.html` hand-off for that view
5. Placeholder portal pages stay placeholders

## Placeholders (do not invent)

Evidence, Assessments (nav), Documents, Insights, Risk Trends, Benchmarks, org Audit Log, API Keys — match portal “Coming soon” only.

## Commands

```bash
cd app
npm run copy-portal   # or prebuild/predev
npm run build
npx wrangler deploy   # when ready to ship
```
