import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const base = path.join(root, 'supabase', 'functions')

const shared = [
  ['_shared/provider-connection.ts', '_shared/provider-connection.ts'],
  ['_shared/providers/index.ts', '_shared/providers/index.ts'],
  ['_shared/providers/types.ts', '_shared/providers/types.ts'],
  ['_shared/providers/anthropic.ts', '_shared/providers/anthropic.ts'],
]

const names = ['provider-insights', 'provider-connect', 'provider-test', 'provider-revoke']

for (const name of names) {
  const files = [
    { name: `${name}/index.ts`, content: fs.readFileSync(path.join(base, name, 'index.ts'), 'utf8') },
    ...shared.map(([fileName, rel]) => ({
      name: fileName,
      content: fs.readFileSync(path.join(base, rel), 'utf8'),
    })),
  ]
  const payload = {
    project_id: 'hueftewwenjaiagdoqmb',
    name,
    entrypoint_path: `${name}/index.ts`,
    verify_jwt: true,
    files,
  }
  const out = path.join(root, 'tools', `${name}-deploy.json`)
  fs.writeFileSync(out, JSON.stringify(payload))
  const bad = files.some((f) => f.content.includes('PLACEHOLDER') || f.content.includes('LOAD_FROM_CHUNK'))
  console.log(name, files.length, 'files', bad ? 'BAD' : 'ok', Buffer.byteLength(JSON.stringify(payload)))
}
