# RegAnchor MCP OAuth (Cursor / marketplace path)

Authorization server for MCP hosts that speak OAuth 2.1 + PKCE (Cursor Authenticate, marketplace-shaped installs).

Identity remains RegAnchor (Supabase Auth). No WorkOS required. Tokens issued are the same opaque family as device/portal connect (`ra_mcp_at_…` / `ra_mcp_rt_…`).

## Endpoints

Base: `https://<project>.supabase.co/functions/v1/mcp-oauth`

| Method | Path | Role |
|---|---|---|
| GET | `/` or `/.well-known/oauth-authorization-server` | AS metadata (RFC 8414-style) |
| GET | `/protected-resource` | Protected Resource Metadata (RFC 9728) |
| POST | `/register` | Dynamic Client Registration (RFC 7591) |
| GET | `/authorize` | Redirects to portal consent (`#mcp-oauth`) |
| POST | `/consent` | Portal Allow/Deny (Bearer **user** JWT) |
| POST | `/token` | `authorization_code` + PKCE, or `refresh_token` |

MCP resource: `…/functions/v1/mcp`  
Unauthenticated tool calls return **401** with  
`WWW-Authenticate: Bearer … resource_metadata="<prm-url>"`.

## Security controls

- Authorization code + **PKCE S256** only (no implicit, no `plain`)
- Public clients (`token_endpoint_auth_method: none`)
- Redirect URI allowlist: `cursor://`, `cursor-dev://`, `vscode://`, `vscode-insiders://`, `https://claude.ai/…`, `http://127.0.0.1` / `localhost`
- Exact redirect URI match against registered client
- Auth codes: 5 minutes, one-time, hashed at rest
- Access: 1 hour; refresh: 30 days, rotate-on-use
- Resource indicator constrained to the RegAnchor MCP URL
- Consent only after portal sign-in; org membership checked when `org_id` supplied

## Marketplace readiness

This implements the protocol surface Cursor expects for remote MCP OAuth (discovery → DCR → authorize → token). Listing still depends on Cursor marketplace submission and review; this stack is the technical prerequisite without a third-party IdP.

## Customer UX without marketplace

Prefer [MCP-CONNECT.md](./MCP-CONNECT.md) **Portal Connect** (no OAuth dance). OAuth is for hosts that open Authenticate themselves.
