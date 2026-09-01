/**
 * RegAnchor — Report Generation Edge Function
 *
 * Mints the paid diagnostic PDF via the Puppeteer renderer, uploads to Storage,
 * and returns a signed download URL.
 *
 * Auth gate (required):
 *   1. Caller must present a valid Supabase Auth JWT (portal session).
 *   2. That user must hold an active `premium_report` entitlement for THIS
 *      diagnostic result (`entitlements.diagnostic_id` = `response_id`).
 *
 * Service role is used only after those checks pass (Storage / DB writes).
 * No email delivery, no admin bypass, no anonymous mint.
 *
 * DEPLOY (GitHub Pages merge alone does not update this function):
 *   supabase functions deploy generate-report --project-ref hueftewwenjaiagdoqmb
 * Do NOT pass --no-verify-jwt. config.toml sets verify_jwt = true.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { v4 as uuidv4 } from 'https://esm.sh/uuid@9.0.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RENDERER_URL = Deno.env.get('RENDER_SERVICE_URL')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const ensureObject = (val: unknown) => {
  if (typeof val === 'string') {
    try { return JSON.parse(val) } catch { return val }
  }
  return val
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    // ── 1. Authenticated caller (valid user JWT) ──────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return json({ error: 'Authentication required' }, 401)
    }
    const token = authHeader.slice(7).trim()
    if (!token) return json({ error: 'Authentication required' }, 401)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return json({ error: 'Authentication required' }, 401)
    }

    const body = await req.json().catch(() => ({}))
    const response_id = String(body?.response_id || '').trim()
    if (!UUID_RE.test(response_id)) {
      return json({ error: 'Record not found' }, 404)
    }

    // ── 2. Active entitlement for THIS user + THIS diagnostic ─────────────
    const { data: entitlement, error: entError } = await supabase
      .from('entitlements')
      .select('id')
      .eq('user_id', user.id)
      .eq('diagnostic_id', response_id)
      .eq('product', 'premium_report')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle()

    if (entError) {
      console.error('[generate-report] Entitlement lookup failed:', entError.message)
      return json({ error: 'Entitlement check failed' }, 500)
    }
    if (!entitlement) {
      return json({ error: 'No active entitlement for this diagnostic' }, 403)
    }

    // ── 3. Load diagnostic + mint (service role, after gate) ──────────────
    const { data: response, error: fetchError } = await supabase
      .from('diagnostic_results')
      .select('*')
      .eq('id', response_id)
      .single()

    if (fetchError || !response) {
      return json({ error: 'Record not found' }, 404)
    }

    // Build payload — parse any JSON strings from Supabase
    const payload: Record<string, unknown> = {
      ...response,
      section_scores: ensureObject(response.section_scores),
      raw_scores: ensureObject(response.raw_scores),
      priority_flags: ensureObject(response.priority_flags),
      regime_flags: ensureObject(response.regime_flags),
      selected_categories: ensureObject(response.selected_categories),
    }

    // Compute hash from the normalised payload — ensures PDF and DB always match
    const reportId = uuidv4()
    const generatedAt = new Date().toISOString()
    const encoder = new TextEncoder()
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(payload)))
    const snapshotHash = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16)

    // Add report metadata to payload
    payload._report = {
      id: reportId,
      generated_at: generatedAt,
      snapshot_hash: snapshotHash,
      framework_version: response.framework_version || '2.0.0',
      generator_version: '1.0.0',
    }

    console.log(`[generate-report] user=${user.id} org=${response.organisation} hash=${snapshotHash}`)

    if (!RENDERER_URL) {
      return json({ error: 'RENDER_SERVICE_URL not configured' }, 500)
    }

    // Call Puppeteer renderer
    const renderResponse = await fetch(`${RENDERER_URL}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!renderResponse.ok) {
      throw new Error(`Renderer error: ${renderResponse.status}`)
    }

    const pdfBuffer = await renderResponse.arrayBuffer()

    // Build filename
    const orgSlug = (response.organisation || 'report')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
    const dateSlug = (response.created_at || generatedAt).slice(0, 10)
    const filename = `MLA-Governance-Report_${orgSlug}_${dateSlug}_${snapshotHash}.pdf`
    const storagePath = `reports/${filename}`

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase
      .storage
      .from('governance-reports')
      .upload(storagePath, new Uint8Array(pdfBuffer), {
        contentType: 'application/pdf',
        upsert: true,
      })

    if (uploadError) {
      console.error('[generate-report] Upload error:', uploadError.message)
    }

    // Signed URL — valid 7 days
    const { data: urlData } = await supabase
      .storage
      .from('governance-reports')
      .createSignedUrl(storagePath, 60 * 60 * 24 * 7)

    // Update record with report metadata
    await supabase
      .from('diagnostic_results')
      .update({
        report_generated_at: generatedAt,
        report_storage_path: storagePath,
      })
      .eq('id', response_id)

    // Immutable audit row — mint succeeded; do not fail the download if this write fails
    const frameworkVersion = response.framework_version || '2.0.0'
    const { error: auditError } = await supabase
      .from('report_audit_log')
      .insert({
        response_id,
        report_id: reportId,
        action: 'generated',
        snapshot_hash: snapshotHash,
        generated_at: generatedAt,
        generator_version: '1.0.0',
        framework_version: frameworkVersion,
      })

    if (auditError) {
      console.error('[generate-report] report_audit_log insert failed:', auditError.message)
    }

    return json({
      success: true,
      report_id: reportId,
      snapshot_hash: snapshotHash,
      filename,
      download_url: urlData?.signedUrl || null,
    })

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Report generation failed'
    console.error('[generate-report] Error:', message)
    return json({ error: message }, 500)
  }
})
