#!/usr/bin/env node
/**
 * RegAnchor MCP device login CLI.
 * Device approve (default) or --refresh from saved refresh token.
 * Always merges .cursor/mcp.json and smoke-tests the MCP endpoint.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(root, 'mcp', '.env')
const tokenPath = path.join(root, 'mcp', '.local', 'mcp-tokens.json')
const mcpJsonPath = path.join(root, '.cursor', 'mcp.json')
const wantRefresh = process.argv.includes('--refresh')

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const i = trimmed.indexOf('=')
    if (i < 1) continue
    const key = trimmed.slice(0, i).trim()
    const value = trimmed.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = value
  }
}

const supabaseUrl = (process.env.REGANCHOR_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '')
const anonKey = process.env.REGANCHOR_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
if (!supabaseUrl || !anonKey) {
  console.error('Missing mcp/.env. Copy mcp/.env.example → mcp/.env and set REGANCHOR_SUPABASE_URL + REGANCHOR_ANON_KEY (publishable/anon, not service_role).')
  console.error('See docs/MCP-INSTALL.md')
  process.exit(2)
}

const authUrl = `${supabaseUrl}/functions/v1/mcp-auth`
const mcpUrl = `${supabaseUrl}/functions/v1/mcp`

async function authPost(body) {
  const res = await fetch(authUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { res, data }
}

function saveTokens(data) {
  const outDir = path.dirname(tokenPath)
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(
    tokenPath,
    JSON.stringify(
      {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        obtained_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
}

function mergeCursorMcpJson(accessToken) {
  fs.mkdirSync(path.dirname(mcpJsonPath), { recursive: true })
  let existing = { mcpServers: {} }
  if (fs.existsSync(mcpJsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf8'))
      if (parsed && typeof parsed === 'object' && parsed.mcpServers && typeof parsed.mcpServers === 'object') {
        existing = parsed
      } else {
        console.warn('Warning: .cursor/mcp.json was invalid shape; recreating with a single mcpServers root.')
      }
    } catch {
      console.warn('Warning: .cursor/mcp.json was not valid JSON; recreating with a single mcpServers root.')
    }
  }
  existing.mcpServers = existing.mcpServers || {}
  existing.mcpServers.reganchor = {
    url: mcpUrl,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
    },
  }
  fs.writeFileSync(mcpJsonPath, `${JSON.stringify(existing, null, 2)}\n`)
  return mcpJsonPath
}

async function smokeTest(accessToken) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    apikey: anonKey,
  }
  const listRes = await fetch(mcpUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  })
  const listBody = await listRes.json().catch(() => ({}))
  if (!listRes.ok || listBody.error) {
    const msg = listBody.error?.message || `HTTP ${listRes.status}`
    console.error(`Smoke tools/list failed: ${msg}`)
    if (/JWT signing secret|JWT_SECRET/i.test(msg)) {
      console.error('Platform fix: npx supabase secrets set JWT_SECRET="…" --project-ref YOUR_REF')
      console.error('(Use Dashboard → API → JWT Secret. Not service_role. Not SUPABASE_JWT_SECRET.)')
    }
    return false
  }
  const n = listBody.result?.tools?.length ?? 0
  console.log(`Smoke tools/list: ok (${n} tools)`)

  const callRes = await fetch(mcpUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'list_assets', arguments: { limit: 5 } },
    }),
  })
  const callBody = await callRes.json().catch(() => ({}))
  if (!callRes.ok || callBody.error || callBody.result?.isError) {
    const msg =
      callBody.error?.message ||
      callBody.result?.content?.[0]?.text ||
      `HTTP ${callRes.status}`
    console.error(`Smoke list_assets failed: ${msg}`)
    if (/JWT signing secret|JWT_SECRET/i.test(msg)) {
      console.error('Platform fix: npx supabase secrets set JWT_SECRET="…" --project-ref YOUR_REF')
      console.error('(Use Dashboard → API → JWT Secret. Not service_role. Not SUPABASE_JWT_SECRET.)')
    }
    return false
  }
  console.log('Smoke list_assets: ok')
  return true
}

async function complete(data, label) {
  saveTokens(data)
  const written = mergeCursorMcpJson(data.access_token)
  console.log('')
  console.log(`${label}. Tokens saved to mcp/.local/mcp-tokens.json (gitignored).`)
  console.log(`Merged reganchor into ${path.relative(root, written)}`)
  console.log('')
  const ok = await smokeTest(data.access_token)
  console.log('')
  if (ok) {
    console.log('Next: Cursor → MCP → toggle reganchor off/on. Do not click Authenticate.')
    console.log('Then ask: List my assets')
  } else {
    console.log('Login saved config, but smoke failed. Fix the error above (see docs/MCP-INSTALL.md).')
    process.exitCode = 1
  }
  console.log('Access tokens expire in one hour. Renew with: node login.mjs --refresh')
}

if (wantRefresh) {
  if (!fs.existsSync(tokenPath)) {
    console.error('No mcp/.local/mcp-tokens.json. Run: node login.mjs')
    process.exit(1)
  }
  const saved = JSON.parse(fs.readFileSync(tokenPath, 'utf8'))
  if (!saved.refresh_token) {
    console.error('No refresh_token on disk. Run: node login.mjs')
    process.exit(1)
  }
  console.log('Refreshing MCP access token…')
  const { res, data } = await authPost({ action: 'refresh', refresh_token: saved.refresh_token })
  if (!res.ok || !data.access_token) {
    console.error('Refresh failed:', data.error || data.message || res.status)
    console.error('Run a full login: node login.mjs')
    process.exit(1)
  }
  await complete(data, 'Refreshed')
  process.exit(process.exitCode || 0)
}

const start = await authPost({ action: 'device_start', client_name: 'cursor-login' })
if (!start.res.ok || !start.data.device_code) {
  console.error('device_start failed:', start.data.error || start.res.status)
  process.exit(1)
}

console.log('')
console.log('RegAnchor MCP device login')
console.log('--------------------------')
console.log(`User code:  ${start.data.user_code}`)
console.log(`Open:       ${start.data.verification_uri_complete || start.data.verification_uri}`)
console.log('Approve in the portal while signed in, then wait here.')
console.log('(Install guide: docs/MCP-INSTALL.md)')
console.log('')

const deviceCode = start.data.device_code
const intervalMs = Math.max(3, Number(start.data.interval) || 5) * 1000
const deadline = Date.now() + (Number(start.data.expires_in) || 900) * 1000

while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, intervalMs))
  const poll = await authPost({ action: 'device_token', device_code: deviceCode })
  if (poll.data?.access_token) {
    await complete(poll.data, 'Approved')
    process.exit(process.exitCode || 0)
  }
  if (poll.data?.error === 'authorization_pending') {
    process.stdout.write('.')
    continue
  }
  console.error('\nLogin failed:', poll.data.error || poll.data.message || poll.res.status)
  process.exit(1)
}

console.error('\nTimed out waiting for approval.')
process.exit(1)
