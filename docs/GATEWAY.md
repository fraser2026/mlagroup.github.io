# Governed Anthropic gateway

RegAnchor's optional gateway gives an Anthropic registry asset a controlled Messages API path:

`https://gateway.reganchor.com/v1/messages`

It is a governance boundary, not a model host and not a Cursor clone. Requests are forwarded to Anthropic using the runtime API key already encrypted for the asset in Supabase Vault. Anthropic remains the model provider.

## What RegAnchor records

For each successful response, RegAnchor records:

- asset and organisation identifiers;
- model;
- input and output token counts;
- source (`gateway`) and timestamp.

RegAnchor does **not** store full prompts or completions by default. Traffic still passes through the RegAnchor Edge Function in order to reach Anthropic, so deployers should reflect that processor role in their privacy and security documentation.

## Create a token

Organisation owners and admins can open an Anthropic asset's **Connection** tab, connect its runtime key, and mint a labelled gateway token. The plaintext `ra_gw_…` token is shown once; only its SHA-256 hash is stored. Revocation takes effect on the next request.

Use a separate token per environment or workload. Treat it as a production secret and do not place it in browser code, source control, logs, or analytics.

## Call the gateway

The request body follows Anthropic's Messages API. Replace the Anthropic API key with the RegAnchor gateway token:

```bash
curl https://gateway.reganchor.com/v1/messages \
  -H "authorization: Bearer $REGANCHOR_GATEWAY_TOKEN" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  --data '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 256,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

`x-reganchor-gateway-token` is also accepted when an HTTP client cannot set `Authorization`. Do not send the Anthropic key to the gateway client.

Streaming (`"stream": true`) is supported and Anthropic's server-sent events are passed through unchanged. Usage is written when the stream completes normally; a client-aborted stream may not produce a usage event.

## Deployment

Deploy both Edge Functions after applying the Phase 8 migration:

- `asset-gateway-token` — JWT-authenticated mint/list/revoke management;
- `gateway-anthropic` — gateway-token-authenticated Messages API proxy.

`gateway.reganchor.com/v1/messages` must be routed at the edge to the deployed `gateway-anthropic` function. Until that DNS/proxy route exists, use the project's direct Supabase Function URL:

`https://<project-ref>.supabase.co/functions/v1/gateway-anthropic`

The gateway function has Supabase JWT verification disabled intentionally because its bearer credential is the asset gateway token. It performs capability verification before reading the asset's Vault secret.
