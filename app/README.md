# RegAnchor product app (`app.reganchor.com`)

Vite + React + TypeScript shell for the authenticated product UI.

## Develop

```bat
cd app
npm install
npm run dev
```

Open http://localhost:5173

## Build

```bat
cd app
npm run build
```

Output: `app/dist` — deploy with `npx wrangler deploy` (Worker `reganchor-app`, custom domain `app.reganchor.com`). See `docs/APP-CUTOVER.md`.

## Structure

- `src/ui` — reusable kit (see `src/ui/README.md`)
- `src/pages` — route screens (Home, Integrations, Registry, Controls, Policies)
- `src/auth` — Supabase session
- `src/lib` — config + Supabase client

## Design

Tokens in `src/styles/tokens.css` mirror `css/reganchor.css` / DESIGN.md. Do not introduce a second theme.
