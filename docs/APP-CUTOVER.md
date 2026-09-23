# `app.reganchor.com` cutover

## Deploy model

| Surface | How it ships |
|---|---|
| Marketing (`reganchor.com`) | **Git push** → GitHub Pages |
| Product app (`app.reganchor.com`) | **`cd app && npm run build && npx wrangler deploy`** (manual; not auto from git) |

Commit app changes so they are not lost. A git push alone does **not** update the Worker.

## Status (live)

| Piece | State |
|---|---|
| Worker | `reganchor-app` |
| Preview | https://reganchor-app.frasergibsonuk.workers.dev |
| Custom domain | https://app.reganchor.com (Workers custom domain → AAAA `100::` proxied) |
| SPA routing | `not_found_handling = single-page-application` (`/login`, `/registry`, … OK) |
| Portal auto-redirect | **Hard cutover** (`DEFAULT_TO_APP = true`; opt out with `?legacy=1`) |
| MCP OAuth consent | `REGANCHOR_PUBLIC_ORIGIN=https://app.reganchor.com` → `/oauth/consent` |

Legacy `portal.html` on the marketing host redirects to the app (unless `?legacy=1`).

---

## Deploy / update

```bash
cd app
npm run build
npx wrangler deploy
```

Requires `npx wrangler login` once. Cloudflare MCP can list Workers; script/asset upload needs Wrangler.

`app/wrangler.toml`:

```toml
name = "reganchor-app"
compatibility_date = "2026-09-07"
workers_dev = true

[assets]
directory = "./dist"
not_found_handling = "single-page-application"

[[routes]]
pattern = "app.reganchor.com"
custom_domain = true
```

---

## Soft redirect (optional hard cutover later)

In `js/portal-redirect.js`, keep `DEFAULT_TO_APP = false` until you want every portal visit sent to the app. Opt-in today:

- `https://reganchor.com/portal.html?app=1`
- or `localStorage.setItem('ra_use_app','1')`

When ready: set `DEFAULT_TO_APP = true` and push to GitHub Pages.

---

## OAuth / secrets

```bash
npx supabase secrets set REGANCHOR_PUBLIC_ORIGIN="https://app.reganchor.com" --project-ref hueftewwenjaiagdoqmb
npx supabase functions deploy mcp-oauth --project-ref hueftewwenjaiagdoqmb
```

Rollback consent to apex portal:

```bash
npx supabase secrets set REGANCHOR_PUBLIC_ORIGIN="https://reganchor.com" --project-ref hueftewwenjaiagdoqmb
npx supabase functions deploy mcp-oauth --project-ref hueftewwenjaiagdoqmb
```

---

## Smoke checklist

- [ ] https://app.reganchor.com loads sign-in
- [ ] After login: My work / Registry / Integrations
- [ ] MCP Authenticate consent opens on `app.reganchor.com/oauth/consent`
- [ ] Opt-in portal redirect: `portal.html?app=1`
