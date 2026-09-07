# RegAnchor MCP (HTTP-first)

Industry-shaped control plane for agents. This is **not** the Messages gateway.

**Connect (customers):** [MCP-CONNECT.md](./MCP-CONNECT.md)  
**Install / Cursor setup (staff):** [MCP-INSTALL.md](./MCP-INSTALL.md) — use that document; do not invent a second path.  
**OAuth AS:** [MCP-OAUTH.md](./MCP-OAUTH.md)

| Layer | Role |
|---|---|
| **Gateway** (`ra_gw_…`) | Runtime Anthropic Messages + metering |
| **MCP** | Agent tools: registry, connection status, controls, policies, insights refresh, gateway token lifecycle |

## Transport

- **Primary:** Streamable HTTP (JSON responses) at  
  `https://<project>.supabase.co/functions/v1/mcp`
- **Optional:** local stdio adapter or Cursor `url` config pointing at that endpoint  
- Tool handlers are shared; transport is not the product

## Auth (device login)

1. Client calls `mcp-auth` `action=device_start` → `device_code`, `user_code`, `verification_uri`
2. User opens the portal, signs in, enters `user_code`, approves
3. Client polls `mcp-auth` `action=device_token` with `device_code`
4. Receives:
   - `access_token` (`ra_mcp_at_…`) — short-lived (1 hour)
   - `refresh_token` (`ra_mcp_rt_…`) — longer (30 days), rotatable
5. MCP HTTP requests send  
   `Authorization: Bearer <access_token>`  
   plus the project anon `apikey` header (Supabase Edge requirement)

Plaintext tokens are shown/returned once. Only SHA-256 hashes are stored.

Access tokens are resolved to a user; the MCP function mints a short-lived Supabase user JWT (requires edge secret `JWT_SECRET` = project JWT Secret from Dashboard → API; not the service_role key). Custom secrets cannot use the `SUPABASE_` prefix. RLS applies the same as the portal.

## Tools (v1)

| Tool | Access |
|---|---|
| `list_assets` | Member |
| `get_asset` | Member |
| `connection_status` | Member (no secrets) |
| `list_controls` | Member |
| `policy_context` | Member |
| `refresh_insights` | Owner/admin |
| `gateway_tokens_list` | Owner/admin |
| `gateway_token_mint` | Owner/admin |
| `gateway_token_revoke` | Owner/admin |

Allow/deny prompt policy is **out of scope** for MCP v1. That belongs on the gateway/runtime path later; MCP may expose it once it exists.

## Cursor remote config (after device login)

Prefer `node mcp/login.mjs`, which merges `.cursor/mcp.json` automatically. Manual shape:

```json
{
  "mcpServers": {
    "reganchor": {
      "url": "https://hueftewwenjaiagdoqmb.supabase.co/functions/v1/mcp",
      "headers": {
        "Authorization": "Bearer ra_mcp_at_…",
        "apikey": "<SUPABASE_ANON_OR_PUBLISHABLE_KEY>"
      }
    }
  }
}
```

Renew: `node mcp/login.mjs --refresh`. Full steps: [MCP-INSTALL.md](./MCP-INSTALL.md).

## Security

- Device codes expire in 15 minutes; one-time approval
- Access tokens expire in 1 hour; refresh rotates
- Revoke refresh token to cut off renewals
- Never log plaintext tokens
- Never return Vault secret IDs or provider API keys from tools
