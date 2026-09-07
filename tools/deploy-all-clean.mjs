/**
 * Deploy all three clean provider functions via Supabase Management API.
 * Requires SUPABASE_ACCESS_TOKEN in environment (from `supabase login` or dashboard).
 *
 * Usage: SUPABASE_ACCESS_TOKEN=sbp_... node tools/deploy-all-clean.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const token = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_TOKEN
if (!token) {
  console.error(JSON.stringify({ ok: false, error: 'Set SUPABASE_ACCESS_TOKEN' }))
  process.exit(2)
}

const names = ['provider-connect', 'provider-test', 'provider-revoke']
const results = []

for (const name of names) {
  const payload = JSON.parse(
    fs.readFileSync(path.join(root, 'tools', `.mcp-invoke-args-${name}.json`), 'utf8'),
  )
  for (const f of payload.files) {
    if (f.content.includes('new Function') || f.content.includes('atob(A+B)') || f.content.includes('PLACEHOLDER')) {
      throw new Error(`Refusing obfuscated/placeholder content in ${name}/${f.name}`)
    }
  }
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
  results.push({
    name,
    ok: res.ok,
    status: res.status,
    version: body.version,
    statusName: body.status,
    error: res.ok ? undefined : (body.message || body.error || text.slice(0, 300)),
  })
  if (!res.ok) {
    console.log(JSON.stringify({ ok: false, results }, null, 2))
    process.exit(1)
  }
}

console.log(JSON.stringify({ ok: true, results }, null, 2))
