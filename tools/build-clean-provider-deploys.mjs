import fs from 'fs'
import path from 'path'

const root = 'c:/Users/Fraser/myprojects/mlagroup.github.io/supabase/functions'
const outDir = 'c:/Users/Fraser/myprojects/mlagroup.github.io/tools'
const shared = [
  ['../_shared/provider-connection.ts', '_shared/provider-connection.ts'],
  ['../_shared/providers/index.ts', '_shared/providers/index.ts'],
  ['../_shared/providers/types.ts', '_shared/providers/types.ts'],
  ['../_shared/providers/anthropic.ts', '_shared/providers/anthropic.ts'],
]
const fns = ['provider-connect', 'provider-test', 'provider-revoke']
const optionsLine = "if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })"

for (const name of fns) {
  const files = [
    { name: 'index.ts', content: fs.readFileSync(path.join(root, name, 'index.ts'), 'utf8') },
    ...shared.map(([deployName, diskRel]) => ({
      name: deployName,
      content: fs.readFileSync(path.join(root, diskRel), 'utf8'),
    })),
  ]

  const index = files[0].content
  if (index.includes('atob(A+B)') || index.includes('new Function')) {
    throw new Error(`Obfuscation detected in ${name}/index.ts`)
  }
  if (!index.includes('Deno.serve')) throw new Error(`${name} missing Deno.serve`)
  if (!index.includes('../_shared/')) throw new Error(`${name} missing shared import`)
  if (!index.includes(optionsLine)) throw new Error(`${name} missing OPTIONS handler`)

  const payload = {
    project_id: 'hueftewwenjaiagdoqmb',
    name,
    entrypoint_path: 'index.ts',
    verify_jwt: true,
    files,
  }
  const out = path.join(outDir, `.mcp-clean-${name}.json`)
  fs.writeFileSync(out, JSON.stringify(payload))
  console.log(name, 'bytes', Buffer.byteLength(JSON.stringify(payload)), 'files', files.map((f) => f.name).join(','))
}
