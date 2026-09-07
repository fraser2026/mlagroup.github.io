import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const base = path.join(root, 'supabase', 'functions')

function stripImportsAndExports(src, { keepExports = false } = {}) {
  let s = src
  // Remove import lines (including multiline type imports)
  s = s.replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*\n/gm, '')
  if (!keepExports) {
    s = s.replace(/^export\s+type\s+\{[\s\S]*?\}\s*from\s+['"][^'"]+['"];?\s*\n/gm, '')
    s = s.replace(/^export\s+(async\s+)?function\s+/gm, '$1function ')
    s = s.replace(/^export\s+function\s+/gm, 'function ')
    s = s.replace(/^export\s+const\s+/gm, 'const ')
    s = s.replace(/^export\s+type\s+/gm, 'type ')
    s = s.replace(/^export\s+\{[\s\S]*?\};?\s*\n/gm, '')
  }
  return s
}

const types = fs.readFileSync(path.join(base, '_shared/providers/types.ts'), 'utf8')
const anthropic = fs.readFileSync(path.join(base, '_shared/providers/anthropic.ts'), 'utf8')
const providersIndex = fs.readFileSync(path.join(base, '_shared/providers/index.ts'), 'utf8')
const connection = fs.readFileSync(path.join(base, '_shared/provider-connection.ts'), 'utf8')

const names = ['provider-insights', 'provider-connect', 'provider-test', 'provider-revoke']

for (const name of names) {
  const entry = fs.readFileSync(path.join(base, name, 'index.ts'), 'utf8')
  // Bundle: types + anthropic + providers index + connection + entry, all local
  const bundled = [
    '// Bundled single-file deploy for MCP size limits',
    stripImportsAndExports(types, { keepExports: false }),
    stripImportsAndExports(anthropic),
    stripImportsAndExports(providersIndex),
    stripImportsAndExports(connection),
    stripImportsAndExports(entry),
  ].join('\n')

  const payload = {
    project_id: 'hueftewwenjaiagdoqmb',
    name,
    entrypoint_path: 'index.ts',
    verify_jwt: true,
    files: [{ name: 'index.ts', content: bundled }],
  }
  const out = path.join(root, 'tools', `.mcp-bundle-${name}.json`)
  fs.writeFileSync(out, JSON.stringify(payload))
  const blob = JSON.stringify(payload)
  console.log(
    name,
    'bytes',
    Buffer.byteLength(blob),
    'chars',
    bundled.length,
    'resolve',
    bundled.includes('resolveAnthropicRuntimeAttribution'),
    'api_key_ids',
    bundled.includes('api_key_ids'),
    'importLeft',
    /^import\s/m.test(bundled),
  )
}
