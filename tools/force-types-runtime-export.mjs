import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const typesPath = path.join(root, 'supabase/functions/_shared/providers/types.ts')
const indexPath = path.join(root, 'supabase/functions/_shared/providers/index.ts')

let types = fs.readFileSync(typesPath, 'utf8')
if (!types.includes('PROVIDER_TYPES_MODULE')) {
  types =
    "/** Runtime marker so this module is retained in edge-function source bundles. */\n" +
    "export const PROVIDER_TYPES_MODULE = 'provider-types' as const\n\n" +
    types
  fs.writeFileSync(typesPath, types)
}

let idx = fs.readFileSync(indexPath, 'utf8')
if (!idx.includes('PROVIDER_TYPES_MODULE')) {
  idx = idx.replace(
    "import type {\n  CredentialSlot,\n  ProviderCapabilityProfile,\n  ProviderGovernanceInsights,\n  ProviderVerifyResult,\n} from './types.ts'\n",
    "import {\n  PROVIDER_TYPES_MODULE,\n  type CredentialSlot,\n  type ProviderCapabilityProfile,\n  type ProviderGovernanceInsights,\n  type ProviderVerifyResult,\n} from './types.ts'\n",
  )
  idx = idx.replace(
    "} from './types.ts'\n\nexport async function verifyProviderCredential",
    "} from './types.ts'\n\nexport { PROVIDER_TYPES_MODULE }\n\nexport async function verifyProviderCredential",
  )
  fs.writeFileSync(indexPath, idx)
}

console.log({
  typesHasMarker: fs.readFileSync(typesPath, 'utf8').includes('PROVIDER_TYPES_MODULE'),
  typesHasDiagnostics: fs.readFileSync(typesPath, 'utf8').includes('diagnostics'),
  indexHasMarker: fs.readFileSync(indexPath, 'utf8').includes('PROVIDER_TYPES_MODULE'),
})
