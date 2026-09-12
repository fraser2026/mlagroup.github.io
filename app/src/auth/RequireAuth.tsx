import { Navigate, useLocation } from 'react-router-dom'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { BrandLoader } from '../ui'
import { useAuth } from './AuthProvider'
import { MfaChallenge } from './MfaChallenge'
import { sb } from '../lib/supabase'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { ready, session } = useAuth()
  const location = useLocation()
  const [aalReady, setAalReady] = useState(false)
  const [needsMfa, setNeedsMfa] = useState(false)

  const checkAal = useCallback(async () => {
    if (!session) {
      setNeedsMfa(false)
      setAalReady(true)
      return
    }
    setAalReady(false)
    try {
      const { data, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel()
      if (error) throw error
      setNeedsMfa(data.nextLevel === 'aal2' && data.currentLevel !== 'aal2')
    } catch {
      setNeedsMfa(false)
    } finally {
      setAalReady(true)
    }
  }, [session])

  useEffect(() => {
    void checkAal()
  }, [checkAal])

  if (!ready || (session && !aalReady)) {
    return <BrandLoader viewport label="Loading" />
  }
  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }
  if (needsMfa) {
    return (
      <MfaChallenge
        onVerified={() => {
          setNeedsMfa(false)
          void checkAal()
        }}
      />
    )
  }
  return children
}
