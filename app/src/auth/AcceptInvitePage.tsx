import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { BrandLoader, Button, Notice } from '../ui'
import { useAuth } from './AuthProvider'
import { APP_ORIGIN, MARKETING_ORIGIN } from '../lib/config'
import {
  acceptOrgInviteToken,
  peekOrgInvite,
  storeInviteToken,
  type InvitePeek,
} from '../lib/org'
import { sb } from '../lib/supabase'
import styles from './LoginPage.module.css'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
}

const GOOGLE_ICON = (
  <svg className={styles.gIcon} viewBox="0 0 18 18" aria-hidden>
    <path
      fill="#4285F4"
      d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.09-1.79 2.73v2.27h2.9c1.7-1.56 2.69-3.87 2.69-6.64z"
    />
    <path
      fill="#34A853"
      d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.27c-.81.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.34C2.44 15.98 5.48 18 9 18z"
    />
    <path
      fill="#FBBC05"
      d="M3.95 10.69A5.41 5.41 0 013.66 9c0-.59.1-1.16.29-1.69V4.97H.96A8.99 8.99 0 000 9c0 1.45.35 2.82.96 4.03l2.99-2.34z"
    />
    <path
      fill="#EA4335"
      d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.97l2.99 2.34C4.66 5.17 6.65 3.58 9 3.58z"
    />
  </svg>
)

function emailsMatch(a?: string | null, b?: string | null) {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase())
}

