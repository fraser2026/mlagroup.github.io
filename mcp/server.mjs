#!/usr/bin/env node
/**
 * Optional stdio adapter. Prefer remote HTTP MCP (see README / docs/MCP.md).
 * If REGANCHOR_MCP_ACCESS_TOKEN is set, this process proxies JSON-RPC tool calls
 * to the hosted /functions/v1/mcp endpoint.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const supabaseUrl = (process.env.REGANCHOR_SUPABASE_URL || '').replace(/\/+$/, '');
const anonKey = process.env.REGANCHOR_ANON_KEY || '';
const accessToken = process.env.REGANCHOR_MCP_ACCESS_TOKEN || '';

if (!supabaseUrl || !anonKey || !accessToken) {
  console.error(
    'Stdio adapter requires REGANCHOR_SUPABASE_URL, REGANCHOR_ANON_KEY, and REGANCHOR_MCP_ACCESS_TOKEN from device login (node mcp/login.mjs). Prefer configuring Cursor with the remote MCP URL instead.',
  );
  process.exit(1);
}

if (!accessToken.startsWith('ra_mcp_at_')) {
  console.error('REGANCHOR_MCP_ACCESS_TOKEN must be an MCP access token (ra_mcp_at_…), not a portal JWT or gateway token.');
  process.exit(1);
}

async function mcpRpc(method, params) {
  const res = await fetch(`${supabaseUrl}/functions/v1/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    throw new Error(body.error?.message || body.message || `MCP HTTP ${res.status}`);
  }
  return body.result;
}

const server = new McpServer({ name: 'reganchor', version: '1.0.0' });

const tools = await mcpRpc('tools/list', {});
for (const tool of tools.tools || []) {
  const shape = {};
  const props = tool.inputSchema?.properties || {};
  for (const [key, schema] of Object.entries(props)) {
    if (schema.type === 'integer' || schema.type === 'number') shape[key] = z.number().optional();
    else if (schema.type === 'boolean') shape[key] = z.boolean().optional();
    else shape[key] = z.string().optional();
  }
  server.registerTool(
    tool.name,
    {
      title: tool.name,
      description: tool.description || tool.name,
      inputSchema: shape,
    },
    async (args) => {
      const result = await mcpRpc('tools/call', { name: tool.name, arguments: args || {} });
      return result;
    },
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
