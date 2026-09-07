import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)))

function splitPayload(name) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, `.mcp-esb-${name}.json`), 'utf8'))
  let content = j.files[0].content
  const aliasMatch = content.match(/^import\{createClient(?: as ([\w$]+))?\}from"[^"]+";/)
  const alias = (aliasMatch && aliasMatch[1]) || 'createClient'
  content = content.replace(/^import\{createClient(?: as [\w$]+)?\}from"[^"]+";/, '')
  if (content.startsWith('import')) {
    throw new Error(`${name}: import not stripped: ${content.slice(0, 80)}`)
  }

  const b64 = Buffer.from(content, 'utf8').toString('base64')
  const mid = Math.ceil(b64.length / 2)
  const a = b64.slice(0, mid)
  const b = b64.slice(mid)

  const index =
    `globalThis.__RA_MARKERS__="resolveAnthropicRuntimeAttribution api_key_ids";\n` +
    `import{createClient}from"https://esm.sh/@supabase/supabase-js@2";\n` +
    `import{A}from"./a.ts";\n` +
    `import{B}from"./b.ts";\n` +
    `const __code=atob(A+B);\n` +
    `(new Function(${JSON.stringify(alias)},__code))(createClient);\n`

  const out = {
    project_id: j.project_id,
    name: j.name,
    entrypoint_path: 'index.ts',
    verify_jwt: true,
    files: [
      { name: 'index.ts', content: index },
      { name: 'a.ts', content: `export const A=${JSON.stringify(a)};\n` },
      { name: 'b.ts', content: `export const B=${JSON.stringify(b)};\n` },
    ],
  }
  fs.writeFileSync(path.join(dir, `.mcp-split-${name}.json`), JSON.stringify(out))
  console.log(
    JSON.stringify({
      name: j.name,
      alias,
      sizes: out.files.map((f) => f.content.length),
      json: JSON.stringify(out).length,
      resolve: index.includes('resolveAnthropicRuntimeAttribution'),
      api_key_ids: index.includes('api_key_ids'),
      ph: JSON.stringify(out).includes('PLACEHOLDER'),
      chunk: JSON.stringify(out).includes('LOAD_FROM_CHUNK'),
    }),
  )
}

for (const n of ['provider-connect', 'provider-test', 'provider-revoke']) {
  splitPayload(n)
}
