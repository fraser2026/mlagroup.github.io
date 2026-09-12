import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, Notice, PageHeader } from '../ui'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../lib/config'
import { useAuth } from '../auth/AuthProvider'
import { sb } from '../lib/supabase'

export function OAuthConsentPage() {
  const { session } = useAuth()
  const [params] = useSearchParams()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [orgId, setOrgId] = useState<string | null>(null)

  const clientName = params.get('client_name') || 'MCP client'
  const payload = useMemo(
    () => ({
      client_id: params.get('client_id') || '',
      redirect_uri: params.get('redirect_uri') || '',
      code_challenge: params.get('code_challenge') || '',
      state: params.get('state') || '',
      resource: params.get('resource') || '',
      scope: params.get('scope') || 'mcp:tools',
    }),
    [params],
  )

  useEffect(() => {
    if (!session) return
    void sb
      .from('profiles')
      .select('org_id')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => setOrgId((data?.org_id as string) || null))
  }, [session])

  async function consent(deny: boolean) {
    if (!session) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mcp-oauth/consent`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...payload, org_id: orgId || undefined, deny }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.redirect_to) {
        throw new Error(data.error_description || data.error || 'Consent failed.')
      }
      window.location.href = data.redirect_to as string
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Consent failed.')
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 440, margin: '48px auto', padding: 24 }}>
      <PageHeader
        title="Authorise MCP client"
        description="Allow this host to use RegAnchor tools as you."
      />
      <Notice title={clientName}>
        Short-lived access under your permissions. Tokens expire in one hour; revoke sessions anytime under
        Integrations.
      </Notice>
      {error ? <Notice tone="risk">{error}</Notice> : null}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <Button variant="ghost" disabled={busy} onClick={() => void consent(true)}>
          Deny
        </Button>
        <Button disabled={busy || !payload.client_id} onClick={() => void consent(false)}>
          {busy ? 'Allowing…' : 'Allow'}
        </Button>
      </div>
    </div>
  )
}
