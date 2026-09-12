/**
 * RegAnchor — Organisation environment (API keys + secret/plain variables).
 * Secrets go to Supabase Vault via SECURITY DEFINER RPCs. Never returned to clients.
 */
import { createClient, type SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const NAME_RE = /^[A-Z][A-Z0-9_]*$/

const PRESET_KEYS = new Set([
  'OPENAI_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'ANTHROPIC_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_CLOUD_API_KEY',
])

async function getServiceClient(): Promise<SupabaseClient> {
  return createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  )
}

async function getAuthedUser(req: Request): Promise<{ user: User; supabase: SupabaseClient }> {
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw json({ ok: false, error: 'Sign in required.' }, 401)

  const supabase = await getServiceClient()
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) throw json({ ok: false, error: 'Sign in required.' }, 401)
  return { user, supabase }
}

function parseUuid(value: unknown, label: string): string {
  const id = String(value || '').trim()
  if (!UUID_RE.test(id)) throw json({ ok: false, error: `${label} is required.` }, 400)
  return id
}

function normalizeName(raw: unknown): string {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
}

async function assertOrgAdmin(supabase: SupabaseClient, userId: string, orgId: string) {
  const { data } = await supabase
    .from('org_members')
    .select('role')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (!data || !['owner', 'admin'].includes(data.role)) {
    throw json({ ok: false, error: 'Only organisation owners and admins can manage API keys and variables.' }, 403)
  }
}

async function assertOrgMember(supabase: SupabaseClient, userId: string, orgId: string) {
  const { data } = await supabase
    .from('org_members')
    .select('role')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle()

  if (!data) throw json({ ok: false, error: 'Access denied.' }, 403)
}

