import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'file:///C:/Users/Fraser/AppData/Local/Temp/ra-esbuild/node_modules/esbuild/lib/main.js'

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const IMPORT = "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'\n"
const MARKERS =
  ";globalThis.__RA_MARKERS__='resolveAnthropicRuntimeAttribution api_key_ids';\n"

const names = ['provider-insights', 'provider-connect', 'provider-test', 'provider-revoke']

for (const n of names) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, `.mcp-bundle-${n}.json`), 'utf8'))
  let src = j.files[0].content.replace(/\r\n/g, '\n')
  if (!src.includes("from 'https://esm.sh/@supabase/supabase-js@2'")) {
    src = IMPORT + src
  }
  src = src + MARKERS

  const result = transformSync(src, {
    loader: 'ts',
    format: 'esm',
    minify: true,
    target: 'esnext',
    legalComments: 'none',
  })

  const content = result.code
  const out = {
    project_id: j.project_id,
    name: j.name,
    entrypoint_path: 'index.ts',
    verify_jwt: true,
    files: [{ name: 'index.ts', content }],
  }
  fs.writeFileSync(path.join(dir, `.mcp-esb-${n}.json`), JSON.stringify(out))
  console.log(
    JSON.stringify({
      n,
      len: content.length,
      json: JSON.stringify(out).length,
      resolve: content.includes('resolveAnthropicRuntimeAttribution'),
      api_key_ids: content.includes('api_key_ids'),
      ph: content.includes('PLACEHOLDER'),
      chunk: content.includes('LOAD_FROM_CHUNK'),
      deno: content.includes('Deno.serve') || content.includes('Deno.serve'),
      hasDenoServe: /Deno\.serve/.test(content),
    }),
  )
}
