# Connect RegAnchor MCP (customers)

For developers and operators with a RegAnchor account. **No Supabase access required.**

This links Cursor, Codex, Claude Desktop, or another MCP host to your registry tools.  
It is **not** the Claude Messages gateway (`ra_gw_…`).

---

## Option A — Portal Connect (recommended)

1. Sign in at [reganchor.com/portal.html](https://reganchor.com/portal.html).
2. Open **Integrations**.
3. Under **Agent MCP**, choose your client → **Connect**.
4. Copy the config snippet into your host (see below).
5. Reload MCP tools in the host. Ask: `List my assets`.

Revoke unused sessions from the same page.

Access tokens last **one hour**. Click **Connect** again (or use refresh if your host supports `ra_mcp_rt_…`) when they expire.

### Cursor (header config)

Merge under `.cursor/mcp.json` — **one** `{ "mcpServers": { … } }` root, no comments:

```json
{
  "mcpServers": {
    "reganchor": {
      "url": "https://<project>.supabase.co/functions/v1/mcp",
      "headers": {
        "Authorization": "Bearer ra_mcp_at_…",
        "apikey": "<publishable or anon key>"
      }
    }
  }
}
```

Do **not** click Cursor **Authenticate** when using this snippet. Auth is the Bearer header.

### Cursor (OAuth / marketplace-shaped)

When OAuth is enabled for your project:

1. Add a remote MCP server with URL only:  
   `https://<project>.supabase.co/functions/v1/mcp`
2. Click **Authenticate** / Connect.
3. Approve in the RegAnchor portal consent screen.
4. Cursor stores and refreshes tokens.

### Codex / other hosts

Use the same `mcpServers.reganchor` object your portal snippet prints. Paths vary by product; the URL + Bearer + `apikey` headers are the same.

---

## Option B — Device code (CLI)

If your host starts login itself:

1. Host shows a code `ABCD-EFGH`.
2. Open **Integrations → Approve MCP login** (or the printed portal URL).
3. Enter the code → **Approve**.
4. Return to the host.

Repo maintainers can still use `node mcp/login.mjs` from a clone; customers should prefer Option A.

---

## What you get

| Tool | Purpose |
|---|---|
| `list_assets` / `get_asset` | Registry |
| `connection_status` | Runtime / Admin link status (no secrets) |
| `list_controls` / `policy_context` | Governance context |
| `refresh_insights` | Admin usage refresh (owner/admin) |
| Gateway token list / mint / revoke | Owner/admin |

Permissions match your portal role (RLS).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Tools missing | Reload MCP; confirm token not expired |
| `Needs Authentication` with pasted headers | Ignore Authenticate; reload with headers present |
| 401 after an hour | Connect again from Integrations |
| Wrong product | Gateway tokens (`ra_gw_…`) are not MCP tokens |

Platform/ops runbook (RegAnchor staff only): [MCP-INSTALL.md](./MCP-INSTALL.md).  
Protocol contract: [MCP.md](./MCP.md). OAuth notes: [MCP-OAUTH.md](./MCP-OAUTH.md).