function publicRow(row: Record<string, unknown>) {
  const kind = String(row.kind || '')
  const hasSecret = Boolean(row.secret_id)
  return {
    id: row.id,
    org_id: row.org_id,
    kind,
    name: row.name,
    preset_key: row.preset_key || null,
    has_value: kind === 'plain' ? Boolean(String(row.value_plain || '').length) : hasSecret,
    value: kind === 'plain' ? (row.value_plain as string | null) || '' : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

async function writeAudit(
  supabase: SupabaseClient,
  payload: {
    org_id: string
    user_id: string
    action: string
    entity_id: string
    changes: Record<string, unknown>
  },
) {
  await supabase.from('registry_audit_log').insert({
    org_id: payload.org_id,
    user_id: payload.user_id,
    action: payload.action,
    entity_type: 'organisation',
    entity_id: payload.entity_id,
    changes: payload.changes,
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  try {
    const { user, supabase } = await getAuthedUser(req)
    const body = await req.json().catch(() => ({}))
    const action = String(body.action || '').trim()
    const orgId = parseUuid(body.org_id, 'Organisation')

    if (action === 'list') {
      await assertOrgMember(supabase, user.id, orgId)
      const { data, error } = await supabase
        .from('org_env_variables')
        .select('id,org_id,kind,name,preset_key,value_plain,secret_id,created_at,updated_at')
        .eq('org_id', orgId)
        .order('name')
      if (error) throw json({ ok: false, error: error.message }, 400)
      return json({
        ok: true,
        variables: (data || []).map((r) => publicRow(r as Record<string, unknown>)),
      })
    }

    await assertOrgAdmin(supabase, user.id, orgId)

    if (action === 'upsert_preset') {
      const name = normalizeName(body.name || body.preset_key)
      const value = String(body.value || '').trim()
      if (!PRESET_KEYS.has(name)) return json({ ok: false, error: 'Unknown preset key.' }, 400)
      if (!value) return json({ ok: false, error: 'Value is required.' }, 400)

      const { data: existing } = await supabase
        .from('org_env_variables')
        .select('id')
        .eq('org_id', orgId)
        .eq('preset_key', name)
        .maybeSingle()

      let id = existing?.id as string | undefined
      if (!id) {
        const { data: created, error } = await supabase
          .from('org_env_variables')
          .insert({
            org_id: orgId,
            kind: 'preset',
            name,
            preset_key: name,
            created_by: user.id,
            updated_by: user.id,
          })
          .select('id')
          .single()
        if (error || !created) throw json({ ok: false, error: error?.message || 'Could not create preset.' }, 400)
        id = created.id
      } else {
        await supabase
          .from('org_env_variables')
          .update({ updated_by: user.id, updated_at: new Date().toISOString() })
          .eq('id', id)
      }

      const { error: storeErr } = await supabase.rpc('org_env_store_secret', {
        p_variable_id: id,
        p_secret: value,
      })
      if (storeErr) throw json({ ok: false, error: storeErr.message }, 400)

      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: 'org_env_preset_upserted',
        entity_id: orgId,
        changes: { name, variable_id: id },
      })

      const { data: row } = await supabase.from('org_env_variables').select('*').eq('id', id).single()
      return json({ ok: true, variable: publicRow((row || {}) as Record<string, unknown>) })
    }

    if (action === 'upsert_variable') {
      const kind = String(body.kind || '').trim()
      if (kind !== 'secret' && kind !== 'plain') {
        return json({ ok: false, error: 'Kind must be secret or plain.' }, 400)
      }
      const name = normalizeName(body.name)
      const value = String(body.value || '')
      const variableId = body.variable_id ? parseUuid(body.variable_id, 'Variable') : null

      if (!NAME_RE.test(name)) {
        return json({ ok: false, error: 'Name must be UPPER_SNAKE_CASE (A-Z, 0-9, underscore).' }, 400)
      }
      if (PRESET_KEYS.has(name)) {
        return json({ ok: false, error: 'That name is reserved for a pre-defined API key.' }, 400)
      }
      if (!value.trim()) return json({ ok: false, error: 'Value is required.' }, 400)

      if (variableId) {
        const { data: existing, error } = await supabase
          .from('org_env_variables')
          .select('*')
          .eq('id', variableId)
          .eq('org_id', orgId)
          .single()
        if (error || !existing) return json({ ok: false, error: 'Variable not found.' }, 404)
        if (existing.kind !== kind) {
          return json({ ok: false, error: 'Cannot change variable kind after create.' }, 400)
        }

        if (kind === 'plain') {
          const { error: upErr } = await supabase
            .from('org_env_variables')
            .update({
              name,
              value_plain: value,
              updated_by: user.id,
              updated_at: new Date().toISOString(),
            })
            .eq('id', variableId)
          if (upErr) throw json({ ok: false, error: upErr.message }, 400)
        } else {
          const { error: upErr } = await supabase
            .from('org_env_variables')
            .update({
              name,
              updated_by: user.id,
              updated_at: new Date().toISOString(),
            })
            .eq('id', variableId)
          if (upErr) throw json({ ok: false, error: upErr.message }, 400)
          const { error: storeErr } = await supabase.rpc('org_env_store_secret', {
            p_variable_id: variableId,
            p_secret: value.trim(),
          })
          if (storeErr) throw json({ ok: false, error: storeErr.message }, 400)
        }

        await writeAudit(supabase, {
          org_id: orgId,
          user_id: user.id,
          action: 'org_env_variable_updated',
          entity_id: orgId,
          changes: { name, kind, variable_id: variableId },
        })

        const { data: row } = await supabase.from('org_env_variables').select('*').eq('id', variableId).single()
        return json({ ok: true, variable: publicRow((row || {}) as Record<string, unknown>) })
      }

      const insertPayload =
        kind === 'plain'
          ? {
              org_id: orgId,
              kind,
              name,
              value_plain: value,
              created_by: user.id,
              updated_by: user.id,
            }
          : {
              org_id: orgId,
              kind,
              name,
              created_by: user.id,
              updated_by: user.id,
            }

      const { data: created, error } = await supabase
        .from('org_env_variables')
        .insert(insertPayload)
        .select('*')
        .single()
      if (error || !created) throw json({ ok: false, error: error?.message || 'Could not create variable.' }, 400)

      if (kind === 'secret') {
        const { error: storeErr } = await supabase.rpc('org_env_store_secret', {
          p_variable_id: created.id,
          p_secret: value.trim(),
        })
        if (storeErr) {
          await supabase.from('org_env_variables').delete().eq('id', created.id)
          throw json({ ok: false, error: storeErr.message }, 400)
        }
      }

      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: 'org_env_variable_created',
        entity_id: orgId,
        changes: { name, kind, variable_id: created.id },
      })

      const { data: row } = await supabase.from('org_env_variables').select('*').eq('id', created.id).single()
      return json({ ok: true, variable: publicRow((row || {}) as Record<string, unknown>) })
    }

    if (action === 'delete') {
      const variableId = parseUuid(body.variable_id, 'Variable')
      const { data: existing, error } = await supabase
        .from('org_env_variables')
        .select('*')
        .eq('id', variableId)
        .eq('org_id', orgId)
        .single()
      if (error || !existing) return json({ ok: false, error: 'Variable not found.' }, 404)

      if (existing.kind === 'preset' || existing.kind === 'secret') {
        await supabase.rpc('org_env_delete_secret', { p_variable_id: variableId })
      }

      if (existing.kind === 'preset') {
        await supabase.from('org_env_variables').delete().eq('id', variableId)
      } else {
        await supabase.from('org_env_variables').delete().eq('id', variableId)
      }

      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: 'org_env_variable_deleted',
        entity_id: orgId,
        changes: { name: existing.name, kind: existing.kind, variable_id: variableId },
      })

      return json({ ok: true })
    }

    if (action === 'clear_preset') {
      const name = normalizeName(body.name || body.preset_key)
      if (!PRESET_KEYS.has(name)) return json({ ok: false, error: 'Unknown preset key.' }, 400)
      const { data: existing } = await supabase
        .from('org_env_variables')
        .select('id')
        .eq('org_id', orgId)
        .eq('preset_key', name)
        .maybeSingle()
      if (!existing) return json({ ok: true })
      await supabase.rpc('org_env_delete_secret', { p_variable_id: existing.id })
      await supabase.from('org_env_variables').delete().eq('id', existing.id)
      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: 'org_env_preset_cleared',
        entity_id: orgId,
        changes: { name, variable_id: existing.id },
      })
      return json({ ok: true })
    }

    return json({ ok: false, error: 'Unknown action.' }, 400)
  } catch (e) {
    if (e instanceof Response) return e
    return json({ ok: false, error: e instanceof Error ? e.message : 'Request failed.' }, 500)
  }
})
