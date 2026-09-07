import fs from 'node:fs'

const types = fs.readFileSync('supabase/functions/_shared/providers/types.ts', 'utf8')
const anthropic = fs.readFileSync('supabase/functions/_shared/providers/anthropic.ts', 'utf8')
const providersIndex = fs.readFileSync('supabase/functions/_shared/providers/index.ts', 'utf8')
  .replaceAll("from './anthropic.ts'", "from './anthropic.ts'")
  .replaceAll("from './types.ts'", "from './types.ts'")
const connection = fs.readFileSync('supabase/functions/_shared/provider-connection.ts', 'utf8')
  .replaceAll("from './providers/types.ts'", "from './types.ts'")
const entry = fs.readFileSync('supabase/functions/provider-insights/index.ts', 'utf8')
  .replaceAll("from '../_shared/provider-connection.ts'", "from './provider-connection.ts'")
  .replaceAll("from '../_shared/providers/index.ts'", "from './providers-index.ts'")

const files = [
  { name: 'index.ts', content: entry },
  { name: 'provider-connection.ts', content: connection },
  { name: 'types.ts', content: types },
  { name: 'anthropic.ts', content: anthropic },
  { name: 'providers-index.ts', content: providersIndex },
]

const payload = {
  project_id: 'hueftewwenjaiagdoqmb',
  name: 'provider-insights',
  entrypoint_path: 'index.ts',
  verify_jwt: true,
  files,
}

fs.writeFileSync('tools/provider-insights-flat-deploy.json', JSON.stringify(payload))
for (const f of files) {
  console.log(f.name, f.content.length, f.content.includes('PLACEHOLDER') ? 'BAD' : 'ok')
}
console.log('isoTomorrowUtcMidnight', anthropic.includes('isoTomorrowUtcMidnight'))
