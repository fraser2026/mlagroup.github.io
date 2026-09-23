import { useEffect, useState, type FormEvent, type MouseEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { BrandLoader, Button, Notice } from '../ui'
import { useAuth } from './AuthProvider'
import { APP_ORIGIN, MARKETING_ORIGIN } from '../lib/config'
import { LEGACY_PORTAL_PATH } from '../lib/legacyPortal'
import { setRememberPreference } from '../lib/supabase'
import styles from './LoginPage.module.css'

function isLegacyNext(next: string) {
  return next.startsWith(LEGACY_PORTAL_PATH) || next.startsWith('/legacy/')
}

function marketingUrl(path: string) {
  return `${MARKETING_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`
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

export function LoginPage() {
  const { session, signIn, signUp, signInWithGoogle, resetPassword } = useAuth()
  const [params] = useSearchParams()
  const next = params.get('next') || '/registry'
  const [tab, setTab] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [organisation, setOrganisation] = useState('')
  const [remember, setRemember] = useState(() => {
    try {
      return localStorage.getItem('ra_remember') !== '0'
    } catch {
      return true
    }
  })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [ssoOpen, setSsoOpen] = useState(false)
  const [ssoEmail, setSsoEmail] = useState('')

  useEffect(() => {
    const invite = params.get('invite')
    if (invite) {
      try {
        localStorage.setItem('ra_invite', invite)
      } catch {
        /* ignore */
      }
    }
    try {
      const saved = localStorage.getItem('ra_email')
      if (saved) setEmail(saved)
    } catch {
      /* ignore */
    }
  }, [params])

  useEffect(() => {
    if (session && isLegacyNext(next)) {
      window.location.replace(next)
    }
  }, [session, next])

  if (session && !isLegacyNext(next)) return <Navigate to={next} replace />
  if (session && isLegacyNext(next)) {
    return <BrandLoader viewport label="Opening" />
  }

  function applyRemember() {
    setRememberPreference(remember)
    try {
      if (remember && email.trim()) localStorage.setItem('ra_email', email.trim())
    } catch {
      /* ignore */
    }
  }

  async function onSignIn(e: FormEvent) {
    e.preventDefault()
    setError('')
    setNotice('')
    setBusy(true)
    applyRemember()
    try {
      await signIn(email.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.')
    } finally {
      setBusy(false)
    }
  }

  async function onSignUp(e: FormEvent) {
    e.preventDefault()
    setError('')
    setNotice('')
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setBusy(true)
    applyRemember()
    try {
      await signUp({
        email: email.trim(),
        password,
        fullName: fullName.trim(),
        organisation: organisation.trim() || undefined,
      })
      setNotice('Check your email to confirm your account, then sign in.')
      setTab('signin')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create account.')
    } finally {
      setBusy(false)
    }
  }

  async function onForgot(e: MouseEvent) {
    e.preventDefault()
    setError('')
    setNotice('')
    const addr = email.trim()
    if (!addr) {
      setError('Enter your work email, then use Forgot password.')
      return
    }
    setBusy(true)
    try {
      await resetPassword(addr, `${APP_ORIGIN}/login`)
      setNotice('Password reset email sent. Check your inbox.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send reset email.')
    } finally {
      setBusy(false)
    }
  }

  async function onGoogle() {
    setError('')
    setNotice('')
    applyRemember()
    setBusy(true)
    try {
      const redirectTo = `${APP_ORIGIN}/login?next=${encodeURIComponent(next)}`
      await signInWithGoogle(redirectTo)
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : 'Google sign-in is unavailable. Try email and password.')
    }
  }

  function onSsoSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setNotice('SAML SSO is available on Enterprise. Contact us to enable it for your organisation.')
  }

  const terms = (
    <p className={styles.foot}>
      By continuing you agree to our{' '}
      <a href={marketingUrl('/terms.html')}>Terms of Use</a>,{' '}
      <a href={marketingUrl('/privacy.html')}>Privacy Policy</a>, and{' '}
      <a href={marketingUrl('/security.html')}>Security</a> practices. This workspace is for
      authorised professional use only.
    </p>
  )

  return (
    <div className={styles.page}>
      <a className={styles.brand} href={MARKETING_ORIGIN} aria-label="RegAnchor home">
        <img src="/wordmark.svg" alt="" width={140} height={26} decoding="async" />
      </a>

      <div className={styles.card}>
        {ssoOpen ? (
          <div className={styles.ssoPanel}>
            <button type="button" className={styles.ssoBack} onClick={() => setSsoOpen(false)}>
              ← Back
            </button>
            <div className={styles.ssoKicker}>Single sign-on</div>
            <h1 className={styles.ssoTitle}>Continue with SSO</h1>
            <p className={styles.ssoLead}>
              Enter your work email. We will route you to your organisation's identity provider.
            </p>
            {error ? <Notice tone="risk">{error}</Notice> : null}
            {notice ? <Notice tone="quiet">{notice}</Notice> : null}
            <form onSubmit={onSsoSubmit} className={styles.form}>
              <label className={styles.label}>
                Work email
                <input
                  className={styles.input}
                  type="email"
                  value={ssoEmail}
                  onChange={(e) => setSsoEmail(e.target.value)}
                  placeholder="you@organisation.com"
                  required
                />
              </label>
              <Button type="submit">Continue</Button>
            </form>
            {terms}
          </div>
        ) : (
          <>
            <div className={styles.tabs} role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'signin'}
                className={tab === 'signin' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                onClick={() => {
                  setTab('signin')
                  setError('')
                  setNotice('')
                }}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'signup'}
                className={tab === 'signup' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                onClick={() => {
                  setTab('signup')
                  setError('')
                  setNotice('')
                }}
              >
                Create account
              </button>
            </div>

            {error ? <Notice tone="risk">{error}</Notice> : null}
            {notice ? <Notice tone="quiet">{notice}</Notice> : null}

            {tab === 'signin' ? (
              <form onSubmit={onSignIn} className={styles.form}>
                <label className={styles.label}>
                  Work email
                  <input
                    className={styles.input}
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@organisation.com"
                    required
                  />
                </label>
                <label className={styles.label}>
                  <span className={styles.labelRow}>
                    Password
                    <a href="#forgot" className={styles.forgot} onClick={onForgot}>
                      Forgot password?
                    </a>
                  </span>
                  <input
                    className={styles.input}
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </label>
                <label className={styles.remember}>
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  Remember me on this device
                </label>
                <Button type="submit" disabled={busy}>
                  {busy ? 'Signing in...' : 'Sign in'}
                </Button>
                <div className={styles.ssoStack}>
                  <button type="button" className={styles.ssoBtn} onClick={() => void onGoogle()} disabled={busy}>
                    {GOOGLE_ICON}
                    <span>Continue with Google</span>
                  </button>
                  <button type="button" className={styles.ssoBtn} onClick={() => setSsoOpen(true)}>
                    Continue with SAML SSO
                  </button>
                </div>
                {terms}
              </form>
            ) : (
              <form onSubmit={onSignUp} className={styles.form}>
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
                  Organisation
                  <input
                    className={styles.input}
                    type="text"
                    autoComplete="organization"
                    value={organisation}
                    onChange={(e) => setOrganisation(e.target.value)}
                    placeholder="Acme Ltd"
                  />
                </label>
                <label className={styles.label}>
                  Work email
                  <input
                    className={styles.input}
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@organisation.com"
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
                  {busy ? 'Creating account...' : 'Create account'}
                </Button>
                <div className={styles.ssoStack}>
                  <button type="button" className={styles.ssoBtn} onClick={() => void onGoogle()} disabled={busy}>
                    {GOOGLE_ICON}
                    <span>Continue with Google</span>
                  </button>
                  <button type="button" className={styles.ssoBtn} onClick={() => setSsoOpen(true)}>
                    Continue with SAML SSO
                  </button>
                </div>
                {terms}
              </form>
            )}
          </>
        )}
      </div>
    </div>
  )
}
