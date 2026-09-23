# RegAnchor Control Centre (`admin.reganchor.com`)

Internal MLA methodology workstation. Not customer-facing.

## Stack

- React + same design system as `app/` (`@ra/ui` aliases into `../app/src/ui`)
- Supabase auth with `profiles.role === 'mla_admin'`
- Cloudflare Worker static SPA (`reganchor-admin`)

## Local

```bash
cd admin
npm install
npm run dev   # http://localhost:5174
```

## Deploy

```bash
cd admin
npm run deploy
```

Custom domain: `admin.reganchor.com` (see `wrangler.toml`). Until DNS is ready, use the `*.workers.dev` URL from the deploy output.

## Phase 1 scope

- Controls catalogue (Save & Publish)
- Frameworks / articles catalogue (Save & Publish)
- Mappings + policy templates pages stubbed for later
