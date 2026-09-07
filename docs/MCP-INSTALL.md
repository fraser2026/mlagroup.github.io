# Install RegAnchor MCP (Cursor)

> **Customers / company developers:** use **[MCP-CONNECT.md](./MCP-CONNECT.md)** (portal Connect). Ignore section A below.

This file is the **platform + maintainer** runbook. Follow it in order. Do not mix platform steps with developer steps.

This is **not** the Messages gateway (`ra_gw_…`). MCP tokens (`ra_mcp_at_…`) are for agent tools only.

---

## A. Platform setup (once per Supabase project)

Only needed when standing up or repairing the backend. Skip if `mcp` and `mcp-auth` already work for your org.

### A1. Deploy

```bat
cd /d C:\path\to\mlagroup.github.io
npx supabase login
npx supabase db push --project-ref YOUR_PROJECT_REF
npx supabase functions deploy mcp-auth --project-ref YOUR_PROJECT_REF
npx supabase functions deploy mcp --project-ref YOUR_PROJECT_REF
```

(`verify_jwt` for these functions is already `false` in `supabase/config.toml` — do not invent a third auth path.)

### A2. Set the JWT signing secret

Edge Functions **cannot** use a custom secret named `SUPABASE_*` (CLI skips it).

| Use this | Not this |
|---|---|
| Dashboard → Project Settings → **API** → **JWT Secret** (or Legacy JWT secret) | Service role key / secret API key / publishable key |
| Edge secret name: **`JWT_SECRET`** | `SUPABASE_JWT_SECRET` (rejected by Supabase) |

```bat
npx supabase secrets set JWT_SECRET="PASTE_JWT_SECRET_HERE" --project-ref YOUR_PROJECT_REF
```

Success looks like: `Finished supabase secrets set.`  
Failure looks like: `Env name cannot start with SUPABASE_, skipping` — wrong name.

No redeploy required after setting the secret.

### A3. Confirm backend

```bat
curl -s https://YOUR_PROJECT.supabase.co/functions/v1/mcp
```

Expect JSON with `"ok": true` and `"name": "reganchor"`.

---

## B. Developer install (each machine / each Cursor workspace)

### B1. Env file

```bat
cd /d C:\path\to\mlagroup.github.io\mcp
copy .env.example .env
```

Edit `.env`:

```env
REGANCHOR_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
REGANCHOR_ANON_KEY=sb_publishable_…   # or legacy anon key — never service_role
```

### B2. Device login

**Command Prompt:**

```bat
cd /d C:\path\to\mlagroup.github.io\mcp
npm.cmd install
node login.mjs
```

**PowerShell:**

```powershell
Set-Location C:\path\to\mlagroup.github.io\mcp
npm.cmd install
node .\login.mjs
```

Do **not** run `node login.mjs` from the repo root (`MODULE_NOT_FOUND`).  
Do **not** use PowerShell `Set-Location` inside Command Prompt.

### B3. Approve in the portal

1. Open the printed URL while signed into RegAnchor.
2. Approve the user code.
3. Wait until the CLI prints `Approved.`

`login.mjs` will:

- Save tokens to `mcp/.local/mcp-tokens.json` (gitignored)
- **Merge** `reganchor` into `.cursor/mcp.json` (keeps supabase/stripe/etc.)
- Smoke-test `tools/list` and `list_assets`
- Tell you if `JWT_SECRET` is missing (platform step A2)

You should **not** hand-edit JSON unless the smoke test says otherwise.

### B4. Cursor

1. Cursor → Settings → MCP → reload / toggle **reganchor** off then on.
2. Do **not** click **Authenticate** for RegAnchor. Auth is the `Authorization: Bearer ra_mcp_at_…` header.
3. Confirm tools appear (`list_assets`, `connection_status`, …).
4. In chat: `List my assets`.

---

## C. Day-2: token refresh

Access tokens last **1 hour**.

```bat
cd /d C:\path\to\mlagroup.github.io\mcp
node login.mjs --refresh
```

That renews from the saved refresh token and rewrites `.cursor/mcp.json`.  
If refresh fails, run `node login.mjs` again (full device approve).

---

## D. Failure cheat sheet

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot find module …\login.mjs` | Ran from repo root | `cd mcp` then `node login.mjs` |
| `'Set-Location' is not recognized` | PowerShell command in cmd.exe | Use `cd /d …` or switch to PowerShell |
| Cursor shows two JSON roots / parse error | Pasted a second `{ "mcpServers": … }` or a comment | One root only; prefer `login.mjs` auto-merge |
| `Needs Authentication` + Authenticate button | Cursor OAuth UI | Ignore Authenticate; reload with headers present |
| `Env name cannot start with SUPABASE_` | Secret named `SUPABASE_JWT_SECRET` | Use `JWT_SECRET` |
| `JWT signing secret is not configured` | Edge secret missing or wrong key pasted | A2 with **JWT Secret**, not service_role |
| `Invalid MCP access token` / expired | Access token > 1h old | `node login.mjs --refresh` |
| `tools/list` works, tool calls fail | Usually missing `JWT_SECRET` | A2 |
| Gateway token in MCP headers | Wrong token family | Must be `ra_mcp_at_…`, never `ra_gw_…` |

---

## E. What not to do

- Do not put tokens in git (`.cursor/mcp.json` and `mcp/.local/` are gitignored).
- Do not paste secrets into chat with an agent.
- Do not treat stdio `server.mjs` as the primary product path (HTTP + device login is).
- Do not use the service_role key as `JWT_SECRET` or as `REGANCHOR_ANON_KEY`.

Contract and tool list: [MCP.md](./MCP.md). Package notes: [mcp/README.md](../mcp/README.md).
