/**
 * RegAnchor — Captured gateway content, read on demand.
 * Organisation owners and admins only; every read is written to the asset audit log.
 */
import {
  assertOrgAdmin,
  corsHeaders,
  getAuthedUser,
  json,
  parseUuid,
  writeAudit,
} from '../_shared/provider-connection.ts'

const CONTENT_BUCKET = 'gateway-content'

async function gunzip(file: Blob): Promise<string> {
  return await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text()
}

function textFromSse(sse: string): string {
  let text = ''
  for (const block of sse.split(/\r?\n\r?\n/)) {
    const line = block.split(/\r?\n/).find((l) => l.startsWith('data:'))
    if (!line) continue
    try {
      const event = JSON.parse(line.slice(5).trim()) as { type?: string; delta?: { type?: string; text?: string } }
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') text += event.delta.text || ''
    } catch {
      // ignore partial or non-JSON lines
    }
  }
  return text
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  try {
    const { user, supabase } = await getAuthedUser(req)
    const body = await req.json().catch(() => ({}))
    const eventId = parseUuid(body.event_id, 'Request')

    const { data: event, error } = await supabase
      .from('gateway_request_events')
      .select('id,org_id,asset_id,created_at,content_captured,content_path')
      .eq('id', eventId)
      .maybeSingle()
    if (error) return json({ ok: false, error: error.message }, 500)
    if (!event) return json({ ok: false, error: 'Request not found.' }, 404)

    await assertOrgAdmin(supabase, user.id, event.org_id)

    if (!event.content_captured || !event.content_path) {
      return json({ ok: false, error: 'Content was not captured for this request.' }, 404)
    }

    const { data: settings } = await supabase
      .from('org_gateway_settings')
      .select('content_retention_days')
      .eq('org_id', event.org_id)
      .maybeSingle()
    const retentionDays = Number(settings?.content_retention_days || 30)
    if (Date.now() - new Date(event.created_at).getTime() > retentionDays * 86_400_000) {
      return json({ ok: false, error: `Captured content is kept for ${retentionDays} days and has expired.` }, 410)
    }

    const { data: file, error: downloadError } = await supabase.storage
      .from(CONTENT_BUCKET)
      .download(event.content_path)
    if (downloadError || !file) {
      return json({ ok: false, error: 'Captured content is no longer available.' }, 404)
    }

    const document = JSON.parse(await gunzip(file)) as {
      captured_at?: string
      streamed?: boolean
      request?: unknown
      response?: unknown
    }

    const { data: asset } = await supabase.from('ai_systems').select('name').eq('id', event.asset_id).maybeSingle()
    await writeAudit(supabase, {
      org_id: event.org_id,
      user_id: user.id,
      action: 'gateway_content_viewed',
      entity_id: event.asset_id,
      changes: { _system_name: asset?.name || 'an AI asset', event_id: event.id },
    })

    const sse =
      document.streamed && document.response && typeof document.response === 'object'
        ? String((document.response as { sse?: unknown }).sse || '')
        : ''

    return json({
      ok: true,
      captured_at: document.captured_at || null,
      streamed: !!document.streamed,
      request: document.request ?? null,
      response: document.streamed ? null : document.response ?? null,
      response_text: document.streamed ? textFromSse(sse) : null,
    })
  } catch (error) {
    if (error instanceof Response) {
      const payload = await error.json().catch(() => ({ ok: false, error: 'Request failed.' }))
      return json(payload, error.status)
    }
    return json({ ok: false, error: error instanceof Error ? error.message : 'Request failed.' }, 500)
  }
})
