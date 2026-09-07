import fs from 'node:fs'

const a = JSON.parse(fs.readFileSync('.mcp-deploy-call.json', 'utf8'))
const anth = a.files.find((f) => f.name.endsWith('anthropic.ts')).content

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

const files = [
  a.files.find((f) => f.name === 'provider-insights/index.ts'),
  a.files.find((f) => f.name === '_shared/provider-connection.ts'),
  {
    name: '_shared/providers/index.ts',
    content: anth + wrapper,
  },
  a.files.find((f) => f.name === '_shared/providers/types.ts'),
  // Real anthropic.ts so deployed tree matches requested layout + symbol checks
  { name: '_shared/providers/anthropic.ts', content: anth },
]

const args = {
  project_id: 'hueftewwenjaiagdoqmb',
  name: 'provider-insights',
  entrypoint_path: 'provider-insights/index.ts',
  verify_jwt: true,
  files,
}

fs.writeFileSync('.mcp-deploy-resilient.json', JSON.stringify(args))

// Also write a 4-file variant that always bundles even if anthropic.ts upload is dropped
const four = {
  ...args,
  files: files.slice(0, 4),
}
fs.writeFileSync('.mcp-deploy-4file.json', JSON.stringify(four))

console.log(
  JSON.stringify({
    fiveBytes: Buffer.byteLength(JSON.stringify(args)),
    fourBytes: Buffer.byteLength(JSON.stringify(four)),
    fourFiles: four.files.map((f) => ({ n: f.name, c: f.content.length })),
    isoInProvidersIndex: four.files[2].content.includes('isoTomorrowUtcMidnight'),
    bucketInProvidersIndex: four.files[2].content.includes('bucketWidth'),
  }),
)
