/**
 * get-buy-context — public lookup for buy-report.html
 *
 * Returns only the fields needed to mount embedded checkout for a diagnostic
 * UUID (organisation, respondent name/email, paid). Uses the service role so
 * the browser never selects scores, flags, or raw answers.
 *
 * verify_jwt: false — public page, same as create-checkout-session / send-mail.
 *
 * DEPLOY: this repo is not the live source of truth for purchase functions.
 * Deploy to project hueftewwenjaiagdoqmb before buy-report.html can rely on it:
 *   supabase functions deploy get-buy-context --no-verify-jwt --project-ref hueftewwenjaiagdoqmb
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
    const body = await req.json().catch(() => ({}))
    const resultId = String(body?.result_id || body?.rid || '').trim()
    if (!UUID_RE.test(resultId)) {
      return json({ error: 'not_found' }, 404)
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data, error } = await supabase
      .from('diagnostic_results')
      .select('id, organisation, respondent_name, respondent_email')
      .eq('id', resultId)
      .maybeSingle()

    if (error) {
      console.error('[get-buy-context]', error.message)
      return json({ error: 'lookup_failed' }, 500)
    }
    if (!data) return json({ error: 'not_found' }, 404)

    const { data: entitlements } = await supabase
      .from('entitlements')
      .select('id')
      .eq('diagnostic_id', resultId)
      .eq('status', 'active')
      .limit(1)

    return json({
      result_id: data.id,
      organisation: data.organisation || '',
      respondent_name: data.respondent_name || '',
      respondent_email: data.respondent_email || '',
      paid: !!(entitlements && entitlements.length > 0),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'lookup_failed'
    console.error('[get-buy-context]', message)
    return json({ error: 'lookup_failed' }, 500)
  }
})
