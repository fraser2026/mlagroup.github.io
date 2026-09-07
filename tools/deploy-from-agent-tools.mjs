/**
 * Deploy one edge function via Supabase MCP-compatible Management API FormData,
 * reading payload from agent-tools/deploys/<name>.lf.json (or .json).
 *
 * This is a fallback when CallDynamicTool cannot carry large file payloads.
 * Requires SUPABASE_ACCESS_TOKEN.
 *
 * Usage: node tools/deploy-from-agent-tools.mjs asset-gateway-token
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const name = process.argv[2]
if (!name) {
  console.error('usage: node tools/deploy-from-agent-tools.mjs <slug>')
  process.exit(1)
}

const token = (process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_TOKEN || '').trim()
if (!token) {
  console.error(JSON.stringify({ ok: false, error: 'Missing SUPABASE_ACCESS_TOKEN' }))
  process.exit(2)
}

const agentTools = path.join(
  process.env.USERPROFILE || '',
  '.cursor/projects/c-Users-Fraser-myprojects-mlagroup-github-io/agent-tools/deploys',
)
const candidates = [
  path.join(agentTools, `${name}.lf.json`),
  path.join(agentTools, `${name}.json`),
]
const src = candidates.find((p) => fs.existsSync(p))
if (!src) {
  console.error(JSON.stringify({ ok: false, error: `No payload for ${name}` }))
  process.exit(3)
}

const payload = JSON.parse(fs.readFileSync(src, 'utf8'))
payload.files = payload.files.map((f) => ({
  name: f.name,
  content: String(f.content).replace(/\r\n/g, '\n'),
}))

const form = new FormData()
form.append(
  'metadata',
  JSON.stringify({
    name: payload.name,
    entrypoint_path: payload.entrypoint_path,
    verify_jwt: payload.verify_jwt !== false,
  }),
)
for (const f of payload.files) {
  form.append('file', new Blob([f.content], { type: 'application/typescript' }), f.name)
}

const url = `https://api.supabase.com/v1/projects/${payload.project_id}/functions/deploy?slug=${encodeURIComponent(name)}`
const res = await fetch(url, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: form,
})
const text = await res.text()
let body
try {
  body = JSON.parse(text)
} catch {
  body = text.slice(0, 2000)
}
console.log(JSON.stringify({ ok: res.ok, status: res.status, name, files: payload.files.map((f) => f.name), body }, null, 2))
if (!res.ok) process.exit(1)
