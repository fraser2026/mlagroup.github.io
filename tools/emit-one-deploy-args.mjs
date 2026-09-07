#!/usr/bin/env node
/**
 * Emit one MCP deploy_edge_function args object to stdout.
 * Usage: node tools/emit-one-deploy-args.mjs <function-name>
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const name = process.argv[2]
if (!name) {
  console.error('Usage: node tools/emit-one-deploy-args.mjs <function-name>')
  process.exit(1)
}

const payloadPath = path.join(root, '.deploy-payloads', 'mcp-ready', `${name}.json`)
const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'))
process.stdout.write(JSON.stringify(payload))
