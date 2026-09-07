import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)))

function stripTypes(src) {
  let s = src.replace(/\r\n/g, '\n')

  // Remove top-level type / interface declarations
  s = s.replace(/^type [A-Za-z0-9_]+[^=]*=\s*\{[\s\S]*?\n\}\s*$/gm, '')
  s = s.replace(/^type [A-Za-z0-9_]+[^=]*=\s*(?:\n\s*\|[^\n]+)+\s*$/gm, '')
  s = s.replace(/^type [A-Za-z0-9_]+[^=]*=\s*[^\n{;]+;?\s*$/gm, '')
  s = s.replace(/^interface [A-Za-z0-9_<> ]+\{[\s\S]*?\n\}\s*$/gm, '')

  // Remove simple return / param annotations
  s = s.replace(/\)\s*:\s*Promise<[^>]+>/g, ')')
  s = s.replace(/\)\s*:\s*[A-Za-z0-9_<>|'"\s.\[\]]+(?=\s*\{)/g, ')')
  s = s.replace(/:\s*Promise<[^>]+>/g, '')
  s = s.replace(/:\s*[A-Za-z_][A-Za-z0-9_<>|'"\s.\[\]]*(?=\s*[=,)])/g, '')

  // Remove `as Type` casts
  s = s.replace(/\s+as\s+[A-Za-z_][A-Za-z0-9_<>|'"\s.\[\]]*/g, '')

  if (!s.includes("from 'https://esm.sh/@supabase/supabase-js@2'")) {
    s = "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'\n" + s
  }

  s = s.replace(/\/\*[\s\S]*?\*\//g, '')
  s = s.replace(/(^|[^:])\/\/(?![^\n]*https?).*$/gm, '$1')
  s = s.replace(/\n{2,}/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n /g, '\n').trim()
  return s
}

const names = ['provider-insights', 'provider-connect', 'provider-test', 'provider-revoke']
for (const n of names) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, `.mcp-bundle-${n}.json`), 'utf8'))
  const c = stripTypes(j.files[0].content)
  const out = {
    project_id: j.project_id,
    name: j.name,
    entrypoint_path: 'index.ts',
    verify_jwt: true,
    files: [{ name: 'index.ts', content: c }],
  }
  fs.writeFileSync(path.join(dir, `.mcp-slim-${n}.json`), JSON.stringify(out))
  console.log(
    JSON.stringify({
      n,
      len: c.length,
      json: JSON.stringify(out).length,
      resolve: c.includes('resolveAnthropicRuntimeAttribution'),
      api_key_ids: c.includes('api_key_ids'),
      ph: c.includes('PLACEHOLDER'),
      chunk: c.includes('LOAD_FROM_CHUNK'),
      deno: c.includes('Deno.serve'),
      imp: c.includes('createClient'),
    }),
  )
}
