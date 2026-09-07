# Branded MCP host (`mcp.reganchor.com`)

## Why

Cursor opened `https://….supabase.co/authorize` (404) instead of our
`/functions/v1/mcp-oauth/authorize`. Path-based issuers on `supabase.co` break
Cursor’s authorize URL construction.

This worker uses a **pathless issuer** `https://mcp.reganchor.com` with:

| Path | Role |
|---|---|
| `/.well-known/oauth-protected-resource` | PRM |
| `/.well-known/oauth-authorization-server` | AS metadata |
| `/authorize` | → Supabase `mcp-oauth/authorize` |
| `/token` | → `mcp-oauth/token` |
| `/register` | → `mcp-oauth/register` |
| `/mcp` | → Supabase `mcp` (+ inject apikey) |

## Deploy

```bat
cd cloudflare\mcp-host
npx wrangler login
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler deploy
```

Then in Cloudflare Dashboard → Workers → `reganchor-mcp-host` → **Custom Domains** → add `mcp.reganchor.com`.

## Cursor config (after DNS live)

```json
{
  "mcpServers": {
    "reganchor-oauth": {
      "url": "https://mcp.reganchor.com/mcp",
      "auth": {
        "CLIENT_ID": "ra_mcp_cid_cursor",
        "scopes": ["mcp:tools"]
      }
    }
  }
}
```

Authenticate should open `https://mcp.reganchor.com/authorize?...` → portal consent → callback.

Also set Edge secret (after portal is live on production):

```bat
npx supabase secrets set REGANCHOR_PUBLIC_ORIGIN="https://reganchor.com" --project-ref hueftewwenjaiagdoqmb
```

For local OAuth tests keep `REGANCHOR_PUBLIC_ORIGIN=http://127.0.0.1:3456`.
