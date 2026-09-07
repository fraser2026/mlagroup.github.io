import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const name = process.argv[2]
if (!name) {
  console.error('usage: node emit-mcp-args.mjs <function-slug>')
  process.exit(1)
}
const payload = JSON.parse(fs.readFileSync(path.join(root, 'tools', `.mcp-clean-${name}.json`), 'utf8'))
// Normalize CRLF -> LF for cleaner deploy source
payload.files = payload.files.map((f) => ({
  name: f.name,
  content: f.content.replace(/\r\n/g, '\n'),
}))
const out = path.join(root, 'tools', `.mcp-invoke-args-${name}.json`)
fs.writeFileSync(out, JSON.stringify(payload))
console.log(JSON.stringify({
  out,
  bytes: Buffer.byteLength(JSON.stringify(payload)),
  files: payload.files.map((f) => f.name),
  deno: payload.files[0].content.includes('Deno.serve'),
  sharedImport: payload.files[0].content.includes('../_shared/'),
  options: payload.files[0].content.includes("if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })"),
  newFunction: payload.files[0].content.includes('new Function'),
  atob: payload.files[0].content.includes('atob(A+B)'),
}))
