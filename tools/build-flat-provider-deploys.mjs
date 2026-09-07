import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const base = path.join(root, 'supabase', 'functions')

const shared = [
  '_shared/provider-connection.ts',
  '_shared/providers/types.ts',
  '_shared/providers/anthropic.ts',
  '_shared/providers/index.ts',
].map((rel) => ({
  name: rel,
  content: fs.readFileSync(path.join(base, rel), 'utf8'),
}))

const names = ['provider-insights', 'provider-connect', 'provider-test', 'provider-revoke']

for (const name of names) {
  const entry = fs.readFileSync(path.join(base, name, 'index.ts'), 'utf8')
  const files = [
    {
      name: 'index.ts',
      content: entry.replaceAll("from '../_shared/", "from './_shared/"),
    },
    ...shared,
  ]
  const payload = {
    project_id: 'hueftewwenjaiagdoqmb',
    name,
    entrypoint_path: 'index.ts',
    verify_jwt: true,
    files,
  }
  const out = path.join(root, 'tools', `.mcp-flat-${name}.json`)
  fs.writeFileSync(out, JSON.stringify(payload))
  const blob = JSON.stringify(payload)
  console.log(
    name,
    'bytes',
    Buffer.byteLength(blob),
    'files',
    files.length,
    'resolve',
    blob.includes('resolveAnthropicRuntimeAttribution'),
    'api_key_ids',
    blob.includes('api_key_ids'),
  )
}
