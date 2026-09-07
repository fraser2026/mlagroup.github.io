/**
 * Prints deploy_edge_function args JSON to stdout for MCP invocation verification.
 * Does not deploy by itself.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const base = path.join(root, 'supabase', 'functions')

const files = [
  'provider-insights/index.ts',
  '_shared/provider-connection.ts',
  '_shared/providers/index.ts',
  '_shared/providers/types.ts',
  '_shared/providers/anthropic.ts',
].map((name) => ({
  name,
  content: fs.readFileSync(path.join(base, name), 'utf8').replace(/\r\n/g, '\n'),
}))

const anth = files.find((f) => f.name.endsWith('anthropic.ts')).content
if (!anth.includes('isoTomorrowUtcMidnight') || !anth.includes('bucketWidth')) {
  console.error('VERIFY_FAIL missing isoTomorrowUtcMidnight or bucketWidth')
  process.exit(1)
}
if (files.some((f) => f.content.includes('PLACEHOLDER') || f.content.includes('LOAD_FROM_CHUNK'))) {
  console.error('VERIFY_FAIL placeholder or LOAD_FROM_CHUNK detected')
  process.exit(1)
}

const args = {
  project_id: 'hueftewwenjaiagdoqmb',
  name: 'provider-insights',
  entrypoint_path: 'provider-insights/index.ts',
  verify_jwt: true,
  files,
}

const out = path.join(root, '.mcp-deploy-call.json')
fs.writeFileSync(out, JSON.stringify(args))
console.log(JSON.stringify({
  ok: true,
  out,
  bytes: Buffer.byteLength(JSON.stringify(args)),
  files: files.map((f) => ({ name: f.name, chars: f.content.length })),
}))