export function AcceptInvitePage() {
  const { session, user, ready, signIn, signUp, signInWithGoogle, signOut, refreshOrg } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') || params.get('invite') || ''

  const [peek, setPeek] = useState<InvitePeek | null>(null)
  const [peekError, setPeekError] = useState('')
  const [peekReady, setPeekReady] = useState(false)
  const [tab, setTab] = useState<'create' | 'signin'>('create')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const autoAcceptTried = useRef(false)

  useEffect(() => {
    if (!token || token.length < 16) {
      setPeekError('This invite link is incomplete. Ask your admin to send a new invite.')
      setPeekReady(true)
      return
    }
    storeInviteToken(token)
    let cancelled = false
    ;(async () => {
      const result = await peekOrgInvite(token)
      if (cancelled) return
      if (result.ok === false) {
        setPeekError(result.error)
        setPeek(null)
      } else {
        setPeek(result)
        setPeekError('')
      }
      setPeekReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  async function ensureSessionReady() {
    for (let i = 0; i < 30; i++) {
      const { data } = await sb.auth.getSession()
      if (data.session?.user) return data.session
      await new Promise((r) => setTimeout(r, 80))
    }
    throw new Error('Could not establish a session. Try again.')
  }

  async function finishAfterAuth() {
    await ensureSessionReady()
    const result = await acceptOrgInviteToken(token)
    if (!result.ok) throw new Error(result.error || 'Could not accept invitation.')
    await refreshOrg()
    navigate('/registry', { replace: true })
  }

  useEffect(() => {
    if (!ready || !peekReady || !peek || !session?.user || busy || autoAcceptTried.current) return
    if (!emailsMatch(session.user.email, peek.email)) return
    autoAcceptTried.current = true
    let cancelled = false
    ;(async () => {
      setAccepting(true)
      setError('')
      try {
        await finishAfterAuth()
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not accept invitation.')
          setAccepting(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // finishAfterAuth closes over token/refreshOrg/navigate; run once per matching session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, peekReady, peek, session, busy])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    if (!peek) return
    setError('')
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setBusy(true)
    try {
      storeInviteToken(token)
      await signUp({
        email: peek.email,
        password,
        fullName: fullName.trim() || peek.email.split('@')[0] || 'Member',
      })
      await finishAfterAuth()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not create account.'
      if (/already registered|already been registered|User already/i.test(msg)) {
        setTab('signin')
        setError('An account already exists for this email. Sign in to accept the invite.')
      } else {
        setError(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  async function onSignIn(e: FormEvent) {
    e.preventDefault()
    if (!peek) return
    setError('')
    setBusy(true)
    try {
      storeInviteToken(token)
      await signIn(peek.email, password)
      await finishAfterAuth()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.')
    } finally {
      setBusy(false)
    }
  }

  async function onGoogle() {
    if (!peek) return
    setError('')
    setBusy(true)
    try {
      storeInviteToken(token)
      const redirectTo = `${APP_ORIGIN}/invite?token=${encodeURIComponent(token)}`
      await signInWithGoogle(redirectTo)
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : 'Google sign-in is unavailable.')
    }
  }

  if (!peekReady || !ready) {
    return <BrandLoader viewport label="Opening invite" />
  }

  if (peekError) {
    return (
      <div className={styles.page}>
        <a className={styles.brand} href={MARKETING_ORIGIN} aria-label="RegAnchor home">
          <img src="/wordmark.svg" alt="" width={140} height={26} decoding="async" />
        </a>
        <div className={styles.card}>
          <div className={styles.ssoPanel}>
            <h1 className={styles.ssoTitle}>Invite unavailable</h1>
            <Notice tone="risk">{peekError}</Notice>
            <Button type="button" onClick={() => navigate('/login', { replace: true })}>
              Go to sign in
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!peek) return <Navigate to="/login" replace />

  const roleLabel = ROLE_LABELS[peek.role] || peek.role
  const wrongAccount =
    Boolean(session?.user) && !emailsMatch(session?.user?.email, peek.email) && !accepting

  if (accepting) {
    return <BrandLoader viewport label="Joining workspace" />
  }

  return (
    <div className={styles.page}>
      <a className={styles.brand} href={MARKETING_ORIGIN} aria-label="RegAnchor home">
        <img src="/wordmark.svg" alt="" width={140} height={26} decoding="async" />
      </a>

      <div className={styles.card}>
        <div className={styles.ssoPanel}>
          <div className={styles.ssoKicker}>Workspace invite</div>
          <h1 className={styles.ssoTitle}>Accept invite</h1>
          <p className={styles.ssoLead}>
            Join {peek.org_name} as {roleLabel}. Use {peek.email} to continue.
          </p>

          {wrongAccount ? (
            <>
              <Notice tone="risk">
                You are signed in as {user?.email || 'another account'}. Sign out, then continue with{' '}
                {peek.email}.
              </Notice>
              <Button
                type="button"
                pending={busy}
                onClick={() => {
                  setBusy(true)
                  void signOut().finally(() => setBusy(false))
                }}
              >
                Sign out
              </Button>
            </>
          ) : (
            <>
              <div className={styles.tabs} role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'create'}
                  className={tab === 'create' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                  onClick={() => {
                    setTab('create')
                    setError('')
                  }}
                >
                  Create password
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'signin'}
                  className={tab === 'signin' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                  onClick={() => {
                    setTab('signin')
                    setError('')
                  }}
                >
                  Sign in
                </button>
              </div>

              {error ? <Notice tone="risk">{error}</Notice> : null}

              {tab === 'create' ? (
                <form onSubmit={onCreate} className={styles.form}>
                  <label className={styles.label}>
                    Work email
                    <input className={styles.input} type="email" value={peek.email} readOnly />
                  </label>
                  <label className={styles.label}>
                    Full name
                    <input
                      className={styles.input}
                      type="text"
                      autoComplete="name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Jane Smith"
                      required
                    />
                  </label>
                  <label className={styles.label}>
                    Password
                    <input
                      className={styles.input}
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Minimum 8 characters"
                      required
                    />
                  </label>
                  <Button type="submit" disabled={busy}>
                    {busy ? 'Joining...' : 'Accept invite'}
                  </Button>
                  <div className={styles.ssoStack}>
                    <button
                      type="button"
                      className={styles.ssoBtn}
                      onClick={() => void onGoogle()}
                      disabled={busy}
                    >
                      {GOOGLE_ICON}
                      <span>Continue with Google</span>
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={onSignIn} className={styles.form}>
                  <label className={styles.label}>
                    Work email
                    <input className={styles.input} type="email" value={peek.email} readOnly />
                  </label>
                  <label className={styles.label}>
                    Password
                    <input
                      className={styles.input}
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </label>
                  <Button type="submit" disabled={busy}>
                    {busy ? 'Joining...' : 'Accept invite'}
                  </Button>
                  <div className={styles.ssoStack}>
                    <button
                      type="button"
                      className={styles.ssoBtn}
                      onClick={() => void onGoogle()}
                      disabled={busy}
                    >
                      {GOOGLE_ICON}
                      <span>Continue with Google</span>
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
