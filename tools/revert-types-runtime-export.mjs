import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const typesPath = path.join(root, 'supabase/functions/_shared/providers/types.ts')
const indexPath = path.join(root, 'supabase/functions/_shared/providers/index.ts')

let types = fs.readFileSync(typesPath, 'utf8')
types = types.replace(/^\/\*\* Runtime marker[\s\S]*?\nexport const PROVIDER_TYPES_MODULE = 'provider-types' as const\r?\n\r?\n/, '')
fs.writeFileSync(typesPath, types)

let idx = fs.readFileSync(indexPath, 'utf8')
idx = idx.replace(
  `import {
  PROVIDER_TYPES_MODULE,
  type CredentialSlot,
  type ProviderCapabilityProfile,
  type ProviderGovernanceInsights,
  type ProviderVerifyResult,
} from './types.ts'
`,
  `import type {
  CredentialSlot,
  ProviderCapabilityProfile,
  ProviderGovernanceInsights,
  ProviderVerifyResult,
} from './types.ts'
`,
)
idx = idx.replace(`\nexport { PROVIDER_TYPES_MODULE }\n`, '\n')
fs.writeFileSync(indexPath, idx)

console.log({
  typesHasMarker: fs.readFileSync(typesPath, 'utf8').includes('PROVIDER_TYPES_MODULE'),
  typesHasDiagnostics: fs.readFileSync(typesPath, 'utf8').includes('diagnostics'),
  indexHasMarker: fs.readFileSync(indexPath, 'utf8').includes('PROVIDER_TYPES_MODULE'),
})
