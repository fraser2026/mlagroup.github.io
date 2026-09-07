/**
 * Build and print deploy_edge_function arguments as a single JSON line.
 * Used so the agent can pipe content into MCP without retyping.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const name = process.argv[2] || 'provider-connect'
const j = JSON.parse(fs.readFileSync(path.join(root, 'tools', `.mcp-invoke-args-${name}.json`), 'utf8'))

// Write each file to a numbered path the agent can Read and reassemble if needed
const dir = path.join(root, 'tools', `.deploy-parts-${name}`)
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
  project_id: j.project_id,
  name: j.name,
  entrypoint_path: j.entrypoint_path,
  verify_jwt: j.verify_jwt,
  files: j.files.map((f, i) => ({ i, name: f.name, bytes: f.content.length })),
}))
j.files.forEach((f, i) => {
  fs.writeFileSync(path.join(dir, `${i}.ts`), f.content)
})
console.log(JSON.stringify({ dir, count: j.files.length, totalBytes: Buffer.byteLength(JSON.stringify(j)) }))
