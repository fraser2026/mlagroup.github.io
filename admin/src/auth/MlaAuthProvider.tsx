import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { sb } from '../lib/supabase'

export type MlaProfile = {
  id: string
  email?: string | null
  full_name?: string | null
  role?: string | null
}

type AuthState = {
  ready: boolean
  session: Session | null
  user: User | null
  profile: MlaProfile | null
  isMlaAdmin: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

async function loadProfile(userId: string): Promise<MlaProfile | null> {
  const { data, error } = await sb
    .from('profiles')
    .select('id,email,full_name,role')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return (data as MlaProfile | null) || null
}

export function MlaAuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<MlaProfile | null>(null)

  async function hydrate(user: User | null) {
    if (!user) {
      setProfile(null)
      return
    }
    setProfile(await loadProfile(user.id))
  }

  useEffect(() => {
    let mounted = true
    sb.auth.getSession().then(async ({ data }) => {
      if (!mounted) return
      setSession(data.session)
      await hydrate(data.session?.user ?? null)
      setReady(true)
    })
    const { data: sub } = sb.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      void hydrate(next?.user ?? null).finally(() => setReady(true))
    })
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      ready,
      session,
      user: session?.user ?? null,
      profile,
      isMlaAdmin: profile?.role === 'mla_admin',
      async refreshProfile() {
        if (session?.user) setProfile(await loadProfile(session.user.id))
      },
      async signIn(email, password) {
        const { error } = await sb.auth.signInWithPassword({ email, password })
        if (error) throw error
      },
      async signOut() {
        await sb.auth.signOut()
        setProfile(null)
      },
    }),
    [ready, session, profile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useMlaAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useMlaAuth requires MlaAuthProvider')
  return ctx
}
