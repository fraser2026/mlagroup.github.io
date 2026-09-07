import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = JSON.parse(fs.readFileSync(path.join(root, '.mcp-deploy-call.json'), 'utf8'))
const outDir = path.join(root, '.deploy-files')
fs.mkdirSync(outDir, { recursive: true })
for (const f of args.files) {
  const safe = f.name.replaceAll('/', '__')
  fs.writeFileSync(path.join(outDir, safe), f.content)
}
console.log(JSON.stringify({
  outDir,
  files: args.files.map((f) => ({ name: f.name, chars: f.content.length })),
}))
