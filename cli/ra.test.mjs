import assert from 'node:assert/strict'
import test from 'node:test'
import { run } from './ra.mjs'

const ASSET_ID = '123e4567-e89b-42d3-a456-426614174000'
const ENV = {
  REGANCHOR_ANON_KEY: 'anon-key',
  REGANCHOR_ACCESS_TOKEN: 'user-jwt',
  REGANCHOR_SUPABASE_URL: 'https://example.supabase.co',
}

async function captureRequest(args, payload = { ok: true }) {
  const originalFetch = globalThis.fetch
  const originalLog = console.log
  let request
  console.log = () => {}
  globalThis.fetch = async (url, init) => {
    request = { url, init }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    await run(args, ENV)
  } finally {
    globalThis.fetch = originalFetch
    console.log = originalLog
  }
  return request
}

test('connect sends the runtime key to provider-connect', async () => {
  const request = await captureRequest([
    'connect',
    '--asset', ASSET_ID,
    '--provider', 'anthropic',
    '--key', 'sk-ant-test',
  ])

  assert.equal(request.url, 'https://example.supabase.co/functions/v1/provider-connect')
  assert.equal(request.init.headers.apikey, 'anon-key')
  assert.equal(request.init.headers.Authorization, 'Bearer user-jwt')
  assert.deepEqual(JSON.parse(request.init.body), {
    asset_id: ASSET_ID,
    provider_slug: 'anthropic',
    api_key: 'sk-ant-test',
    credential_slot: 'api',
  })
})

test('check and smoke use the probe_all provider test', async () => {
  for (const command of ['check', 'smoke']) {
    const request = await captureRequest([command, '--asset', ASSET_ID])
    assert.equal(request.url, 'https://example.supabase.co/functions/v1/provider-test')
    assert.deepEqual(JSON.parse(request.init.body), {
      asset_id: ASSET_ID,
      probe_all: true,
    })
  }
})

test('insights sends a bounded day window', async () => {
  const request = await captureRequest([
    'insights',
    '--asset', ASSET_ID,
    '--days', '7',
  ], { ok: true, insights: {} })

  assert.equal(request.url, 'https://example.supabase.co/functions/v1/provider-insights')
  assert.deepEqual(JSON.parse(request.init.body), {
    asset_id: ASSET_ID,
    window_days: 7,
  })
})

test('invalid asset IDs fail before a request', async () => {
  await assert.rejects(
    run(['check', '--asset', 'not-a-uuid'], ENV),
    /--asset must be a valid UUID/,
  )
})
