import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { sb } from '../lib/supabase'
import {
  loadOrgContext,
  type OrgContext,
  type Organisation,
  type OrgRole,
  canDeleteRegistry,
  canManageMembers,
  canWriteRegistry,
  isPaidTier,
} from '../lib/org'

type AuthState = {
  ready: boolean
  session: Session | null
  user: User | null
  org: Organisation | null
  role: OrgRole | null
  profile: OrgContext['profile']
  orgReady: boolean
  canManageMembers: boolean
  canWriteRegistry: boolean
  canDeleteRegistry: boolean
  isPaidTier: boolean
  refreshOrg: () => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signUp: (input: {
    email: string
    password: string
    firstName?: string
    lastName?: string
    /** Compat / composed; preferred path is firstName + lastName. */
    fullName?: string
    organisation?: string
  }) => Promise<void>
  signInWithGoogle: (redirectTo: string) => Promise<void>
  resetPassword: (email: string, redirectTo: string) => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [orgCtx, setOrgCtx] = useState<OrgContext>({ profile: null, org: null, role: null })
  const [orgReady, setOrgReady] = useState(false)
  const orgCtxRef = useRef(orgCtx)
  orgCtxRef.current = orgCtx

  async function hydrateOrg(user: User) {
    // Only mark not-ready on the first load (no profile yet). Re-hydrates keep
    // the prior profile painted so the sidebar never flashes email fallback.
    if (!orgCtxRef.current.profile) setOrgReady(false)
    try {
      const ctx = await loadOrgContext(
        user.id,
        user.email,
        (user.user_metadata || null) as Record<string, unknown> | null,
      )
      setOrgCtx(ctx)
    } finally {
      setOrgReady(true)
    }
  }

  useEffect(() => {
    let mounted = true
    sb.auth.getSession().then(async ({ data }) => {
      if (!mounted) return
      setSession(data.session)
      setReady(true)
      if (data.session?.user) await hydrateOrg(data.session.user)
      else {
        setOrgCtx({ profile: null, org: null, role: null })
        setOrgReady(true)
      }
    })
    const { data: sub } = sb.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setReady(true)
      if (next?.user) void hydrateOrg(next.user)
      else {
        setOrgCtx({ profile: null, org: null, role: null })
        setOrgReady(true)
      }
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
      org: orgCtx.org,
      role: orgCtx.role,
      profile: orgCtx.profile,
      orgReady,
      canManageMembers: canManageMembers(orgCtx.role),
      canWriteRegistry: canWriteRegistry(orgCtx.role),
      canDeleteRegistry: canDeleteRegistry(orgCtx.role),
      isPaidTier: isPaidTier(orgCtx.org),
      async refreshOrg() {
        if (session?.user) await hydrateOrg(session.user)
      },
      async signIn(email, password) {
        const { error } = await sb.auth.signInWithPassword({ email, password })
        if (error) throw error
      },
      async signUp({ email, password, firstName, lastName, fullName, organisation }) {
        const first = String(firstName || '').trim()
        const last = String(lastName || '').trim()
        const composed =
          String(fullName || '').trim() || [first, last].filter(Boolean).join(' ')
        const { error } = await sb.auth.signUp({
          email,
          password,
          options: {
            data: {
              first_name: first || undefined,
              last_name: last || undefined,
              full_name: composed || undefined,
              organisation: organisation || undefined,
            },
          },
        })
        if (error) throw error
      },
      async signInWithGoogle(redirectTo) {
        const { error } = await sb.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo,
            queryParams: { prompt: 'select_account' },
          },
        })
        if (error) throw error
      },
      async resetPassword(email, redirectTo) {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo })
        if (error) throw error
      },
      async signOut() {
        await sb.auth.signOut()
      },
    }),
    [ready, session, orgCtx, orgReady],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth requires AuthProvider')
  return ctx
}
