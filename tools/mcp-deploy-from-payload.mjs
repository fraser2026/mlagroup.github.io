import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const payloadPath = path.join(root, 'tools', 'provider-insights-deploy-payload.json')
const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'))

const args = {
  project_id: payload.project_id,
  name: payload.name,
  entrypoint_path: payload.entrypoint_path,
  verify_jwt: payload.verify_jwt,
  files: payload.files,
}

const shared = args.files.find((f) => f.name === '_shared/provider-connection.ts')
console.log(
  JSON.stringify({
    ready: true,
    fileCount: args.files.length,
    hasGetServiceClient: shared?.content.includes('getServiceClient') ?? false,
    hasLoadFromChunk: shared?.content.includes('LOAD_FROM_CHUNK') ?? false,
    argsPath: path.join(root, 'tools', 'provider-insights-deploy-args-only.json'),
  }),
)
