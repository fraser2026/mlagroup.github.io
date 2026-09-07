import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.dirname(fileURLToPath(import.meta.url))
const base = path.join(root, '..', 'supabase', 'functions')

const files = [
  ['provider-insights/index.ts', 'provider-insights/index.ts'],
  ['_shared/provider-connection.ts', '_shared/provider-connection.ts'],
  ['_shared/providers/index.ts', '_shared/providers/index.ts'],
  ['_shared/providers/types.ts', '_shared/providers/types.ts'],
  ['_shared/providers/anthropic.ts', '_shared/providers/anthropic.ts'],
].map(([name, rel]) => ({
  name,
  content: fs.readFileSync(path.join(base, rel), 'utf8'),
}))

const payload = {
  project_id: 'hueftewwenjaiagdoqmb',
  name: 'provider-insights',
  entrypoint_path: 'provider-insights/index.ts',
  verify_jwt: true,
  files,
}

const out = path.join(root, '..', '.deploy-args-only.json')
fs.writeFileSync(out, JSON.stringify(payload))
console.log('payload ready', files.length, 'files', files[4].content.includes('fetchAnthropicGovernanceInsights'))
