/**
 * RegAnchor — Gateway controls: the models each agent is approved to call, and whether requests for
 * other models are flagged or blocked for the organisation.
 * Organisation owners and admins only; every change is written to the audit log.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  assertOrgAdmin,
  corsHeaders,
  getAuthedUser,
  json,
  parseUuid,
  writeAudit,
} from '../_shared/provider-connection.ts'

const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const MAX_APPROVED = 50

function bad(message: string, status = 400): never {
  throw new Response(JSON.stringify({ ok: false, error: message }), { status })
}

async function loadAgent(supabase: SupabaseClient, orgId: string, assetId: string) {
  const { data } = await supabase
    .from('ai_systems')
    .select('id,org_id,name')
    .eq('id', assetId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!data || data.org_id !== orgId) bad('Agent not found in this organisation.', 404)
  return data as { id: string; org_id: string; name: string }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  try {
    const { user, supabase } = await getAuthedUser(req)
    const body = await req.json().catch(() => ({}))
    const orgId = parseUuid(body.org_id, 'Organisation')
    const action = String(body.action || '').trim().toLowerCase()
    await assertOrgAdmin(supabase, user.id, orgId)

    if (action === 'set_model_action') {
      const value = String(body.value || '')
      if (value !== 'flag' && value !== 'block') bad('Choose whether unapproved models are flagged or blocked.')
      const { data: current } = await supabase
        .from('org_gateway_settings')
        .select('unapproved_model_action')
        .eq('org_id', orgId)
        .maybeSingle()
      const previous = current?.unapproved_model_action || 'flag'
      if (previous === value && current) return json({ ok: true, value })

      const { error } = await supabase
        .from('org_gateway_settings')
        .upsert(
          { org_id: orgId, unapproved_model_action: value, updated_at: new Date().toISOString(), updated_by: user.id },
          { onConflict: 'org_id' },
        )
      if (error) return json({ ok: false, error: 'Could not save the setting.' }, 500)
      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: 'gateway_model_action_changed',
        entity_type: 'organisation',
        entity_id: orgId,
        changes: { unapproved_model_action: { from: previous, to: value } },
      })
      return json({ ok: true, value })
    }

    if (action === 'approve_model') {
      const agent = await loadAgent(supabase, orgId, parseUuid(body.asset_id, 'Agent'))
      const modelId = String(body.model || '').trim()
      if (!MODEL_ID_RE.test(modelId)) bad('Enter a model ID, for example claude-haiku-4-5.')
      const { data: key, error: keyError } = await supabase.rpc('gateway_model_key', { p_model: modelId })
      if (keyError || typeof key !== 'string' || !key) bad('RegAnchor could not read that model ID.')

      const { count } = await supabase
        .from('gateway_approved_models')
        .select('id', { count: 'exact', head: true })
        .eq('asset_id', agent.id)
      if ((count || 0) >= MAX_APPROVED) bad(`An agent can have up to ${MAX_APPROVED} approved models.`)

      const { data, error } = await supabase
        .from('gateway_approved_models')
        .insert({ org_id: orgId, asset_id: agent.id, model_key: key, model_id: modelId, created_by: user.id })
        .select('id,model_key,model_id,created_at')
        .single()
      if (error?.code === '23505') return json({ ok: false, error: 'That model is already approved for this agent.' }, 409)
      if (error || !data) return json({ ok: false, error: 'Could not approve the model.' }, 500)

      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: 'gateway_model_approved',
        entity_type: 'ai_system',
        entity_id: agent.id,
        changes: { _system_name: agent.name, model_id: modelId, model_key: key },
      })
      return json({ ok: true, approved: data })
    }

    if (action === 'remove_model') {
      const agent = await loadAgent(supabase, orgId, parseUuid(body.asset_id, 'Agent'))
      const approvalId = parseUuid(body.approval_id, 'Approved model')
      const { data, error } = await supabase
        .from('gateway_approved_models')
        .delete()
        .eq('id', approvalId)
        .eq('asset_id', agent.id)
        .eq('org_id', orgId)
        .select('model_key,model_id')
        .maybeSingle()
      if (error) return json({ ok: false, error: 'Could not remove the model.' }, 500)
      if (!data) return json({ ok: false, error: 'Approved model not found.' }, 404)

      const { count } = await supabase
        .from('gateway_approved_models')
        .select('id', { count: 'exact', head: true })
        .eq('asset_id', agent.id)
      await writeAudit(supabase, {
        org_id: orgId,
        user_id: user.id,
        action: 'gateway_model_approval_removed',
        entity_type: 'ai_system',
        entity_id: agent.id,
        changes: { _system_name: agent.name, model_id: data.model_id, model_key: data.model_key, remaining: count || 0 },
      })
      return json({ ok: true, remaining: count || 0 })
    }

    return json({ ok: false, error: 'Action must be set_model_action, approve_model or remove_model.' }, 400)
  } catch (error) {
    if (error instanceof Response) {
      const payload = await error.json().catch(() => ({ ok: false, error: 'Request failed.' }))
      return json(payload, error.status)
    }
    return json({ ok: false, error: error instanceof Error ? error.message : 'Request failed.' }, 500)
  }
})
