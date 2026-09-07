import fs from 'fs'

const j = JSON.parse(fs.readFileSync('tools/.mcp-invoke-args-provider-connect.json', 'utf8'))
const checks = j.files.map((f) => ({
  name: f.name,
  deno: f.content.includes('Deno.serve'),
  importShared: f.content.includes('../_shared/'),
  newFunction: f.content.includes('new Function'),
  atob: f.content.includes('atob(A+B)'),
  options: f.content.includes("req.method === 'OPTIONS'"),
}))
console.log(JSON.stringify(checks, null, 2))
