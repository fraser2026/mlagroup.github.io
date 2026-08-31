/**
 * RegAnchor outbound mail — Resend from info@reganchor.com.
 *
 * verify_jwt is OFF at the gateway because public contact / demo / enterprise
 * and diagnostic forms have no user JWT (same pattern as create-checkout-session).
 * Sending is locked down here instead:
 *   - From is always RegAnchor <info@reganchor.com>
 *   - kind is an allowlist; client cannot set From
 *   - ops kinds (contact, demo, enterprise, diagnostic-lead): To always info@;
 *     reply-To is the form email; any client `to` is ignored
 *   - diagnostic-ack: To comes from diagnostic_results.respondent_email for the
 *     given result_id (service role lookup); client To/email is not the destination
 *   - portal-alert: requires a real user JWT; To = that user's email
 *   - admin-reply: requires a real user JWT whose profiles.role is mla_admin;
 *     To may be the client to_email (admin → customer path)
 *   - HTML is generated server-side from escaped values; client HTML is ignored
 *
 * DEPLOY (after merge — Pages does not ship Edge Functions):
 *   supabase functions deploy send-mail --no-verify-jwt --project-ref hueftewwenjaiagdoqmb
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const FROM = 'RegAnchor <info@reganchor.com>'
const OPS = 'info@reganchor.com'
const BUY_REPORT_BASE = 'https://reganchor.com/buy-report.html'
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/

type Kind =
  | 'contact'
  | 'diagnostic-ack'
  | 'diagnostic-lead'
  | 'demo'
  | 'enterprise'
  | 'portal-alert'
  | 'admin-reply'

const KINDS: Kind[] = [
  'contact',
  'diagnostic-ack',
  'diagnostic-lead',
  'demo',
  'enterprise',
  'portal-alert',
  'admin-reply',
]

const OPS_KINDS: Kind[] = ['contact', 'demo', 'enterprise', 'diagnostic-lead']

type Row = { label: string; value: string }

function clip(v: unknown, n = 2000): string {
  if (v == null) return ''
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n)
}

function emailOk(v: string): boolean {
  return EMAIL_RE.test(v) && v.length <= 254 && !v.includes('..')
}

function fmt(v: unknown, n = 4000): string {
  if (v == null) return ''
  if (Array.isArray(v)) {
    return v
      .map((x) => {
        if (x == null) return ''
        if (typeof x === 'object') return clip(JSON.stringify(x), 400)
        return clip(x, 400)
      })
      .filter(Boolean)
      .join(', ')
  }
  if (typeof v === 'object') return clip(JSON.stringify(v), n)
  return clip(v, n)
}

function humanKey(k: string): string {
  return k
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function pick(body: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = fmt(body[k])
    if (v) return v
  }
  return ''
}

function fieldRows(body: Record<string, unknown>, known: [string, string[]][]): Row[] {
  const used = new Set<string>(['kind', 'to', 'to_email', 'html', 'text', 'from'])
  const rows: Row[] = []
  for (const [label, keys] of known) {
    for (const k of keys) used.add(k)
    const value = pick(body, keys)
    rows.push({ label, value: value || '—' })
  }
  for (const [k, v] of Object.entries(body)) {
    if (used.has(k)) continue
    const value = fmt(v)
    if (!value) continue
    rows.push({ label: humanKey(k), value })
  }
  return rows
}

function rowsText(rows: Row[]): string {
  return rows.map((r) => `${r.label}: ${r.value}`).join('\n')
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function nl2br(s: string): string {
  return esc(s).replace(/\r\n|\n|\r/g, '<br>')
}

function shell(title: string, inner: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${esc(title)}</title>
</head>
<body style="margin-top:0;margin-right:0;margin-bottom:0;margin-left:0;background-color:#F6F9FC;" bgcolor="#F6F9FC">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F6F9FC" style="background-color:#F6F9FC;">
  <tr>
    <td align="center" style="padding-top:32px;padding-bottom:32px;padding-left:16px;padding-right:16px;">
      <!--[if mso]>
      <table width="600" cellpadding="0" cellspacing="0" border="0"><tr><td>
      <![endif]-->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#FFFFFF;" bgcolor="#FFFFFF">
        <tr>
          <td bgcolor="#533AFD" style="background-color:#533AFD;height:4px;font-size:0;line-height:0;">&nbsp;</td>
        </tr>
        <tr>
          <td style="padding-top:28px;padding-right:32px;padding-bottom:8px;padding-left:32px;">
            <a href="https://reganchor.com"><img src="https://reganchor.com/brand/wordmark-text.png" width="193" height="36" alt="RegAnchor" style="display:block;border:0;outline:none;text-decoration:none;width:193px;height:36px;"></a>
          </td>
        </tr>
        <tr>
          <td style="padding-top:8px;padding-right:32px;padding-bottom:32px;padding-left:32px;">
            ${inner}
          </td>
        </tr>
        <tr>
          <td style="padding-top:16px;padding-right:32px;padding-bottom:24px;padding-left:32px;border-top-width:1px;border-top-style:solid;border-top-color:#E4E7EC;">
            <p style="margin-top:0;margin-bottom:4px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#6B7280;">MLA Group Ltd · Companies House 16117562</p>
            <p style="margin-top:0;margin-bottom:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#6B7280;"><a href="mailto:info@reganchor.com" style="color:#533AFD;text-decoration:none;">info@reganchor.com</a></p>
          </td>
        </tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>
</body>
</HTML>`
}

function fieldTable(rows: Row[]): string {
  const trs = rows
    .map(
      (r) => `
    <tr>
      <td valign="top" style="padding-top:8px;padding-bottom:8px;padding-right:16px;width:160px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#6B7280;">${esc(r.label)}</td>
      <td valign="top" style="padding-top:8px;padding-bottom:8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#0A0E14;">${nl2br(r.value)}</td>
    </tr>`,
    )
    .join('')
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0">${trs}</table>`
}

function h1(t: string): string {
  return `<h1 style="margin-top:0;margin-bottom:16px;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:1.3;color:#0A0E14;font-weight:bold;">${esc(t)}</h1>`
}

function para(t: string): string {
  return `<p style="margin-top:0;margin-bottom:16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#0A0E14;">${esc(t)}</p>`
}

function cta(href: string, label: string): string {
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;margin-bottom:8px;">
  <tr>
    <td bgcolor="#533AFD" style="background-color:#533AFD;border-radius:4px;">
      <a href="${esc(href)}" style="display:inline-block;padding-top:12px;padding-bottom:12px;padding-left:24px;padding-right:24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#FFFFFF;text-decoration:none;font-weight:bold;">${esc(label)}</a>
    </td>
  </tr>
</table>`
}

function quietContext(org: string, band: string): string {
  const bits = [org, band].filter(Boolean)
  if (!bits.length) return ''
  return `<p style="margin-top:0;margin-bottom:16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#0A0E14;">${esc(bits.join(' · '))}</p>`
}

function buyUrl(resultId: string): string {
  return `${BUY_REPORT_BASE}?rid=${encodeURIComponent(resultId)}`
}

function opsMail(heading: string, rows: Row[]) {
  return {
    text: `${heading}\n\n${rowsText(rows)}`,
    html: shell(heading, h1(heading) + fieldTable(rows)),
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  )
}

async function requireUser(req: Request) {
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { error: json({ error: 'Sign in required' }, 401) }
  const supabase = serviceClient()
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return { error: json({ error: 'Sign in required' }, 401) }
  return { user, supabase }
}

function formEmail(body: Record<string, unknown>): string {
  return clip(body.email || body.to_email, 254).toLowerCase()
}

function buildOps(kind: Kind, body: Record<string, unknown>) {
  const name = clip(body.name || body.client_name || body.to_name, 120)
  const email = formEmail(body)
  const company = clip(body.company || body.organisation || body.organization, 200)

  switch (kind) {
    case 'contact': {
      if (!emailOk(email)) throw new Error('Valid email is required')
      const rows = fieldRows(body, [
        ['First name', ['first']],
        ['Last name', ['last']],
        ['Name', ['name', 'client_name', 'to_name']],
        ['Email', ['email', 'to_email']],
        ['Phone', ['phone']],
        ['Organisation', ['organisation', 'organization', 'company']],
        ['Role', ['role', 'client_role']],
        ['Sector', ['sector']],
        ['Interests', ['interests']],
        ['Message', ['message']],
      ])
      const built = opsMail('New contact enquiry', rows)
      return {
        to: OPS,
        replyTo: email,
        subject: `Contact: ${name || email}${company ? ' - ' + company : ''}`,
        ...built,
      }
    }
    case 'demo': {
      if (!emailOk(email)) throw new Error('Valid email is required')
      const first = clip(body.first, 80)
      const last = clip(body.last, 80)
      const who = [first, last].filter(Boolean).join(' ') || name
      const rows = fieldRows(body, [
        ['First name', ['first']],
        ['Last name', ['last']],
        ['Name', ['name']],
        ['Email', ['email']],
        ['Phone', ['phone']],
        ['Company', ['company', 'organisation', 'organization']],
        ['Industry', ['industry']],
        ['Message', ['message', 'note']],
      ])
      const built = opsMail('New demo request', rows)
      return {
        to: OPS,
        replyTo: email,
        subject: `Demo request: ${company || who || email}`,
        ...built,
      }
    }
    case 'enterprise': {
      if (!emailOk(email)) throw new Error('Valid email is required')
      const rows = fieldRows(body, [
        ['Name', ['name']],
        ['Role', ['role']],
        ['Email', ['email']],
        ['Organisation', ['organisation', 'organization', 'company']],
        ['AI systems', ['systems', 'system_count']],
        ['Requirements', ['requirements']],
        ['Message', ['message']],
      ])
      const built = opsMail('New enterprise inquiry', rows)
      return {
        to: OPS,
        replyTo: email,
        subject: `Enterprise inquiry: ${name || company || email}`,
        ...built,
      }
    }
    case 'diagnostic-lead': {
      if (!emailOk(email)) throw new Error('Valid email is required')
      const band = clip(body.risk_band, 40)
      const org = company || '—'
      const rows = fieldRows(body, [
        ['Name', ['name']],
        ['Email', ['email']],
        ['Organisation', ['organisation', 'organization', 'company']],
        ['Role', ['role']],
        ['Sector', ['sector']],
        ['Org size', ['org_size']],
        ['Risk band', ['risk_band']],
        ['Score', ['risk_score']],
        ['Weighted', ['weighted_score']],
        ['Multiplier', ['multiplier']],
        ['Flags', ['flags']],
        ['Recommendations', ['recommendations']],
        ['Summary', ['risk_summary']],
        ['Framework', ['framework_version']],
        ['Date', ['report_date']],
        ['Result id', ['result_id', 'rid']],
      ])
      const built = opsMail('New diagnostic submission', rows)
      return {
        to: OPS,
        replyTo: email,
        subject: `New RegAnchor diagnostic: ${band || 'result'} - ${org}`,
        ...built,
      }
    }
    default:
      throw new Error('Unknown kind')
  }
}

function buildAck(opts: {
  to: string
  name: string
  company: string
  band: string
  resultId: string
}) {
  const { to, name, company, band, resultId } = opts
  const href = buyUrl(resultId)
  const parts = [
    `Hello ${name || 'there'},`,
    '',
    'Thank you for completing the RegAnchor AI Risk Diagnostic.',
  ]
  if (company || band) {
    parts.push('', [company, band].filter(Boolean).join(' · '))
  }
  parts.push('', 'The full report is £295. It covers domain findings, regulatory mapping, and a board-ready PDF.')
  parts.push('', href)
  parts.push('', 'RegAnchor', OPS)
  const inner = [
    h1('Your RegAnchor diagnostic'),
    para(`Hello ${name || 'there'},`),
    para('Thank you for completing the RegAnchor AI Risk Diagnostic.'),
    quietContext(company, band),
    para('The full report is £295. It covers domain findings, regulatory mapping, and a board-ready PDF.'),
    cta(href, 'Get Full Report'),
  ].join('')
  return {
    to,
    replyTo: OPS,
    subject: `Your RegAnchor diagnostic${band ? ': ' + band : ''}`,
    text: parts.join('\n'),
    html: shell('Your RegAnchor diagnostic', inner),
  }
}

function buildPortalAlert(to: string, body: Record<string, unknown>) {
  const name = clip(body.to_name || body.name, 120)
  const title = clip(body.alert_title || body.subject, 200)
  const message = clip(body.alert_body || body.message, 8000)
  const heading = title || 'RegAnchor alert'
  const inner = h1(heading) + para(`Hello ${name || 'there'},`) + para(message || '')
  return {
    to,
    replyTo: OPS,
    subject: heading,
    text: `Hello ${name || 'there'},\n\n${title}\n\n${message}\n\nRegAnchor\n${OPS}`,
    html: shell(heading, inner),
  }
}

function buildAdminReply(to: string, body: Record<string, unknown>) {
  const name = clip(body.to_name || body.name, 120)
  const title = clip(body.alert_title || body.subject, 200)
  const message = clip(body.alert_body || body.message, 8000)
  const heading = title || 'RegAnchor support'
  const inner =
    h1(heading) +
    para(`Hello ${name || 'there'},`) +
    `<p style="margin-top:0;margin-bottom:16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#0A0E14;">${nl2br(message || '')}</p>`
  return {
    to,
    replyTo: OPS,
    subject: heading,
    text: `Hello ${name || 'there'},\n\n${message}\n\nRegAnchor\n${OPS}`,
    html: shell(heading, inner),
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return json({ error: 'Mail is not configured' }, 503)

  try {
    const body = (await req.json()) as Record<string, unknown>
    const kind = clip(body.kind, 40) as Kind
    if (!KINDS.includes(kind)) return json({ error: 'Unknown kind' }, 400)

    let mail: { to: string; replyTo: string; subject: string; text: string; html: string }

    if (OPS_KINDS.includes(kind)) {
      mail = buildOps(kind, body)
    } else if (kind === 'diagnostic-ack') {
      const resultId = clip(body.result_id || body.rid, 36)
      if (!UUID_RE.test(resultId)) {
        return json({ error: 'Valid result_id is required' }, 400)
      }
      const supabase = serviceClient()
      const { data: row, error } = await supabase
        .from('diagnostic_results')
        .select('id, respondent_email, respondent_name, organisation, risk_band')
        .eq('id', resultId)
        .maybeSingle()
      if (error) {
        console.error('[send-mail] diagnostic-ack lookup', error.message)
        return json({ error: 'Send failed' }, 500)
      }
      if (!row) return json({ error: 'Diagnostic result not found' }, 400)
      const to = clip(row.respondent_email, 254).toLowerCase()
      if (!emailOk(to)) return json({ error: 'Valid email is required' }, 400)

      // Display from the row; payload may fill blanks (e.g. human band label).
      // Never trust payload email for To.
      const name =
        clip(row.respondent_name, 120) ||
        clip(body.name || body.client_name || body.to_name, 120)
      const company =
        clip(row.organisation, 200) ||
        clip(body.company || body.organisation || body.organization, 200)
      const band = clip(body.risk_band, 40) || clip(row.risk_band, 40)

      mail = buildAck({ to, name, company, band, resultId: row.id })
    } else if (kind === 'portal-alert') {
      const auth = await requireUser(req)
      if ('error' in auth && auth.error) return auth.error
      const userEmail = clip(auth.user!.email, 254).toLowerCase()
      if (!emailOk(userEmail)) return json({ error: 'Valid email is required' }, 400)
      mail = buildPortalAlert(userEmail, body)
    } else if (kind === 'admin-reply') {
      const auth = await requireUser(req)
      if ('error' in auth && auth.error) return auth.error
      const { data: profile } = await auth.supabase!
        .from('profiles')
        .select('role')
        .eq('id', auth.user!.id)
        .maybeSingle()
      if (!profile || profile.role !== 'mla_admin') {
        return json({ error: 'Admin access required' }, 403)
      }
      const to = clip(body.to_email || body.email, 254).toLowerCase()
      if (!emailOk(to)) return json({ error: 'Valid email is required' }, 400)
      mail = buildAdminReply(to, body)
    } else {
      return json({ error: 'Unknown kind' }, 400)
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        reply_to: mail.replyTo,
      }),
    })
    const resJson = await res.json()
    if (!res.ok) {
      console.error('[send-mail]', resJson)
      return json({ error: 'Send failed' }, 502)
    }
    return json({ ok: true, id: resJson.id })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Send failed'
    console.error('[send-mail]', message)
    const known = message === 'Valid email is required'
    return json({ error: known ? message : 'Send failed' }, known ? 400 : 500)
  }
})
