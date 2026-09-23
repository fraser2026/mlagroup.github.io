import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { BrandLoader, Button, Notice, PageHeader } from '@ra/ui'
import { useMlaAuth } from './MlaAuthProvider'
import styles from './LoginPage.module.css'

export function LoginPage() {
  const { ready, session, isMlaAdmin, signIn } = useMlaAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!ready) return <BrandLoader viewport label="Loading" />
  if (session && isMlaAdmin) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await signIn(email.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <PageHeader title="Control Centre" description="For authorised users only." />
        {session && !isMlaAdmin ? (
          <Notice tone="risk">Signed in, but this account is not an MLA admin.</Notice>
        ) : null}
        {error ? <Notice tone="risk">{error}</Notice> : null}
        <form className={styles.form} onSubmit={(e) => void onSubmit(e)}>
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
          <Button type="submit" pending={busy}>
            Sign in
          </Button>
        </form>
      </div>
    </div>
  )
}
