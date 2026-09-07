import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const names = ['provider-connect', 'provider-test', 'provider-revoke']

for (const name of names) {
  const clean = path.join(root, 'tools', `.mcp-clean-${name}.json`)
  const j = JSON.parse(fs.readFileSync(clean, 'utf8'))
  j.files = j.files.map((f) => ({
    name: f.name,
    content: f.content.replace(/\r\n/g, '\n'),
  }))
  const idx = j.files[0].content
  const out = path.join(root, 'tools', `.mcp-invoke-args-${name}.json`)
  fs.writeFileSync(out, JSON.stringify(j))
  console.log(JSON.stringify({
    name,
    files: j.files.length,
    bytes: Buffer.byteLength(JSON.stringify(j)),
    deno: idx.includes('Deno.serve'),
    sharedImport: idx.includes('../_shared/'),
    options: idx.includes("if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })"),
    newFunction: idx.includes('new Function'),
    atob: idx.includes('atob(A+B)'),
  }))
}
