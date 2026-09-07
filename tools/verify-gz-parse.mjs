import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)))

function extractJs(loader) {
  const m = loader.match(/const __RA_GZ__ = '([^']+)'/)
  if (!m) throw new Error('no gz')
  const bin = Buffer.from(m[1], 'base64')
  return zlib.gunzipSync(bin).toString('utf8')
}

for (const n of ['provider-insights', 'provider-connect', 'provider-test', 'provider-revoke']) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, `.mcp-gz-${n}.json`), 'utf8'))
  const js = extractJs(j.files[0].content)
  let parseOk = false
  let err = null
  try {
    // Parse only — do not execute Deno.serve
    new vm.Script(js, { filename: n + '.js' })
    parseOk = true
  } catch (e) {
    err = String(e && e.message ? e.message : e)
  }
  console.log(JSON.stringify({ n, parseOk, err, hasDeno: js.includes('Deno.serve'), len: js.length }))
}
