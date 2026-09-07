/**
 * Loads clean deploy args and prints a one-line JSON for MCP CallDynamicTool arguments.
 * Usage: node tools/print-deploy-args.mjs provider-connect
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const name = process.argv[2]
const p = path.join(root, 'tools', `.mcp-invoke-args-${name}.json`)
if (!fs.existsSync(p)) {
  // fall back to clean payload and normalize
  const clean = path.join(root, 'tools', `.mcp-clean-${name}.json`)
  const j = JSON.parse(fs.readFileSync(clean, 'utf8'))
  j.files = j.files.map((f) => ({ name: f.name, content: f.content.replace(/\r\n/g, '\n') }))
  process.stdout.write(JSON.stringify(j))
} else {
  process.stdout.write(fs.readFileSync(p, 'utf8'))
}
