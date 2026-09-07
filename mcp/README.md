# RegAnchor MCP

HTTP-first MCP control plane for RegAnchor.

**Connect (start here if you have a RegAnchor account):** [docs/MCP-CONNECT.md](../docs/MCP-CONNECT.md)  
**Staff install:** [docs/MCP-INSTALL.md](../docs/MCP-INSTALL.md)  
**Contract / tools:** [docs/MCP.md](../docs/MCP.md)  
**OAuth:** [docs/MCP-OAUTH.md](../docs/MCP-OAUTH.md)

This is **not** the Anthropic Messages gateway. Gateway tokens (`ra_gw_…`) meter model traffic. MCP tokens (`ra_mcp_at_…`) call registry/governance tools under your user permissions.

## Developer (after platform is live)

```bat
cd mcp
copy .env.example .env
REM edit .env — publishable/anon key only
npm.cmd install
node login.mjs
```

Then reload RegAnchor in Cursor MCP. Do **not** click Authenticate.

Hourly renew:

```bat
node login.mjs --refresh
```

`login.mjs` merges `.cursor/mcp.json` and smoke-tests `list_assets`.

## Endpoints

| Function | Purpose |
|---|---|
| `POST /functions/v1/mcp-auth` | `device_start`, `device_approve`, `device_token`, `refresh`, `revoke` |
| `POST /functions/v1/mcp` | MCP JSON-RPC |
| `GET /functions/v1/mcp` | Health |

## Local stdio (optional)

`server.mjs` is a thin adapter for hosts that only speak stdio. Prefer the remote HTTP URL in Cursor.
