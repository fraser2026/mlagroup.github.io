import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = [
  ['index.ts', 'supabase/functions/provider-insights/index.ts'],
  ['_shared/provider-connection.ts', 'supabase/functions/_shared/provider-connection.ts'],
  ['_shared/providers/index.ts', 'supabase/functions/_shared/providers/index.ts'],
  ['_shared/providers/types.ts', 'supabase/functions/_shared/providers/types.ts'],
  ['_shared/providers/anthropic.ts', 'supabase/functions/_shared/providers/anthropic.ts'],
].map(([name, rel]) => ({
  name,
  content: fs.readFileSync(path.join(root, rel), 'utf8'),
}))

const payload = {
  project_id: 'hueftewwenjaiagdoqmb',
  name: 'provider-insights',
  entrypoint_path: 'index.ts',
  verify_jwt: true,
  files,
}

const out = path.join(root, 'tools', 'provider-insights-deploy-payload.json')
fs.writeFileSync(out, JSON.stringify(payload))
console.log('wrote', out, 'files:', files.length)
for (const f of files) {
  console.log(f.name, f.content.length, 'bytes', f.content.includes('LOAD_FROM_CHUNK') ? 'BAD' : 'ok')
}
