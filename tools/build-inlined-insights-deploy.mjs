import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('supabase/functions')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')

const anth = read('_shared/providers/anthropic.ts')
const types = read('_shared/providers/types.ts')
const conn = read('_shared/provider-connection.ts')
const index = read('provider-insights/index.ts')

const wrapper = `
export async function fetchProviderGovernanceInsights(
  providerSlug: string,
  adminKey: string,
  windowDays?: number,
) {
  if (providerSlug === 'anthropic') {
    return fetchAnthropicGovernanceInsights(adminKey, windowDays)
  }
  return null
}
`

// providers/index.ts carries anthropic implementation so bundle works even if
// a separate anthropic.ts upload is truncated; anthropic.ts still shipped as real source.
const pindex = anth + wrapper

const files = [
  { name: 'provider-insights/index.ts', content: index },
  { name: '_shared/provider-connection.ts', content: conn },
  { name: '_shared/providers/index.ts', content: pindex },
  { name: '_shared/providers/types.ts', content: types },
  { name: '_shared/providers/anthropic.ts', content: anth },
]

const args = {
  project_id: 'hueftewwenjaiagdoqmb',
  name: 'provider-insights',
  entrypoint_path: 'provider-insights/index.ts',
  verify_jwt: true,
  files,
}

fs.writeFileSync('.mcp-deploy-inlined.json', JSON.stringify(args))
console.log(
  JSON.stringify({
    bytes: Buffer.byteLength(JSON.stringify(args)),
    pindexHasIso: pindex.includes('isoTomorrowUtcMidnight'),
    pindexHasBucket: pindex.includes('bucketWidth'),
    anthHasIso: anth.includes('isoTomorrowUtcMidnight'),
    noImportAnthropic: !pindex.includes("from './anthropic.ts'"),
    sizes: files.map((f) => ({ n: f.name, c: f.content.length })),
  }),
)
