#!/usr/bin/env node

const DEFAULT_SUPABASE_URL = 'https://hueftewwenjaiagdoqmb.supabase.co'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const COMMANDS = {
  connect: {
    required: ['asset', 'provider', 'key'],
    allowed: ['asset', 'provider', 'key'],
  },
  check: {
    required: ['asset'],
    allowed: ['asset'],
  },
  smoke: {
    required: ['asset'],
    allowed: ['asset'],
  },
  insights: {
    required: ['asset'],
    allowed: ['asset', 'days'],
  },
}

function usage() {
  return `RegAnchor developer CLI

Usage:
  ra connect --asset <uuid> --provider anthropic --key <runtime-key>
  ra check --asset <uuid>
  ra smoke --asset <uuid>
  ra insights --asset <uuid> [--days 30]

Environment:
  REGANCHOR_ANON_KEY       Supabase anon/publishable key
  REGANCHOR_ACCESS_TOKEN   Signed-in user's Supabase access token
  REGANCHOR_SUPABASE_URL   Functions project URL (optional)
  REGANCHOR_URL            Compatibility fallback for the project URL

REGANCHOR_SUPABASE_URL defaults to ${DEFAULT_SUPABASE_URL}.`
}

function fail(message, showUsage = false) {
  const error = new Error(message)
  error.showUsage = showUsage
  throw error
}

function parseArgs(argv) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    return { help: true }
  }

  const command = argv[0]
  const schema = COMMANDS[command]
  if (!schema) fail(`Unknown command: ${command}`, true)

  const options = {}
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) fail(`Unexpected argument: ${token}`, true)
    const name = token.slice(2)
    if (!schema.allowed.includes(name)) fail(`Unknown option for ${command}: --${name}`, true)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) fail(`Missing value for --${name}`, true)
    options[name] = value
    index += 1
  }

  for (const name of schema.required) {
    if (!options[name]) fail(`Missing required option: --${name}`, true)
  }
  if (!UUID_PATTERN.test(options.asset)) fail('--asset must be a valid UUID.')
  if (options.days !== undefined) {
    const days = Number(options.days)
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      fail('--days must be an integer from 1 to 90.')
    }
    options.days = days
  }

  return { command, options }
}

function configFromEnv(env) {
  const anonKey = String(env.REGANCHOR_ANON_KEY || '').trim()
  const accessToken = String(env.REGANCHOR_ACCESS_TOKEN || '').trim()
  const projectUrl = String(
    env.REGANCHOR_SUPABASE_URL || env.REGANCHOR_URL || DEFAULT_SUPABASE_URL,
  ).trim().replace(/\/+$/, '')

  if (!anonKey) fail('REGANCHOR_ANON_KEY is required.')
  if (!accessToken) fail('REGANCHOR_ACCESS_TOKEN is required.')
  try {
    new URL(projectUrl)
  } catch {
    fail('REGANCHOR_SUPABASE_URL (or REGANCHOR_URL) must be a valid URL.')
  }

  return { anonKey, accessToken, projectUrl }
}

async function invokeFunction(name, body, config) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  let response

  try {
    response = await fetch(`${config.projectUrl}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.anonKey,
        Authorization: `Bearer ${config.accessToken}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    if (error && error.name === 'AbortError') {
      fail(`Request to ${name} timed out after 30 seconds.`)
    }
    fail(`Could not reach RegAnchor: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
  }

  const text = await response.text()
  let payload = {}
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { error: text }
    }
  }

  if (!response.ok || payload.ok === false) {
    const detail = payload.error || payload.message || response.statusText || 'Request failed.'
    fail(`${name} failed (${response.status}): ${detail}`)
  }
  return payload
}

function printResult(command, payload, options) {
  if (command === 'connect') {
    console.log(`Connected ${options.provider} runtime key to asset ${options.asset}.`)
    if (payload.governance_tier) console.log(`Governance tier: ${payload.governance_tier}`)
    return
  }
  if (command === 'check') {
    console.log(`Provider connection is live for asset ${options.asset}.`)
    if (payload.governance_tier) console.log(`Governance tier: ${payload.governance_tier}`)
    return
  }
  if (command === 'smoke') {
    console.log(`Provider connection is live for asset ${options.asset}.`)
    console.log('Smoke currently runs the RegAnchor live credential and capability check.')
    console.log('Next: send a tiny Messages request from your app with the same runtime key, then run "ra insights".')
    return
  }

  console.log(`Refreshed ${options.days || 30}-day insights for asset ${options.asset}.`)
  if (payload.insights) console.log(JSON.stringify(payload.insights, null, 2))
}

export async function run(argv = process.argv.slice(2), env = process.env) {
  const parsed = parseArgs(argv)
  if (parsed.help) {
    console.log(usage())
    return
  }

  const config = configFromEnv(env)
  const { command, options } = parsed
  let functionName
  let body

  if (command === 'connect') {
    functionName = 'provider-connect'
    body = {
      asset_id: options.asset,
      provider_slug: options.provider,
      api_key: options.key,
      credential_slot: 'api',
    }
  } else if (command === 'insights') {
    functionName = 'provider-insights'
    body = {
      asset_id: options.asset,
      window_days: options.days || 30,
    }
  } else {
    functionName = 'provider-test'
    body = {
      asset_id: options.asset,
      probe_all: true,
    }
  }

  const payload = await invokeFunction(functionName, body, config)
  printResult(command, payload, options)
}

const isEntrypoint = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href
if (isEntrypoint) {
  run().catch((error) => {
    console.error(`Error: ${error.message}`)
    if (error.showUsage) console.error(`\n${usage()}`)
    process.exitCode = 1
  })
}
