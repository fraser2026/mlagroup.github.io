/**
 * Deploy one clean provider edge function via Supabase Management API.
 * Requires SUPABASE_ACCESS_TOKEN in env.
 *
 * Usage: node tools/deploy-one-clean.mjs provider-connect
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const name = process.argv[2]
if (!name) {
  console.error('usage: node tools/deploy-one-clean.mjs <slug>')
  process.exit(1)
}

const token = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_TOKEN
if (!token) {
  console.error('Missing SUPABASE_ACCESS_TOKEN')
  process.exit(2)
}

const payloadPath = path.join(root, 'tools', `.mcp-invoke-args-${name}.json`)
const cleanPath = path.join(root, 'tools', `.mcp-clean-${name}.json`)
const src = fs.existsSync(payloadPath) ? payloadPath : cleanPath
const payload = JSON.parse(fs.readFileSync(src, 'utf8'))
payload.files = payload.files.map((f) => ({
  name: f.name,
  content: String(f.content).replace(/\r\n/g, '\n'),
}))

const projectId = payload.project_id
const form = new FormData()
form.append('metadata', JSON.stringify({
  name: payload.name,
  entrypoint_path: payload.entrypoint_path,
  verify_jwt: payload.verify_jwt,
}))
for (const f of payload.files) {
  form.append('file', new Blob([f.content], { type: 'application/typescript' }), f.name)
}

const url = `https://api.supabase.com/v1/projects/${projectId}/functions/deploy?slug=${encodeURIComponent(name)}`
const res = await fetch(url, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: form,
})
const text = await res.text()
console.log(JSON.stringify({ status: res.status, ok: res.ok, body: text.slice(0, 2000) }))
if (!res.ok) process.exit(1)
