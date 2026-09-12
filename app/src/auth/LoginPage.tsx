import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { BrandLoader, Button, Notice, PageHeader } from '../ui'
import { useAuth } from './AuthProvider'
import { LEGACY_PORTAL_PATH } from '../lib/legacyPortal'
import styles from './LoginPage.module.css'

function isLegacyNext(next: string) {
  return next.startsWith(LEGACY_PORTAL_PATH) || next.startsWith('/legacy/')
}

export function LoginPage() {
  const { session, signIn } = useAuth()
  const [params] = useSearchParams()
  const next = params.get('next') || '/registry'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const invite = params.get('invite')
    if (invite) {
      try {
        localStorage.setItem('ra_invite', invite)
      } catch {
        /* ignore */
      }
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await signIn(email.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <PageHeader title="Sign in" description="Access your RegAnchor workspace." />
        {error ? <Notice tone="risk">{error}</Notice> : null}
        <form onSubmit={onSubmit} className={styles.form}>
          <label className={styles.label}>
            Email
            <input
              className={styles.input}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
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
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <p className={styles.hint}>
          Marketing site remains at{' '}
          <a href="https://reganchor.com">reganchor.com</a>.
        </p>
      </div>
    </div>
  )
}
