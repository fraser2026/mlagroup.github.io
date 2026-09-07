/**
 * Deploy clean provider functions via MCP-shaped payload using Management API.
 * Token is read from env or from common Cursor/Supabase credential locations
 * without printing the secret.
 *
 * Usage: node tools/deploy-clean-with-token.mjs provider-connect
 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const name = process.argv[2]
if (!name) {
  console.error('usage: node tools/deploy-clean-with-token.mjs <slug>')
  process.exit(1)
}

function findToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim()
  if (process.env.SUPABASE_TOKEN) return process.env.SUPABASE_TOKEN.trim()
  const candidates = [
    path.join(os.homedir(), '.supabase', 'access-token'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'supabase', 'access-token'),
    path.join(process.env.LOCALAPPDATA || '', 'supabase', 'access-token'),
  ]
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        const t = fs.readFileSync(c, 'utf8').trim()
        if (t) return t
      }
    } catch {
      // ignore
    }
  }
  return null
}

const token = findToken()
if (!token) {
  console.log(JSON.stringify({ ok: false, error: 'NO_TOKEN' }))
  process.exit(2)
}

const payload = JSON.parse(fs.readFileSync(path.join(root, 'tools', `.mcp-invoke-args-${name}.json`), 'utf8'))
const form = new FormData()
form.append(
  'metadata',
  JSON.stringify({
    name: payload.name,
    entrypoint_path: payload.entrypoint_path,
    verify_jwt: payload.verify_jwt,
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
  body = { raw: text.slice(0, 500) }
}
console.log(JSON.stringify({
  ok: res.ok,
  status: res.status,
  version: body.version,
  statusName: body.status,
  slug: body.slug || name,
  hasError: !res.ok,
  error: res.ok ? undefined : (body.message || body.error || text.slice(0, 300)),
}))
process.exit(res.ok ? 0 : 1)
