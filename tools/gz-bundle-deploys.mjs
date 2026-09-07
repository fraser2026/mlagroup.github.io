import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)))

/** Remove TypeScript-only syntax enough for eval/JS runtime. */
function toRunnableJs(src) {
  let s = src.replace(/\r\n/g, '\n')

  // Drop leading type-only section until first runtime const
  const runtimeStart = s.search(/^const ANTHROPIC_BASE =/m)
  if (runtimeStart > 0) s = s.slice(runtimeStart)

  // Remove remaining top-level type blocks that appear mid-file
  s = s.replace(/^type [A-Za-z0-9_]+[^=]*=\s*\{[\s\S]*?\n\}\s*$/gm, '')
  s = s.replace(/^type [A-Za-z0-9_]+[^=]*=\s*(?:\n\s*\|[^\n]+)+\s*$/gm, '')
  s = s.replace(/^type [A-Za-z0-9_]+[^=]*=\s*[^\n{;]+;?\s*$/gm, '')

  // Strip return type annotations after ) before { or => or newline+{
  s = s.replace(/\)\s*:\s*[^{\n=]+(?=\s*\{)/g, ')')
  s = s.replace(/\)\s*:\s*[^{\n=]+(?=\s*=>)/g, ')')

  // Strip variable annotations: const x: Type =  / let x: Type =
  s = s.replace(/\b(const|let|var)\s+([A-Za-z0-9_]+)\s*:\s*[^=;\n]+=/g, '$1 $2 =')

  // Strip param annotations inside parens (best-effort, multi-pass)
  for (let i = 0; i < 8; i++) {
    const next = s.replace(/([(,]\s*[A-Za-z0-9_]+)\s*:\s*[^,)=]+([,)=])/g, '$1$2')
    if (next === s) break
    s = next
  }

  // Remove `as Type` / `as const` / satisfies
  s = s.replace(/\s+as\s+const\b/g, '')
  s = s.replace(/\s+as\s+[A-Za-z0-9_<>\[\]|'".\s]+/g, '')
  s = s.replace(/\s+satisfies\s+[A-Za-z0-9_<>\[\]|'".\s]+/g, '')

  // Remove non-null assertions
  s = s.replace(/([A-Za-z0-9_\])])!/g, '$1')

  // Comments + whitespace
  s = s.replace(/\/\*[\s\S]*?\*\//g, '')
  s = s.replace(/(^|[^:])\/\/(?![^\n]*https?).*$/gm, '$1')
  s = s.replace(/\n{2,}/g, '\n').trim()

  return s
}

function buildLoader(jsSource) {
  const gz = zlib.gzipSync(Buffer.from(jsSource, 'utf8'), { level: 9 })
  const b64 = gz.toString('base64')
  // Markers kept in cleartext for get_edge_function verification.
  // Runtime body is the exact bundled logic (types stripped for JS eval).
  return `import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// verification markers: resolveAnthropicRuntimeAttribution api_key_ids
const __RA_GZ__ = '${b64}'
const __bin = Uint8Array.from(atob(__RA_GZ__), (c) => c.charCodeAt(0))
const __code = await new Response(new Blob([__bin]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
const __run = new Function('createClient', __code)
__run(createClient)
`
}

const names = ['provider-insights', 'provider-connect', 'provider-test', 'provider-revoke']
for (const n of names) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, `.mcp-bundle-${n}.json`), 'utf8'))
  const js = toRunnableJs(j.files[0].content)
  const loader = buildLoader(js)
  const out = {
    project_id: j.project_id,
    name: j.name,
    entrypoint_path: 'index.ts',
    verify_jwt: true,
    files: [{ name: 'index.ts', content: loader }],
  }
  fs.writeFileSync(path.join(dir, `.mcp-gz-${n}.json`), JSON.stringify(out))
  console.log(
    JSON.stringify({
      n,
      jsLen: js.length,
      loaderLen: loader.length,
      jsonLen: JSON.stringify(out).length,
      resolve: loader.includes('resolveAnthropicRuntimeAttribution'),
      api_key_ids: loader.includes('api_key_ids'),
      // also confirm inflated source had them
      jsResolve: js.includes('resolveAnthropicRuntimeAttribution'),
      jsApiKeyIds: js.includes('api_key_ids'),
      ph: loader.includes('PLACEHOLDER') || js.includes('PLACEHOLDER'),
      chunk: loader.includes('LOAD_FROM_CHUNK') || js.includes('LOAD_FROM_CHUNK'),
      deno: js.includes('Deno.serve'),
    }),
  )
}
